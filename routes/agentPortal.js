// Agent-specific data endpoints
// COMMISSION RULE: Agent earns commission ONLY on payments tied to the
// property's first_lease_id (the very first lease ever created).
// All subsequent leases → 100% goes to the owner.
const router = require('express').Router();
const db = require('../db/connection');

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    // Properties assigned to this agent (via PROPERTY_AGENT junction)
    const [[{ my_properties }]] = await db.query(
      'SELECT COUNT(DISTINCT pa.Property_ID) AS my_properties FROM PROPERTY_AGENT pa WHERE pa.Agent_ID=?', [aid]);

    const [[{ new_inquiries }]] = await db.query(
      "SELECT COUNT(*) AS new_inquiries FROM INQUIRY WHERE Agent_ID=? AND Status='New'", [aid]);

    const [[{ active_leases }]] = await db.query(`
      SELECT COUNT(*) AS active_leases
      FROM LEASE l
      JOIN PROPERTY_AGENT pa ON l.Property_ID = pa.Property_ID
      WHERE pa.Agent_ID=? AND l.End_Date>=CURDATE()`, [aid]);

    const [[{ pending_payments }]] = await db.query(`
      SELECT COUNT(*) AS pending_payments
      FROM PAYMENT pay
      JOIN LEASE l ON pay.Lease_ID = l.Lease_ID
      JOIN PROPERTY_AGENT pa ON l.Property_ID = pa.Property_ID
      WHERE pa.Agent_ID=? AND pay.Status='Pending'`, [aid]);

    // Commission: ONLY on the FIRST lease ever for each property.
    // Lease commission = (Lease_Commission_Days / 30) × Monthly_Rent (paid once)
    // Sale commission  = Commission_Rate% of sale amount (separate, existing logic)
    const [[{ commission_earned }]] = await db.query(`
      SELECT IFNULL(SUM(
        ROUND(a.Lease_Commission_Days / 60.0 * l.Monthly_Rent, 2)
      ), 0) AS commission_earned
      FROM LEASE l
      JOIN PROPERTY p ON l.Property_ID = p.Property_ID
      JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Agent_ID = ?
      JOIN AGENT a   ON pa.Agent_ID = a.Agent_ID
      WHERE l.Lease_ID = p.first_lease_id`, [aid]); // commission: first lease only

    res.json({ my_properties, new_inquiries, active_leases, pending_payments, commission_earned });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── My assigned properties ───────────────────────────────────────────────────
router.get('/properties', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT p.*,
             o.Name AS Owner_Name, o.Phone AS Owner_Phone,
             pa.Is_Primary,
             (SELECT COUNT(*) FROM INQUIRY i WHERE i.Property_ID=p.Property_ID) AS inquiry_count,
             (SELECT GROUP_CONCAT(am.Amenity_Name SEPARATOR ', ')
              FROM PROPERTY_AMENITY pam
              JOIN AMENITY am ON pam.Amenity_ID=am.Amenity_ID
              WHERE pam.Property_ID=p.Property_ID) AS Amenities
      FROM PROPERTY p
      JOIN OWNER o ON p.Owner_ID = o.Owner_ID
      JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Agent_ID = ?
      ORDER BY pa.Is_Primary DESC, p.Property_ID DESC`, [aid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Inquiries for agent ──────────────────────────────────────────────────────
router.get('/inquiries', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT i.*, p.Title AS Property_Title, p.Location, p.Price,
             t.Tenant_ID, t.Name AS Tenant_Name, t.Phone AS Tenant_Phone, t.Email AS Tenant_Email
      FROM INQUIRY i
      JOIN PROPERTY p ON i.Property_ID = p.Property_ID
      JOIN TENANT t   ON i.Tenant_ID   = t.Tenant_ID
      WHERE i.Agent_ID = ?
      ORDER BY FIELD(i.Status,'New','Responded','Closed'), i.Date DESC`, [aid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Update inquiry status ────────────────────────────────────────────────────
router.put('/inquiries/:id', async (req, res) => {
  const { Status } = req.body;
  const aid = req.user.ref_id;
  try {
    await db.query('UPDATE INQUIRY SET Status=? WHERE Inquiry_ID=? AND Agent_ID=?', [Status, req.params.id, aid]);
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Create lease (agent portal) ──────────────────────────────────────────────
// LOCKING: SELECT FOR UPDATE on PROPERTY row prevents two agents from leasing
// the same property concurrently.  Whichever agent's transaction acquires the
// lock first wins; the second will either see status 'Pending'/'Rented' and
// be rejected, or wait and then be rejected by the BEFORE INSERT trigger.
router.post('/leases', async (req, res) => {
  const { Property_ID, Tenant_ID, Start_Date, End_Date, Monthly_Rent, Security_Deposit } = req.body;
  const aid  = req.user.ref_id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ① Lock property row — prevents any concurrent lease or sale on the same property
    const [propRows] = await conn.query(
      'SELECT p.Property_ID, p.Status FROM PROPERTY p JOIN PROPERTY_AGENT pa ON p.Property_ID=pa.Property_ID WHERE p.Property_ID=? AND pa.Agent_ID=? FOR UPDATE',
      [Property_ID, aid]
    );
    if (!propRows.length) {
      await conn.rollback();
      return res.status(403).json({ error: 'Property not found or not assigned to you.' });
    }

    const prop = propRows[0];
    if (prop.Status !== 'Available') {
      await conn.rollback();
      return res.status(409).json({
        error: `Cannot lease: property is currently '${prop.Status}'.`,
        property_status: prop.Status
      });
    }

    // ② Insert lease as Pending_Payment
    const [r] = await conn.query(
      'INSERT INTO LEASE (Start_Date,End_Date,Monthly_Rent,Security_Deposit,Property_ID,Lease_Status) VALUES(?,?,?,?,?,?)',
      [Start_Date, End_Date, Monthly_Rent, Security_Deposit || 0, Property_ID, 'Pending_Payment']
    );
    const leaseId = r.insertId;

    // ③ Link tenant
    await conn.query('INSERT INTO TENANT_LEASE (Tenant_ID,Lease_ID) VALUES(?,?)', [Tenant_ID, leaseId]);

    // ④ Mark property Pending (becomes Rented after security deposit paid)
    await conn.query("UPDATE PROPERTY SET Status='Pending' WHERE Property_ID=?", [Property_ID]);

    await conn.commit();
    res.status(201).json({ Lease_ID: leaseId, message: 'Lease created. Tenant must pay security deposit within 2 hours.' });
  } catch (e) {
    await conn.rollback();
    const status = e.code === 'ER_SIGNAL_EXCEPTION' ? 409 : 500;
    res.status(status).json({ error: e.message });
  } finally { conn.release(); }
});

// ─── Terminate lease ───────────────────────────────────────────────────────────
router.post('/leases/:id/terminate', async (req, res) => {
  const aid  = req.user.ref_id;
  const conn = await db.getConnection();
  try {
    const [[lease]] = await conn.query(`
      SELECT l.Lease_ID, l.Property_ID FROM LEASE l
      JOIN PROPERTY_AGENT pa ON l.Property_ID = pa.Property_ID
      WHERE l.Lease_ID = ? AND pa.Agent_ID = ?`, [req.params.id, aid]);
    if (!lease) return res.status(403).json({ error: 'Lease not found or not assigned to you' });

    await conn.beginTransaction();
    await conn.query("UPDATE LEASE SET Lease_Status='Terminated' WHERE Lease_ID=?", [lease.Lease_ID]);
    await conn.query('DELETE FROM TENANT_LEASE WHERE Lease_ID=?', [lease.Lease_ID]);
    const [[prop]] = await conn.query('SELECT Status FROM PROPERTY WHERE Property_ID=?', [lease.Property_ID]);
    if (prop && prop.Status !== 'Sold') {
      await conn.query("UPDATE PROPERTY SET Status='Available' WHERE Property_ID=?", [lease.Property_ID]);
    }
    await conn.commit();
    const msg = prop?.Status === 'Sold'
      ? 'Lease terminated. Property remains Sold (irreversible).'
      : 'Lease terminated. Property is now Available.';
    res.json({ message: msg });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }); }
  finally { conn.release(); }
});

// ─── Leases for agent ─────────────────────────────────────────────────────────
router.get('/leases', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT l.*, p.Title AS Property_Title,
             GROUP_CONCAT(t.Name SEPARATOR ', ') AS Tenants,
             CASE WHEN l.Lease_ID = p.first_lease_id THEN 1 ELSE 0 END AS Is_Commission_Lease,
             CASE WHEN l.Lease_ID = p.first_lease_id
                  THEN ROUND(a.Lease_Commission_Days / 30.0 * l.Monthly_Rent, 2)
                  ELSE 0 END AS Lease_Commission_Amount,
             a.Lease_Commission_Days
      FROM LEASE l
      JOIN PROPERTY p           ON l.Property_ID = p.Property_ID
      JOIN PROPERTY_AGENT pa    ON p.Property_ID = pa.Property_ID AND pa.Agent_ID = ?
      JOIN AGENT a              ON pa.Agent_ID   = a.Agent_ID
      LEFT JOIN TENANT_LEASE tl ON l.Lease_ID  = tl.Lease_ID
      LEFT JOIN TENANT t        ON tl.Tenant_ID = t.Tenant_ID
      GROUP BY l.Lease_ID
      ORDER BY l.Start_Date DESC`, [aid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Payments for agent (with commission breakdown) ───────────────────────────
// Lease commission  = (Lease_Commission_Days / 30) × Monthly_Rent — ONCE on first lease
// Sale commission   = Commission_Rate% of sale amount (handled in payments.js)
router.get('/payments', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT
        pay.*,
        p.Title AS Property_Title,
        GROUP_CONCAT(t.Name SEPARATOR ', ') AS Tenants,
        CASE WHEN l.Lease_ID = p.first_lease_id THEN 1 ELSE 0 END AS Is_Commission_Eligible,
        -- Lease commission: days-based, paid once (on first lease)
        CASE WHEN l.Lease_ID = p.first_lease_id
             THEN ROUND(a.Lease_Commission_Days / 30.0 * l.Monthly_Rent, 2)
             ELSE 0 END AS Commission_Amount,
        a.Commission_Rate,
        a.Lease_Commission_Days
      FROM PAYMENT pay
      JOIN LEASE l    ON pay.Lease_ID   = l.Lease_ID
      JOIN PROPERTY p ON l.Property_ID  = p.Property_ID
      JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Agent_ID = ?
      JOIN AGENT a    ON pa.Agent_ID    = a.Agent_ID
      LEFT JOIN TENANT_LEASE tl ON l.Lease_ID = tl.Lease_ID
      LEFT JOIN TENANT t        ON tl.Tenant_ID = t.Tenant_ID
      GROUP BY pay.Payment_ID
      ORDER BY pay.Payment_Date DESC`, [aid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SALE ENDPOINTS ───────────────────────────────────────────────────────────
// LOCKING: SELECT FOR UPDATE on PROPERTY prevents two agents from creating
// a sale on the same property at the same time (race condition).
router.post('/sales', async (req, res) => {
  const { Property_ID, Buyer_Tenant_ID, Amount } = req.body;
  const aid  = req.user.ref_id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ① Lock property row — concurrent sale/lease by another agent will block
    const [[prop]] = await conn.query(
      'SELECT p.Property_ID, p.Status FROM PROPERTY p JOIN PROPERTY_AGENT pa ON p.Property_ID=pa.Property_ID WHERE p.Property_ID=? AND pa.Agent_ID=? FOR UPDATE',
      [Property_ID, aid]
    );
    if (!prop) { await conn.rollback(); return res.status(403).json({ error: 'Property not found or not assigned to you' }); }
    if (prop.Status === 'Sold')   { await conn.rollback(); return res.status(400).json({ error: 'Property is already sold.' }); }
    if (prop.Status === 'Rented') { await conn.rollback(); return res.status(400).json({ error: 'Property is currently rented. Terminate the lease first.' }); }

    const [r] = await conn.query(
      "INSERT INTO SALE (Property_ID, Buyer_Tenant_ID, Amount, Sale_Status) VALUES(?,?,?,'Pending_Payment')",
      [Property_ID, Buyer_Tenant_ID, Amount]
    );
    await conn.query("UPDATE PROPERTY SET Status='Pending' WHERE Property_ID=?", [Property_ID]);
    await conn.commit();
    res.status(201).json({ Sale_ID: r.insertId, message: 'Sale created! Buyer has 3 hours to complete payment.' });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }); }
  finally { conn.release(); }
});

router.get('/sales', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT s.*, p.Title AS Property_Title, p.Location, p.Status AS Property_Status,
             t.Name AS Buyer_Name, t.Phone AS Buyer_Phone, t.Email AS Buyer_Email,
             TIMESTAMPDIFF(SECOND, s.Created_At, NOW()) AS seconds_elapsed
      FROM SALE s
      JOIN PROPERTY p   ON s.Property_ID     = p.Property_ID
      JOIN TENANT   t   ON s.Buyer_Tenant_ID = t.Tenant_ID
      JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Agent_ID = ?
      ORDER BY s.Created_At DESC`, [aid]);
    rows.forEach(r => {
      r.time_remaining_seconds = r.Sale_Status === 'Pending_Payment'
        ? Math.max(0, 10800 - (r.seconds_elapsed || 0))
        : null;
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

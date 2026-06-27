// Tenant-specific data endpoints
const router = require('express').Router();
const db = require('../db/connection');

// My inquiries
router.get('/inquiries', async (req, res) => {
  const tid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT i.*, p.Title AS Property_Title, p.Location, p.Price, p.Status AS Property_Status,
             a.Name AS Agent_Name, a.Phone AS Agent_Phone
      FROM INQUIRY i
      JOIN PROPERTY p ON i.Property_ID = p.Property_ID
      JOIN AGENT a    ON i.Agent_ID    = a.Agent_ID
      WHERE i.Tenant_ID = ?
      ORDER BY i.Date DESC`, [tid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// My leases (includes status + created_at for countdown)
router.get('/leases', async (req, res) => {
  const tid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT l.*, p.Title AS Property_Title, p.Location, p.Type,
             a.Name AS Agent_Name, o.Name AS Owner_Name,
             TIMESTAMPDIFF(SECOND, l.Created_At, NOW()) AS seconds_elapsed
      FROM LEASE l
      JOIN TENANT_LEASE tl ON l.Lease_ID = tl.Lease_ID
      JOIN PROPERTY p      ON l.Property_ID = p.Property_ID
      JOIN OWNER o         ON p.Owner_ID = o.Owner_ID
      LEFT JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Is_Primary = 1
      LEFT JOIN AGENT a    ON pa.Agent_ID = a.Agent_ID
      WHERE tl.Tenant_ID = ?
      ORDER BY l.Start_Date DESC`, [tid]);
    // Compute time remaining (2 hrs = 7200 seconds)
    rows.forEach(r => {
      r.time_remaining_seconds = r.Lease_Status === 'Pending_Payment'
        ? Math.max(0, 7200 - (r.seconds_elapsed || 0))
        : null;
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pay security deposit
router.post('/pay-security', async (req, res) => {
  const { Lease_ID, Amount, Method } = req.body;
  const tid  = req.user.ref_id;
  const conn = await db.getConnection();
  try {
    // Verify this lease belongs to tenant and is still Pending_Payment
    const [[lease]] = await conn.query(`
      SELECT l.Lease_ID, l.Property_ID, l.Security_Deposit, l.Lease_Status,
             TIMESTAMPDIFF(SECOND, l.Created_At, NOW()) AS seconds_elapsed
      FROM LEASE l
      JOIN TENANT_LEASE tl ON l.Lease_ID = tl.Lease_ID
      WHERE l.Lease_ID = ? AND tl.Tenant_ID = ?`, [Lease_ID, tid]);

    if (!lease) return res.status(404).json({ error: 'Lease not found' });
    if (lease.Lease_Status === 'Terminated')
      return res.status(400).json({ error: 'This lease has been terminated.' });
    if (lease.Lease_Status === 'Active')
      return res.status(400).json({ error: 'Security deposit already paid.' });
    if (lease.seconds_elapsed > 7200)
      return res.status(400).json({ error: 'Time limit expired! The lease was cancelled. Property is available again.' });

    await conn.beginTransaction();
    // Record payment
    const today = new Date().toISOString().slice(0,10);
    await conn.query(
      "INSERT INTO PAYMENT (Payment_Date,Amount,Payment_Type,Method,Status,Lease_ID) VALUES(?,?,?,?,?,?)",
      [today, Amount, 'Security_Deposit', Method, 'Success', Lease_ID]
    );
    // Activate lease
    await conn.query("UPDATE LEASE SET Lease_Status='Active' WHERE Lease_ID=?", [Lease_ID]);
    // Set property to Rented
    await conn.query("UPDATE PROPERTY SET Status='Rented' WHERE Property_ID=?", [lease.Property_ID]);
    await conn.commit();
    res.json({ message: '✓ Security deposit paid! Your lease is now Active. Property is Rented.' });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }); }
  finally { conn.release(); }
});


// My payments (via my leases)
router.get('/payments', async (req, res) => {
  const tid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT pay.*, p.Title AS Property_Title
      FROM PAYMENT pay
      JOIN LEASE l         ON pay.Lease_ID = l.Lease_ID
      JOIN TENANT_LEASE tl ON l.Lease_ID   = tl.Lease_ID
      JOIN PROPERTY p      ON l.Property_ID = p.Property_ID
      WHERE tl.Tenant_ID = ?
      ORDER BY pay.Payment_Date DESC`, [tid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Submit inquiry
router.post('/inquiries', async (req, res) => {
  const { Property_ID, Message } = req.body;
  const tid = req.user.ref_id;
  try {
    // Get the primary agent for this property
    const [[prop]] = await db.query(`
      SELECT Agent_ID FROM PROPERTY_AGENT
      WHERE Property_ID=?
      ORDER BY Is_Primary DESC LIMIT 1`, [Property_ID]);
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    const today = new Date().toISOString().slice(0, 10);
    const [r] = await db.query(
      'INSERT INTO INQUIRY (Message,Date,Status,Tenant_ID,Property_ID,Agent_ID) VALUES(?,?,?,?,?,?)',
      [Message, today, 'New', tid, Property_ID, prop.Agent_ID]
    );
    res.status(201).json({ Inquiry_ID: r.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dashboard summary
router.get('/dashboard', async (req, res) => {
  const tid = req.user.ref_id;
  try {
    const [[{ total_inquiries }]] = await db.query('SELECT COUNT(*) AS total_inquiries FROM INQUIRY WHERE Tenant_ID=?', [tid]);
    const [[{ active_leases }]]   = await db.query("SELECT COUNT(*) AS active_leases FROM LEASE l JOIN TENANT_LEASE tl ON l.Lease_ID=tl.Lease_ID WHERE tl.Tenant_ID=? AND l.End_Date >= CURDATE()", [tid]);
    const [[{ total_paid }]]      = await db.query("SELECT IFNULL(SUM(pay.Amount),0) AS total_paid FROM PAYMENT pay JOIN LEASE l ON pay.Lease_ID=l.Lease_ID JOIN TENANT_LEASE tl ON l.Lease_ID=tl.Lease_ID WHERE tl.Tenant_ID=? AND pay.Status='Success'", [tid]);
    const [[{ open_inquiries }]]  = await db.query("SELECT COUNT(*) AS open_inquiries FROM INQUIRY WHERE Tenant_ID=? AND Status IN ('New','Responded')", [tid]);
    const [[{ pending_sales }]]   = await db.query("SELECT COUNT(*) AS pending_sales FROM SALE WHERE Buyer_Tenant_ID=? AND Sale_Status='Pending_Payment'", [tid]);
    res.json({ total_inquiries, active_leases, total_paid, open_inquiries, pending_sales });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SALE ENDPOINTS (tenant/buyer side) ──────────────────────
// My pending/completed purchases
router.get('/sales', async (req, res) => {
  const tid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT s.*,
             p.Title AS Property_Title, p.Location, p.Type, p.Price,
             a.Name AS Agent_Name, a.Phone AS Agent_Phone,
             TIMESTAMPDIFF(SECOND, s.Created_At, NOW()) AS seconds_elapsed
      FROM SALE s
      JOIN PROPERTY p ON s.Property_ID = p.Property_ID
      LEFT JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Is_Primary = 1
      LEFT JOIN AGENT a    ON pa.Agent_ID    = a.Agent_ID
      WHERE s.Buyer_Tenant_ID = ?
      ORDER BY s.Created_At DESC`, [tid]);
    rows.forEach(r => {
      r.time_remaining_seconds = r.Sale_Status === 'Pending_Payment'
        ? Math.max(0, 10800 - (r.seconds_elapsed || 0))   // 3 hrs = 10800s
        : null;
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pay for a property sale
router.post('/pay-sale', async (req, res) => {
  const { Sale_ID, Amount, Method } = req.body;
  const tid  = req.user.ref_id;
  const conn = await db.getConnection();
  try {
    // Verify ownership and time limit
    const [[sale]] = await conn.query(`
      SELECT s.Sale_ID, s.Property_ID, s.Amount, s.Sale_Status,
             TIMESTAMPDIFF(SECOND, s.Created_At, NOW()) AS seconds_elapsed
      FROM SALE s
      WHERE s.Sale_ID = ? AND s.Buyer_Tenant_ID = ?`, [Sale_ID, tid]);

    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (sale.Sale_Status === 'Completed') return res.status(400).json({ error: 'Payment already completed.' });
    if (sale.Sale_Status === 'Cancelled') return res.status(400).json({ error: 'This sale was cancelled (time expired).' });
    if (sale.seconds_elapsed > 10800)    return res.status(400).json({ error: 'Time limit expired! The sale was cancelled. Property is available again.' });

    await conn.beginTransaction();
    // Update sale: Completed + record method
    await conn.query("UPDATE SALE SET Sale_Status='Completed', Method=? WHERE Sale_ID=?", [Method, Sale_ID]);
    // Set property to Sold (PERMANENT)
    await conn.query("UPDATE PROPERTY SET Status='Sold' WHERE Property_ID=?", [sale.Property_ID]);
    await conn.commit();
    res.json({ message: '✓ Payment successful! The property is now officially Sold. Congratulations!' });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }); }
  finally { conn.release(); }
});

module.exports = router;


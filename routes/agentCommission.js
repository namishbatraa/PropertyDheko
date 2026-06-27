// ============================================================
//  routes/agentCommission.js
//
//  COMMISSION MODEL (v2):
//    - Tenant pays → 100% goes to owner (no deduction).
//    - When a first-lease payment succeeds OR a sale completes,
//      the system creates an AGENT_COMMISSION record:
//        Lease: Amount = ROUND(Lease_Commission_Days/60 * Monthly_Rent, 2)
//        Sale:  Amount = ROUND(Commission_Rate/100 * Sale_Amount, 2)
//    - Owner has 72 hours to mark the commission Paid.
//    - If not paid in time → status auto-flips to Overdue.
// ============================================================
const router = require('express').Router();
const db     = require('../db/connection');

// ─── Timer job: mark overdue commissions ─────────────────────────────────────
// Runs every 5 minutes. Sets Pending → Overdue when Due_By has passed.
async function tickOverdueCommissions() {
  try {
    await db.query(
      "UPDATE AGENT_COMMISSION SET Status='Overdue' WHERE Status='Pending' AND Due_By < NOW()"
    );
  } catch (e) {
    console.error('[commission-timer]', e.message);
  }
}
setInterval(tickOverdueCommissions, 5 * 60 * 1000); // every 5 min
tickOverdueCommissions();                            // run immediately on boot

// ─── Helper: create a commission record ──────────────────────────────────────
async function createCommission(conn, { agentId, propertyId, leaseId, saleId, type, amount }) {
  const dueBy = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
  await conn.query(
    `INSERT INTO AGENT_COMMISSION
       (Agent_ID, Property_ID, Lease_ID, Sale_ID, Commission_Type, Amount, Status, Due_By)
     VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)`,
    [agentId, propertyId, leaseId || null, saleId || null, type, amount, dueBy]
  );
}

// ─── POST /api/agent-commission/lease/:leaseId
//     Called internally when first lease payment succeeds.
//     Creates commission record for PRIMARY agent of that property.
router.post('/lease/:leaseId', async (req, res) => {
  const conn = await db.getConnection();
  try {
    // Get lease + property + primary agent + agent's days setting
    const [[lease]] = await conn.query(`
      SELECT l.Lease_ID, l.Property_ID, l.Monthly_Rent,
             p.first_lease_id, p.Owner_ID,
             pa.Agent_ID,
             a.Lease_Commission_Days
      FROM LEASE l
      JOIN PROPERTY p        ON l.Property_ID = p.Property_ID
      JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Is_Primary = 1
      JOIN AGENT a           ON pa.Agent_ID   = a.Agent_ID
      WHERE l.Lease_ID = ?`, [req.params.leaseId]);

    if (!lease) return res.status(404).json({ error: 'Lease not found.' });

    // Only create commission if this is the first-ever lease for the property
    if (lease.first_lease_id !== lease.Lease_ID) {
      return res.json({ message: 'Not the first lease — no commission created.' });
    }

    // Check if commission already exists (idempotent)
    const [[exists]] = await conn.query(
      "SELECT Commission_ID FROM AGENT_COMMISSION WHERE Lease_ID=? AND Commission_Type='Lease'",
      [lease.Lease_ID]
    );
    if (exists) return res.json({ message: 'Commission already recorded.' });

    const amount = +(lease.Monthly_Rent * lease.Lease_Commission_Days / 60).toFixed(2);
    await conn.beginTransaction();
    await createCommission(conn, {
      agentId:    lease.Agent_ID,
      propertyId: lease.Property_ID,
      leaseId:    lease.Lease_ID,
      type:       'Lease',
      amount,
    });
    await conn.commit();
    res.status(201).json({ message: 'Lease commission created.', amount });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally { conn.release(); }
});

// ─── POST /api/agent-commission/sale/:saleId
//     Called internally when a sale payment completes.
router.post('/sale/:saleId', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [[sale]] = await conn.query(`
      SELECT s.Sale_ID, s.Property_ID, s.Amount AS Sale_Amount,
             pa.Agent_ID,
             a.Commission_Rate
      FROM SALE s
      JOIN PROPERTY_AGENT pa ON s.Property_ID = pa.Property_ID AND pa.Is_Primary = 1
      JOIN AGENT a           ON pa.Agent_ID   = a.Agent_ID
      WHERE s.Sale_ID = ?`, [req.params.saleId]);

    if (!sale) return res.status(404).json({ error: 'Sale not found.' });

    const [[exists]] = await conn.query(
      "SELECT Commission_ID FROM AGENT_COMMISSION WHERE Sale_ID=? AND Commission_Type='Sale'",
      [sale.Sale_ID]
    );
    if (exists) return res.json({ message: 'Commission already recorded.' });

    const amount = +(sale.Sale_Amount * sale.Commission_Rate / 100).toFixed(2);
    await conn.beginTransaction();
    await createCommission(conn, {
      agentId:    sale.Agent_ID,
      propertyId: sale.Property_ID,
      saleId:     sale.Sale_ID,
      type:       'Sale',
      amount,
    });
    await conn.commit();
    res.status(201).json({ message: 'Sale commission created.', amount });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally { conn.release(); }
});

// ─── GET /api/agent-commission/owner
//     Owner sees all commissions they owe to agents (pending/overdue/paid).
router.get('/owner', async (req, res) => {
  const oid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT
        ac.*,
        a.Name           AS Agent_Name,
        a.Phone          AS Agent_Phone,
        p.Title          AS Property_Title,
        TIMESTAMPDIFF(SECOND, NOW(), ac.Due_By) AS seconds_remaining
      FROM AGENT_COMMISSION ac
      JOIN AGENT a    ON ac.Agent_ID    = a.Agent_ID
      JOIN PROPERTY p ON ac.Property_ID = p.Property_ID
      WHERE p.Owner_ID = ?
      ORDER BY FIELD(ac.Status,'Pending','Overdue','Paid'), ac.Due_By ASC`, [oid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PUT /api/agent-commission/:id/pay
//     Owner marks a commission as Paid.
router.put('/:id/pay', async (req, res) => {
  const oid  = req.user.ref_id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Verify the commission belongs to owner's property
    const [[ac]] = await conn.query(`
      SELECT ac.Commission_ID, ac.Status
      FROM AGENT_COMMISSION ac
      JOIN PROPERTY p ON ac.Property_ID = p.Property_ID
      WHERE ac.Commission_ID = ? AND p.Owner_ID = ?
      FOR UPDATE`, [req.params.id, oid]);

    if (!ac) { await conn.rollback(); return res.status(403).json({ error: 'Not found or not yours.' }); }
    if (ac.Status === 'Paid') { await conn.rollback(); return res.json({ message: 'Already paid.' }); }

    await conn.query(
      "UPDATE AGENT_COMMISSION SET Status='Paid', Paid_At=NOW() WHERE Commission_ID=?",
      [req.params.id]
    );
    await conn.commit();
    res.json({ message: 'Commission marked as Paid.' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally { conn.release(); }
});

// ─── GET /api/agent-commission/agent
//     Agent sees all commissions owed to them.
router.get('/agent', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT
        ac.*,
        p.Title           AS Property_Title,
        o.Name            AS Owner_Name,
        o.Phone           AS Owner_Phone,
        TIMESTAMPDIFF(SECOND, NOW(), ac.Due_By) AS seconds_remaining
      FROM AGENT_COMMISSION ac
      JOIN PROPERTY p ON ac.Property_ID = p.Property_ID
      JOIN OWNER o    ON p.Owner_ID     = o.Owner_ID
      WHERE ac.Agent_ID = ?
      ORDER BY FIELD(ac.Status,'Pending','Overdue','Paid'), ac.Due_By ASC`, [aid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/agent-commission/summary/agent
//     Dashboard totals for an agent.
router.get('/summary/agent', async (req, res) => {
  const aid = req.user.ref_id;
  try {
    const [[r]] = await db.query(`
      SELECT
        IFNULL(SUM(CASE WHEN Status='Paid'    THEN Amount ELSE 0 END),0) AS total_paid,
        IFNULL(SUM(CASE WHEN Status='Pending' THEN Amount ELSE 0 END),0) AS total_pending,
        IFNULL(SUM(CASE WHEN Status='Overdue' THEN Amount ELSE 0 END),0) AS total_overdue
      FROM AGENT_COMMISSION
      WHERE Agent_ID = ?`, [aid]);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, createCommission };

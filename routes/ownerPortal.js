// Owner-specific data endpoints
const router = require('express').Router();
const db     = require('../db/connection');

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const oid = req.user.ref_id;
  try {
    const [[{ my_properties }]]  = await db.query('SELECT COUNT(*) AS my_properties FROM PROPERTY WHERE Owner_ID=?', [oid]);
    const [[{ active_leases }]]  = await db.query("SELECT COUNT(*) AS active_leases FROM LEASE l JOIN PROPERTY p ON l.Property_ID=p.Property_ID WHERE p.Owner_ID=? AND l.End_Date>=CURDATE()", [oid]);
    const [[{ open_inquiries }]] = await db.query("SELECT COUNT(*) AS open_inquiries FROM INQUIRY i JOIN PROPERTY p ON i.Property_ID=p.Property_ID WHERE p.Owner_ID=? AND i.Status IN ('New','Responded')", [oid]);
    const [[{ total_revenue }]]  = await db.query("SELECT IFNULL(SUM(pay.Amount),0) AS total_revenue FROM PAYMENT pay JOIN LEASE l ON pay.Lease_ID=l.Lease_ID JOIN PROPERTY p ON l.Property_ID=p.Property_ID WHERE p.Owner_ID=? AND pay.Status='Success'", [oid]);
    const [statusBreakdown]      = await db.query('SELECT Status, COUNT(*) AS count FROM PROPERTY WHERE Owner_ID=? GROUP BY Status', [oid]);
    // Pending commissions owed to agents
    const [[{ pending_commissions, total_agent_dues }]] = await db.query(`
      SELECT COUNT(*) AS pending_commissions,
             IFNULL(SUM(ac.Amount),0) AS total_agent_dues
      FROM AGENT_COMMISSION ac
      JOIN PROPERTY p ON ac.Property_ID = p.Property_ID
      WHERE p.Owner_ID = ? AND ac.Status IN ('Pending','Overdue')`, [oid]);
    res.json({ my_properties, active_leases, open_inquiries, total_revenue, statusBreakdown, pending_commissions, total_agent_dues });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── My properties (with all assigned agents) ─────────────────────────────────
router.get('/properties', async (req, res) => {
  const oid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT
        p.*,
        GROUP_CONCAT(DISTINCT a.Name     ORDER BY pa.Is_Primary DESC, a.Name SEPARATOR ', ') AS Agent_Names,
        GROUP_CONCAT(DISTINCT a.Phone    ORDER BY pa.Is_Primary DESC SEPARATOR ', ') AS Agent_Phones,
        GROUP_CONCAT(DISTINCT a.Agent_ID ORDER BY pa.Is_Primary DESC SEPARATOR ',') AS Agent_IDs,
        (SELECT COUNT(*) FROM INQUIRY i WHERE i.Property_ID=p.Property_ID) AS inquiry_count
      FROM PROPERTY p
      LEFT JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID
      LEFT JOIN AGENT a           ON pa.Agent_ID   = a.Agent_ID
      WHERE p.Owner_ID = ?
      GROUP BY p.Property_ID
      ORDER BY p.Property_ID DESC`, [oid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Assign an agent to one of my properties ──────────────────────────────────
// Uses the sp_assign_agent stored procedure (has FOR UPDATE locking).
router.post('/properties/:id/agents', async (req, res) => {
  const oid = req.user.ref_id;
  const { Agent_ID, Is_Primary } = req.body;
  try {
    // Verify the property belongs to this owner first
    const [[prop]] = await db.query(
      'SELECT Property_ID FROM PROPERTY WHERE Property_ID=? AND Owner_ID=?', [req.params.id, oid]);
    if (!prop) return res.status(403).json({ error: 'Property not found or not yours.' });

    await db.query('CALL sp_assign_agent(?, ?, ?)', [req.params.id, Agent_ID, Is_Primary ? 1 : 0]);
    res.status(201).json({ message: 'Agent assigned.' });
  } catch (e) {
    const status = e.code === 'ER_SIGNAL_EXCEPTION' ? 409 : 500;
    res.status(status).json({ error: e.message });
  }
});

// ─── Remove an agent from one of my properties ────────────────────────────────
router.delete('/properties/:id/agents/:agentId', async (req, res) => {
  const oid = req.user.ref_id;
  try {
    const [[prop]] = await db.query(
      'SELECT Property_ID FROM PROPERTY WHERE Property_ID=? AND Owner_ID=?', [req.params.id, oid]);
    if (!prop) return res.status(403).json({ error: 'Property not found or not yours.' });

    const [result] = await db.query(
      'DELETE FROM PROPERTY_AGENT WHERE Property_ID=? AND Agent_ID=?',
      [req.params.id, req.params.agentId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Agent assignment not found.' });
    res.json({ message: 'Agent removed.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Inquiries on my properties ───────────────────────────────────────────────
router.get('/inquiries', async (req, res) => {
  const oid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT i.*, p.Title AS Property_Title, t.Name AS Tenant_Name, t.Phone AS Tenant_Phone,
             a.Name AS Agent_Name
      FROM INQUIRY i
      JOIN PROPERTY p ON i.Property_ID = p.Property_ID
      JOIN TENANT t   ON i.Tenant_ID   = t.Tenant_ID
      JOIN AGENT a    ON i.Agent_ID    = a.Agent_ID
      WHERE p.Owner_ID = ?
      ORDER BY i.Date DESC`, [oid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Leases on my properties ──────────────────────────────────────────────────
router.get('/leases', async (req, res) => {
  const oid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT l.*, p.Title AS Property_Title,
             GROUP_CONCAT(t.Name SEPARATOR ', ') AS Tenants
      FROM LEASE l
      JOIN PROPERTY p      ON l.Property_ID = p.Property_ID
      LEFT JOIN TENANT_LEASE tl ON l.Lease_ID = tl.Lease_ID
      LEFT JOIN TENANT t        ON tl.Tenant_ID = t.Tenant_ID
      WHERE p.Owner_ID = ?
      GROUP BY l.Lease_ID
      ORDER BY l.Start_Date DESC`, [oid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Payments for my properties ───────────────────────────────────────────────
router.get('/payments', async (req, res) => {
  const oid = req.user.ref_id;
  try {
    const [rows] = await db.query(`
      SELECT pay.*, p.Title AS Property_Title
      FROM PAYMENT pay
      JOIN LEASE l    ON pay.Lease_ID   = l.Lease_ID
      JOIN PROPERTY p ON l.Property_ID  = p.Property_ID
      WHERE p.Owner_ID = ?
      ORDER BY pay.Payment_Date DESC`, [oid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Agent commissions owed by this owner ──────────────────────────────────────
router.get('/commissions', async (req, res) => {
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

// ─── Mark commission as Paid ──────────────────────────────────────────────────
router.put('/commissions/:id/pay', async (req, res) => {
  const oid  = req.user.ref_id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
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
    res.json({ message: '✅ Commission marked as Paid.' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally { conn.release(); }
});

module.exports = router;

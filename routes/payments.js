const router = require('express').Router();
const db = require('../db/connection');
const { createCommission } = require('./agentCommission');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT pay.*, l.Monthly_Rent, p.Title AS Property_Title
      FROM PAYMENT pay
      JOIN LEASE l ON pay.Lease_ID = l.Lease_ID
      JOIN PROPERTY p ON l.Property_ID = p.Property_ID
      ORDER BY pay.Payment_Date DESC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM PAYMENT WHERE Payment_ID=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments  — Record a payment (SYNCHRONIZED)
//
// COMMISSION MODEL (v2):
//   - Full payment amount goes 100% to owner. No deduction.
//   - If payment Status = 'Success' AND it's on the property's first_lease_id,
//     an AGENT_COMMISSION record is created automatically.
//     The owner then has 72 hours to pay the agent separately.
//   - FOR UPDATE lock prevents race with lease cancellation.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { Payment_Date, Amount, Payment_Type, Method, Status, Lease_ID } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // STEP 1: Lock lease row exclusively
    const [leaseRows] = await conn.query(
      'SELECT Lease_ID, Lease_Status FROM LEASE WHERE Lease_ID = ? FOR UPDATE',
      [Lease_ID]
    );
    if (!leaseRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Lease not found.' });
    }
    const leaseStatus = leaseRows[0].Lease_Status;
    if (['Terminated', 'Expired'].includes(leaseStatus)) {
      await conn.rollback();
      return res.status(409).json({
        error: 'Conflict: payment rejected — lease has been cancelled (Terminated or Expired).',
        lease_status: leaseStatus
      });
    }

    // STEP 2: Insert payment — FULL amount, all goes to owner
    const [result] = await conn.query(
      `INSERT INTO PAYMENT (Payment_Date, Amount, Payment_Type, Method, Status, Lease_ID)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [Payment_Date, Amount, Payment_Type || 'Monthly_Rent', Method, Status || 'Pending', Lease_ID]
    );
    await conn.commit();

    // STEP 3: If Success on the first lease → auto-create agent commission record
    if ((Status || 'Pending') === 'Success') {
      try {
        const [[lease]] = await db.query(`
          SELECT l.Lease_ID, l.Property_ID, l.Monthly_Rent, p.first_lease_id,
                 pa.Agent_ID, a.Lease_Commission_Days
          FROM LEASE l
          JOIN PROPERTY p        ON l.Property_ID = p.Property_ID
          JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID AND pa.Is_Primary = 1
          JOIN AGENT a           ON pa.Agent_ID   = a.Agent_ID
          WHERE l.Lease_ID = ?`, [Lease_ID]);

        if (lease && lease.Lease_ID === lease.first_lease_id) {
          const [[exists]] = await db.query(
            "SELECT Commission_ID FROM AGENT_COMMISSION WHERE Lease_ID=? AND Commission_Type='Lease'",
            [Lease_ID]
          );
          if (!exists) {
            const amount = +(lease.Monthly_Rent * lease.Lease_Commission_Days / 60).toFixed(2);
            const commConn = await db.getConnection();
            try {
              await commConn.beginTransaction();
              await createCommission(commConn, {
                agentId:    lease.Agent_ID,
                propertyId: lease.Property_ID,
                leaseId:    lease.Lease_ID,
                type:       'Lease',
                amount,
              });
              await commConn.commit();
              console.log(`[Commission] Lease #${Lease_ID}: ₹${amount} queued for Agent #${lease.Agent_ID}`);
            } finally { commConn.release(); }
          }
        }
      } catch (ce) {
        console.error('[Commission auto-create]', ce.message); // non-fatal
      }
    }

    res.status(201).json({ Payment_ID: result.insertId, message: 'Payment recorded successfully.' });

  } catch (e) {
    await conn.rollback();
    const status = e.code === 'ER_SIGNAL_EXCEPTION' ? 409 : 500;
    res.status(status).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const { Status } = req.body;
  try {
    await db.query('UPDATE PAYMENT SET Status=? WHERE Payment_ID=?', [Status, req.params.id]);
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await db.query('DELETE FROM PAYMENT WHERE Payment_ID=?', [req.params.id]); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

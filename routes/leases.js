const router = require('express').Router();
const db = require('../db/connection');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT l.*, p.Title AS Property_Title,
             GROUP_CONCAT(t.Name SEPARATOR ', ') AS Tenants
      FROM LEASE l
      JOIN PROPERTY p ON l.Property_ID = p.Property_ID
      LEFT JOIN TENANT_LEASE tl ON l.Lease_ID = tl.Lease_ID
      LEFT JOIN TENANT t ON tl.Tenant_ID = t.Tenant_ID
      GROUP BY l.Lease_ID
      ORDER BY l.Start_Date DESC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT l.*, p.Title AS Property_Title
      FROM LEASE l
      JOIN PROPERTY p ON l.Property_ID = p.Property_ID
      WHERE l.Lease_ID=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/leases  — Create a new lease (SYNCHRONIZED, MULTI-AGENT SAFE)
//
// RACE CONDITION SCENARIO (multi-agent):
//   Two agents are both assigned to the same property.
//   Agent A and Agent B both read Property.Status = 'Available' at the same
//   millisecond and both try to create a lease — without locking, BOTH could
//   succeed, leaving the property double-leased.
//
// PREVENTION:
//   1. SELECT ... FOR UPDATE on the PROPERTY row.  The second transaction
//      trying the same row will BLOCK until the first commits or rolls back.
//   2. After the lock is acquired, the live Status is re-read — not a snapshot.
//   3. The BEFORE INSERT trigger also runs a live overlap check inside the
//      same transaction (belt-and-suspenders).
//   4. COMMIT atomically releases the lock.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID, Tenant_ID } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // STEP 1: Acquire exclusive row lock on the property.
    // Any concurrent agent trying to lease or sell this property will block here.
    const [propRows] = await conn.query(
      'SELECT Property_ID, Status FROM PROPERTY WHERE Property_ID = ? FOR UPDATE',
      [Property_ID]
    );

    if (!propRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Property not found.' });
    }

    // STEP 2: Validate status under lock — live read, not snapshot.
    const propStatus = propRows[0].Status;
    if (propStatus === 'Sold') {
      await conn.rollback();
      return res.status(409).json({
        error: 'Conflict: property was marked as Sold before the lease could be created.',
        property_status: propStatus
      });
    }
    if (propStatus === 'Rented') {
      await conn.rollback();
      return res.status(409).json({
        error: 'Conflict: property already has an active lease (Rented).',
        property_status: propStatus
      });
    }
    if (propStatus === 'Pending') {
      await conn.rollback();
      return res.status(409).json({
        error: 'Conflict: another agent is already processing a lease or sale for this property.',
        property_status: propStatus
      });
    }

    // STEP 3: Insert the lease. BEFORE INSERT trigger also validates overlaps.
    const [result] = await conn.query(
      `INSERT INTO LEASE (Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID)
       VALUES (?, ?, ?, ?, ?)`,
      [Start_Date, End_Date, Monthly_Rent, Security_Deposit || 0, Property_ID]
    );
    const leaseId = result.insertId;

    // STEP 4: Link tenant if provided.
    if (Tenant_ID) {
      await conn.query(
        'INSERT INTO TENANT_LEASE (Tenant_ID, Lease_ID) VALUES (?, ?)',
        [Tenant_ID, leaseId]
      );
    }

    // STEP 5: COMMIT — releases the FOR UPDATE lock.
    // The AFTER INSERT trigger fires and sets Property.Status = 'Rented'.
    // trg_lease_after_insert_commission also sets first_lease_id if null.
    await conn.commit();
    res.status(201).json({ Lease_ID: leaseId, message: 'Lease created successfully.' });

  } catch (e) {
    await conn.rollback();
    const status = e.code === 'ER_SIGNAL_EXCEPTION' ? 409 : 500;
    res.status(status).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/leases/:id/cancel  — Terminate a lease (SYNCHRONIZED)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/cancel', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [leaseRows] = await conn.query(
      'SELECT Lease_ID, Lease_Status, Property_ID FROM LEASE WHERE Lease_ID = ? FOR UPDATE',
      [req.params.id]
    );

    if (!leaseRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Lease not found.' });
    }

    const lease = leaseRows[0];
    if (['Terminated', 'Expired'].includes(lease.Lease_Status)) {
      await conn.rollback();
      return res.status(409).json({
        error: `Lease is already ${lease.Lease_Status}.`,
        lease_status: lease.Lease_Status
      });
    }

    await conn.query(
      "UPDATE LEASE SET Lease_Status = 'Terminated' WHERE Lease_ID = ?",
      [lease.Lease_ID]
    );

    await conn.commit();
    res.json({ message: 'Lease terminated. Property is now Available.', Lease_ID: lease.Lease_ID });

  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const { Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID } = req.body;
  try {
    await db.query(
      'UPDATE LEASE SET Start_Date=?,End_Date=?,Monthly_Rent=?,Security_Deposit=?,Property_ID=? WHERE Lease_ID=?',
      [Start_Date, End_Date, Monthly_Rent, Security_Deposit, Property_ID, req.params.id]
    );
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await db.query('DELETE FROM LEASE WHERE Lease_ID=?', [req.params.id]); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

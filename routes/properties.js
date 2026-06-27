const router = require('express').Router();
const db = require('../db/connection');

// ─── GET all properties with all assigned agents ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.*,
        o.Name AS Owner_Name,
        GROUP_CONCAT(
          DISTINCT CONCAT(a.Agent_ID, ':', a.Name, ':', IFNULL(pa.Is_Primary,0))
          ORDER BY pa.Is_Primary DESC, a.Name
          SEPARATOR '|'
        ) AS Agents_Raw,
        GROUP_CONCAT(DISTINCT a.Name ORDER BY pa.Is_Primary DESC, a.Name SEPARATOR ', ') AS Agent_Names,
        GROUP_CONCAT(DISTINCT a.Agent_ID ORDER BY pa.Is_Primary DESC SEPARATOR ',') AS Agent_IDs
      FROM PROPERTY p
      JOIN OWNER o         ON p.Owner_ID   = o.Owner_ID
      LEFT JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID
      LEFT JOIN AGENT a    ON pa.Agent_ID  = a.Agent_ID
      GROUP BY p.Property_ID
      ORDER BY p.Property_ID
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET single property with amenities + assigned agents ─────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.*,
        o.Name AS Owner_Name,
        GROUP_CONCAT(DISTINCT a.Name ORDER BY pa.Is_Primary DESC SEPARATOR ', ') AS Agent_Names,
        GROUP_CONCAT(DISTINCT a.Agent_ID ORDER BY pa.Is_Primary DESC SEPARATOR ',') AS Agent_IDs
      FROM PROPERTY p
      JOIN OWNER o         ON p.Owner_ID   = o.Owner_ID
      LEFT JOIN PROPERTY_AGENT pa ON p.Property_ID = pa.Property_ID
      LEFT JOIN AGENT a    ON pa.Agent_ID  = a.Agent_ID
      WHERE p.Property_ID = ?
      GROUP BY p.Property_ID`, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const [amenities] = await db.query(`
      SELECT am.Amenity_ID, am.Amenity_Name FROM AMENITY am
      JOIN PROPERTY_AMENITY pa ON am.Amenity_ID = pa.Amenity_ID
      WHERE pa.Property_ID = ?`, [req.params.id]);

    res.json({ ...rows[0], amenities });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST — Create property + assign agents (comma-separated Agent_IDs) ───────
// Body: { Title, Type, Location, Price, Status, Owner_ID, Agent_IDs: "1,2,3" }
// First agent in the list becomes Is_Primary = 1.
router.post('/', async (req, res) => {
  const { Title, Type, Location, Price, Status, Owner_ID, Agent_IDs } = req.body;
  const AI_Est_Price = (Price * (0.9 + Math.random() * 0.2)).toFixed(2);

  // Parse agent IDs: accept comma-separated string or array
  const agentIdList = parseAgentIds(Agent_IDs);
  if (!agentIdList.length) {
    return res.status(400).json({ error: 'At least one Agent_ID is required.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      'INSERT INTO PROPERTY (Title,Type,Location,Price,Status,AI_Est_Price,Owner_ID) VALUES(?,?,?,?,?,?,?)',
      [Title, Type, Location, Price, Status || 'Available', AI_Est_Price, Owner_ID]
    );
    const propertyId = result.insertId;

    // Assign agents — first agent is primary
    for (let i = 0; i < agentIdList.length; i++) {
      await conn.query(
        'INSERT INTO PROPERTY_AGENT (Property_ID, Agent_ID, Is_Primary) VALUES (?,?,?)',
        [propertyId, agentIdList[i], i === 0 ? 1 : 0]
      );
    }

    await conn.commit();
    res.status(201).json({ Property_ID: propertyId, AI_Est_Price });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// ─── PUT — Update property details (not agents — use /agents sub-routes) ──────
router.put('/:id', async (req, res) => {
  const { Title, Type, Location, Price, Status, Owner_ID, Agent_IDs } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[current]] = await conn.query(
      'SELECT Status FROM PROPERTY WHERE Property_ID=?', [req.params.id]
    );
    if (!current) { await conn.rollback(); return res.status(404).json({ error: 'Property not found' }); }
    if (current.Status === 'Sold') {
      await conn.rollback();
      return res.status(403).json({ error: 'This property has been sold and cannot be modified.' });
    }

    await conn.query(
      'UPDATE PROPERTY SET Title=?,Type=?,Location=?,Price=?,Status=?,Owner_ID=? WHERE Property_ID=?',
      [Title, Type, Location, Price, Status, Owner_ID, req.params.id]
    );

    // If Agent_IDs supplied, replace the full assignment list
    if (Agent_IDs !== undefined && Agent_IDs !== '') {
      const agentIdList = parseAgentIds(Agent_IDs);
      if (agentIdList.length) {
        await conn.query('DELETE FROM PROPERTY_AGENT WHERE Property_ID=?', [req.params.id]);
        for (let i = 0; i < agentIdList.length; i++) {
          await conn.query(
            'INSERT INTO PROPERTY_AGENT (Property_ID, Agent_ID, Is_Primary) VALUES (?,?,?)',
            [req.params.id, agentIdList[i], i === 0 ? 1 : 0]
          );
        }
      }
    }

    await conn.commit();
    res.json({ message: 'Updated' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// ─── POST /properties/:id/agents — Add single agent via sp_assign_agent ──────
// Uses stored procedure with FOR UPDATE locking (prevents race conditions when
// multiple agents try to claim the same property simultaneously).
router.post('/:id/agents', async (req, res) => {
  const { Agent_ID, Is_Primary } = req.body;
  try {
    await db.query('CALL sp_assign_agent(?, ?, ?)', [req.params.id, Agent_ID, Is_Primary ? 1 : 0]);
    res.status(201).json({ message: 'Agent assigned successfully.' });
  } catch (e) {
    const status = e.code === 'ER_SIGNAL_EXCEPTION' ? 409 : 500;
    res.status(status).json({ error: e.message });
  }
});

// ─── DELETE /properties/:id/agents/:agentId — Remove agent assignment ─────────
router.delete('/:id/agents/:agentId', async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM PROPERTY_AGENT WHERE Property_ID=? AND Agent_ID=?',
      [req.params.id, req.params.agentId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Assignment not found.' });
    res.json({ message: 'Agent removed from property.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /properties/:id/agents — List agents for a property ──────────────────
router.get('/:id/agents', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.Agent_ID, a.Name, a.Phone, a.Commission_Rate, pa.Is_Primary, pa.Assigned_At
      FROM PROPERTY_AGENT pa
      JOIN AGENT a ON pa.Agent_ID = a.Agent_ID
      WHERE pa.Property_ID = ?
      ORDER BY pa.Is_Primary DESC, a.Name`, [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try { await db.query('DELETE FROM PROPERTY WHERE Property_ID=?', [req.params.id]); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function parseAgentIds(raw) {
  if (!raw) return [];
  const ids = Array.isArray(raw) ? raw : String(raw).split(',');
  return ids.map(id => parseInt(String(id).trim(), 10)).filter(id => !isNaN(id) && id > 0);
}

module.exports = router;

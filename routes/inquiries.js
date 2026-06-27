const router = require('express').Router();
const db = require('../db/connection');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT i.*, t.Name AS Tenant_Name, p.Title AS Property_Title, a.Name AS Agent_Name
      FROM INQUIRY i
      JOIN TENANT t ON i.Tenant_ID = t.Tenant_ID
      JOIN PROPERTY p ON i.Property_ID = p.Property_ID
      JOIN AGENT a ON i.Agent_ID = a.Agent_ID
      ORDER BY i.Date DESC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT i.*, t.Name AS Tenant_Name, p.Title AS Property_Title, a.Name AS Agent_Name
      FROM INQUIRY i
      JOIN TENANT t ON i.Tenant_ID = t.Tenant_ID
      JOIN PROPERTY p ON i.Property_ID = p.Property_ID
      JOIN AGENT a ON i.Agent_ID = a.Agent_ID
      WHERE i.Inquiry_ID=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { Message, Date, Status, Tenant_ID, Property_ID, Agent_ID } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO INQUIRY (Message,Date,Status,Tenant_ID,Property_ID,Agent_ID) VALUES(?,?,?,?,?,?)',
      [Message, Date, Status || 'New', Tenant_ID, Property_ID, Agent_ID]
    );
    res.status(201).json({ Inquiry_ID: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { Status } = req.body;
  try {
    await db.query('UPDATE INQUIRY SET Status=? WHERE Inquiry_ID=?', [Status, req.params.id]);
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await db.query('DELETE FROM INQUIRY WHERE Inquiry_ID=?', [req.params.id]); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

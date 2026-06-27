const router = require('express').Router();
const db = require('../db/connection');

// GET all
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM AGENT ORDER BY Agent_ID');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET by id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM AGENT WHERE Agent_ID = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST
router.post('/', async (req, res) => {
  const { Name, Phone, Commission_Rate } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO AGENT (Name, Phone, Commission_Rate) VALUES (?, ?, ?)',
      [Name, Phone, Commission_Rate]
    );
    res.status(201).json({ Agent_ID: result.insertId, Name, Phone, Commission_Rate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT
router.put('/:id', async (req, res) => {
  const { Name, Phone, Commission_Rate } = req.body;
  try {
    await db.query(
      'UPDATE AGENT SET Name=?, Phone=?, Commission_Rate=? WHERE Agent_ID=?',
      [Name, Phone, Commission_Rate, req.params.id]
    );
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM AGENT WHERE Agent_ID = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

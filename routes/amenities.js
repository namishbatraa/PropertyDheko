const router = require('express').Router();
const db = require('../db/connection');

router.get('/', async (req, res) => {
  try { const [r] = await db.query('SELECT * FROM AMENITY ORDER BY Amenity_ID'); res.json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { Amenity_Name } = req.body;
  try {
    const [result] = await db.query('INSERT INTO AMENITY (Amenity_Name) VALUES(?)', [Amenity_Name]);
    res.status(201).json({ Amenity_ID: result.insertId, Amenity_Name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await db.query('DELETE FROM AMENITY WHERE Amenity_ID=?', [req.params.id]); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

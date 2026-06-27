const router = require('express').Router();
const db = require('../db/connection');

router.get('/', async (req, res) => {
  try { const [r] = await db.query('SELECT * FROM TENANT ORDER BY Tenant_ID'); res.json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [r] = await db.query('SELECT * FROM TENANT WHERE Tenant_ID=?', [req.params.id]);
    if (!r.length) return res.status(404).json({ error: 'Not found' });
    res.json(r[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { Name, Phone, Email } = req.body;
  try {
    const [result] = await db.query('INSERT INTO TENANT (Name,Phone,Email) VALUES(?,?,?)', [Name,Phone,Email]);
    res.status(201).json({ Tenant_ID: result.insertId, Name, Phone, Email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { Name, Phone, Email } = req.body;
  try {
    await db.query('UPDATE TENANT SET Name=?,Phone=?,Email=? WHERE Tenant_ID=?', [Name,Phone,Email,req.params.id]);
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await db.query('DELETE FROM TENANT WHERE Tenant_ID=?', [req.params.id]); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

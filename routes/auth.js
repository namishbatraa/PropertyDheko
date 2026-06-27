const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { JWT_SECRET } = require('../middleware/auth');

/* ── REGISTER ─────────────────────────────────────────────
   Body: { username, email, password, role, name, phone, [commission_rate] }
   Creates user in USERS table + corresponding role table row.
*/
router.post('/register', async (req, res) => {
  const { username, email, password, role, name, phone, commission_rate } = req.body;
  if (!['tenant', 'owner', 'agent'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Hash password
    const hash = await bcrypt.hash(password, 10);

    // Insert into role table & get ref_id
    let ref_id;
    if (role === 'tenant') {
      const [r] = await conn.query(
        'INSERT INTO TENANT (Name,Phone,Email) VALUES(?,?,?)', [name, phone, email]);
      ref_id = r.insertId;
    } else if (role === 'owner') {
      const [r] = await conn.query(
        'INSERT INTO OWNER (Name,Phone,Email) VALUES(?,?,?)', [name, phone, email]);
      ref_id = r.insertId;
    } else {
      const rate = parseFloat(commission_rate) || 5.0;
      const [r] = await conn.query(
        'INSERT INTO AGENT (Name,Phone,Commission_Rate) VALUES(?,?,?)', [name, phone, rate]);
      ref_id = r.insertId;
    }

    // Insert into USERS
    await conn.query(
      'INSERT INTO USERS (Username,Email,Password,Role,Ref_ID) VALUES(?,?,?,?,?)',
      [username, email, hash, role, ref_id]
    );

    await conn.commit();
    res.status(201).json({ message: 'Registered successfully' });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Email or username already exists' });
    res.status(500).json({ error: e.message });
  } finally { conn.release(); }
});

/* ── LOGIN ────────────────────────────────────────────────
   Body: { email, password }
   Returns JWT token + user meta
*/
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM USERS WHERE Email=?', [email]);
    if (!rows.length)
      return res.status(401).json({ error: 'Invalid email or password' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.Password);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { user_id: user.User_ID, role: user.Role, ref_id: user.Ref_ID, username: user.Username },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, role: user.Role, ref_id: user.Ref_ID, username: user.Username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── ME ───────────────────────────────────────────────────  */
router.get('/me', require('../middleware/auth').verifyToken, async (req, res) => {
  res.json(req.user);
});

/* ── FORGOT PASSWORD ───────────────────────────────────────
   Body: { email }
   Generates a random 8-char temp password, hashes it, updates USERS,
   and returns it as { tempPassword } so the UI can display it.
*/
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const [rows] = await db.query('SELECT User_ID FROM USERS WHERE Email=?', [email]);
    if (!rows.length)
      return res.status(404).json({ error: 'No account found with that email address' });

    // Generate secure random temp password (8 chars: letters + digits)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let tempPassword = '';
    for (let i = 0; i < 8; i++)
      tempPassword += chars[Math.floor(Math.random() * chars.length)];

    const hash = await bcrypt.hash(tempPassword, 10);
    await db.query('UPDATE USERS SET Password=? WHERE User_ID=?', [hash, rows[0].User_ID]);

    res.json({ tempPassword, message: 'Password reset successfully. Use the temp password to log in and then change it from My Profile.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

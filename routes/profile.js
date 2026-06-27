// ============================================================
//  routes/profile.js — My Profile (GET + PUT + Change Password)
// ============================================================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db     = require('../db/connection');

// Role table mapping
const roleTable = { owner: 'OWNER', agent: 'AGENT', tenant: 'TENANT' };
const rolePK    = { owner: 'Owner_ID', agent: 'Agent_ID', tenant: 'Tenant_ID' };

/* ── GET /api/profile ─────────────────────────────────────── */
router.get('/', async (req, res) => {
  const { role, ref_id, user_id } = req.user;
  try {
    // Fetch from USERS
    const [[user]] = await db.query(
      'SELECT User_ID, Username, Email, Role, Ref_ID FROM USERS WHERE User_ID=?', [user_id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Fetch from role table
    const tbl = roleTable[role];
    const pk  = rolePK[role];
    const [[roleRow]] = await db.query(`SELECT * FROM ${tbl} WHERE ${pk}=?`, [ref_id]);

    res.json({
      user_id:    user.User_ID,
      username:   user.Username,
      email:      user.Email,
      role:       user.Role,
      ref_id:     user.Ref_ID,
      name:       roleRow?.Name    || '',
      phone:      roleRow?.Phone   || '',
      // Agent-only
      commission_rate:         roleRow?.Commission_Rate         ?? null,
      lease_commission_days:   roleRow?.Lease_Commission_Days   ?? null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── PUT /api/profile ─────────────────────────────────────── */
router.put('/', async (req, res) => {
  const { role, ref_id, user_id } = req.user;
  const { name, phone, email, commission_rate, lease_commission_days } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Update USERS email
    if (email) {
      await conn.query('UPDATE USERS SET Email=? WHERE User_ID=?', [email, user_id]);
    }

    // Update role table
    const tbl = roleTable[role];
    const pk  = rolePK[role];

    if (role === 'agent') {
      const days = Math.min(30, Math.max(0, parseInt(lease_commission_days) || 15));
      await conn.query(
        `UPDATE ${tbl} SET Name=?, Phone=?, Commission_Rate=?, Lease_Commission_Days=? WHERE ${pk}=?`,
        [name, phone, parseFloat(commission_rate) || 5.0, days, ref_id]
      );
    } else {
      await conn.query(
        `UPDATE ${tbl} SET Name=?, Phone=?, Email=? WHERE ${pk}=?`,
        [name, phone, email, ref_id]
      );
    }

    await conn.commit();
    res.json({ message: 'Profile updated successfully' });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Email already in use by another account' });
    res.status(500).json({ error: e.message });
  } finally { conn.release(); }
});

/* ── PUT /api/profile/password ────────────────────────────── */
router.put('/password', async (req, res) => {
  const { user_id } = req.user;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both current and new passwords are required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  try {
    const [[user]] = await db.query('SELECT Password FROM USERS WHERE User_ID=?', [user_id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, user.Password);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE USERS SET Password=? WHERE User_ID=?', [hash, user_id]);
    res.json({ message: 'Password changed successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

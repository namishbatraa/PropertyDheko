const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

const { verifyToken, requireRole } = require('./middleware/auth');
const app = express();
app.use(cors());
app.use(express.json());

// ── Auto-expiry job: cancel unpaid leases (2h) and sales (3h) ──
const db = require('./db/connection');
async function runAutoExpiry() {
  try {
    // 1. Expire unpaid leases older than 2 hours
    const [expiredLeases] = await db.query(`
      SELECT l.Lease_ID, l.Property_ID FROM LEASE l
      WHERE l.Lease_Status = 'Pending_Payment'
        AND l.Created_At < DATE_SUB(NOW(), INTERVAL 2 HOUR)`);
    for (const lease of expiredLeases) {
      await db.query("UPDATE LEASE SET Lease_Status='Expired' WHERE Lease_ID=?", [lease.Lease_ID]);
      await db.query('DELETE FROM TENANT_LEASE WHERE Lease_ID=?', [lease.Lease_ID]);
      await db.query("UPDATE PROPERTY SET Status='Available' WHERE Property_ID=?", [lease.Property_ID]);
      console.log(`[Auto-Expiry] Lease #${lease.Lease_ID} expired → Property #${lease.Property_ID} → Available`);
    }
    // 2. Expire pending sales older than 3 hours
    const [expiredSales] = await db.query(`
      SELECT s.Sale_ID, s.Property_ID FROM SALE s
      WHERE s.Sale_Status = 'Pending_Payment'
        AND s.Created_At < DATE_SUB(NOW(), INTERVAL 3 HOUR)`);
    for (const sale of expiredSales) {
      await db.query("UPDATE SALE SET Sale_Status='Cancelled' WHERE Sale_ID=?", [sale.Sale_ID]);
      // Only reset to Available if not already Sold (pay-sale sets Sold atomically)
      await db.query("UPDATE PROPERTY SET Status='Available' WHERE Property_ID=? AND Status != 'Sold'", [sale.Property_ID]);
      console.log(`[Auto-Expiry] Sale #${sale.Sale_ID} cancelled → Property #${sale.Property_ID} → Available`);
    }
  } catch (e) { console.error('[Auto-Expiry] Error:', e.message); }
}
// Run immediately on start, then every 5 minutes
runAutoExpiry();
setInterval(runAutoExpiry, 5 * 60 * 1000);


// ── Serve static frontend ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth (public) ──────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));

// ── Public read routes ─────────────────────────────────────
app.use('/api/properties',  require('./routes/properties'));
app.use('/api/amenities',   require('./routes/amenities'));

// ── Protected routes ───────────────────────────────────────
app.use('/api/agents',    verifyToken, require('./routes/agents'));
app.use('/api/owners',    verifyToken, require('./routes/owners'));
app.use('/api/tenants',   verifyToken, require('./routes/tenants'));
app.use('/api/inquiries', verifyToken, require('./routes/inquiries'));
app.use('/api/leases',    verifyToken, require('./routes/leases'));
app.use('/api/payments',  verifyToken, require('./routes/payments'));
app.use('/api/dashboard', verifyToken, require('./routes/dashboard'));
app.use('/api/profile',   verifyToken, require('./routes/profile'));

// Role-specific data routes
app.use('/api/tenant-portal', verifyToken, requireRole('tenant'), require('./routes/tenantPortal'));
app.use('/api/owner-portal',  verifyToken, requireRole('owner'),  require('./routes/ownerPortal'));
app.use('/api/agent-portal',  verifyToken, requireRole('agent'),  require('./routes/agentPortal'));

// Agent commission — accessible by both owner (pay) and agent (view)
// Timer: auto-marks Pending → Overdue every 5 min (runs inside agentCommission.js)
const { router: commissionRouter } = require('./routes/agentCommission');
app.use('/api/agent-commission', verifyToken, commissionRouter);

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏠  PropVault — Property Management System`);
  console.log(`🚀  Server running → http://localhost:${PORT}\n`);
});

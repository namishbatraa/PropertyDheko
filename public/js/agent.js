// ============================================================
//  Agent Portal Logic
// ============================================================
'use strict';

PAGE_TITLES = {
  dashboard: 'Agent Dashboard', properties: 'Assigned Properties',
  inquiries: 'Inquiry Management', leases: 'Leases', payments: 'Payment Tracking',
  sales: 'Property Sales', commissions: 'My Commissions', profile: 'My Profile'
};
PAGE_ACTIONS = {
  leases: `<button class="action-btn" onclick="document.getElementById('leaseModal').classList.remove('hidden')">+ Create Lease</button>`,
  sales:  `<button class="action-btn" onclick="document.getElementById('saleModal').classList.remove('hidden')">🏠 Create Sale</button>`
};

loadPage = async function(page) {
  try {
    if (page === 'dashboard')   await loadDash();
    if (page === 'properties')  await loadProps();
    if (page === 'inquiries')   await loadInquiries();
    if (page === 'leases')      await loadLeases();
    if (page === 'payments')    await loadPayments();
    if (page === 'sales')       await loadSales();
    if (page === 'commissions') await loadAgentCommissions();
    if (page === 'profile')     await loadProfile();
  } catch (e) { toast(e.message, true); }
};

// Dashboard
async function loadDash() {
  const d = await api('/agent-portal/dashboard');
  if (!d) return;
  renderStats('dashStats', [
    { icon:'🏢', label:'Assigned Properties', value: d.my_properties    },
    { icon:'🔔', label:'New Inquiries',       value: d.new_inquiries    },
    { icon:'📄', label:'Active Leases',       value: d.active_leases   },
    { icon:'⏳', label:'Pending Payments',    value: d.pending_payments },
    { icon:'💰', label:'Commission Earned',   value: '₹'+fmtN(d.commission_earned) },
  ]);
}

// Properties
async function loadProps() {
  const data = await api('/agent-portal/properties');
  if (!data) return;
  renderTable('propsTable',
    ['#','Title','Type','Location','Price','Status','Owner','Inquiries','Amenities'],
    data.map(p => [
      p.Property_ID, p.Title, p.Type, p.Location,
      '₹'+fmtN(p.Price), badge(p.Status),
      `${p.Owner_Name}<br/><span style="font-size:11px;color:var(--muted)">${p.Owner_Phone}</span>`,
      p.inquiry_count,
      `<span style="font-size:11px;color:var(--muted)">${p.Amenities||'—'}</span>`
    ])
  );
}

// Inquiries — with respond buttons
async function loadInquiries() {
  const data = await api('/agent-portal/inquiries');
  if (!data) return;
  renderTable('inquiriesTable',
    ['Inq#','Prop ID','Property','Price','Tenant Name','Tenant ID','Phone','Date','Status','Message','Actions'],
    data.map(i => [
      i.Inquiry_ID,
      `<span style="background:rgba(56,189,248,.15);color:var(--accent3);padding:2px 8px;border-radius:50px;font-size:12px;font-weight:700;">#${i.Property_ID}</span>`,
      i.Property_Title,
      '₹'+fmtN(i.Price),
      i.Tenant_Name,
      `<span style="background:rgba(167,139,250,.18);color:var(--accent2);padding:2px 9px;border-radius:50px;font-size:12px;font-weight:700;">#${i.Tenant_ID}</span>`,
      `${i.Tenant_Phone}<br/><span style="font-size:11px;color:var(--muted)">${i.Tenant_Email}</span>`,
      fmtDate(i.Date), badge(i.Status),
      `<span style="max-width:120px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${i.Message}">${i.Message}</span>`,
      buildInqActions(i)
    ])
  );
}

function buildInqActions(i) {
  let btns = '';
  if (i.Status === 'New')       btns += `<button class="btn-icon btn-respond" onclick="updateInq(${i.Inquiry_ID},'Responded')" title="Mark Responded">✅</button>`;
  if (i.Status === 'Responded') btns += `<button class="btn-icon btn-edit"    onclick="updateInq(${i.Inquiry_ID},'Closed')"    title="Close">🔒</button>`;
  return `<div class="action-btns">${btns}</div>`;
}

async function updateInq(id, status) {
  try {
    await api(`/agent-portal/inquiries/${id}`, 'PUT', { Status: status });
    toast(`✓ Inquiry marked as ${status}`);
    loadInquiries();
  } catch (e) { toast(e.message, true); }
}

// Leases
async function loadLeases() {
  const data = await api('/agent-portal/leases');
  if (!data) return;
  renderTable('leasesTable',
    ['#','Property','Tenants','Start','End','Rent/mo','Deposit','Status','Commission','Actions'],
    data.map(l => [
      l.Lease_ID, l.Property_Title, l.Tenants||'—',
      fmtDate(l.Start_Date), fmtDate(l.End_Date),
      '₹'+fmtN(l.Monthly_Rent), '₹'+fmtN(l.Security_Deposit),
      badge({ Active:'success', Pending_Payment:'pending', Terminated:'sold', Expired:'closed' }[l.Lease_Status] || 'pending'),
      // Commission column: show amount only on the first-lease (commission lease)
      l.Is_Commission_Lease
        ? `<span style="background:rgba(52,211,153,0.15);color:#34d399;padding:2px 10px;border-radius:50px;font-size:12px;font-weight:700;">💰 ₹${fmtN(l.Lease_Commission_Amount)}<br/><span style="font-size:10px;opacity:0.7">${l.Lease_Commission_Days} days</span></span>`
        : `<span style="font-size:12px;color:var(--muted)">—</span>`,
      (l.Lease_Status === 'Active' || l.Lease_Status === 'Pending_Payment')
        ? `<button class="btn-icon btn-del" onclick="terminateLease(${l.Lease_ID})" title="Terminate lease & free property">🚫</button>`
        : '—'
    ])
  );
}

async function terminateLease(id) {
  if (!confirm('⚠️ Terminate this lease? The tenant will be removed and property set to Available.')) return;
  try {
    const r = await api(`/agent-portal/leases/${id}/terminate`, 'POST');
    toast(r.message || '✓ Lease terminated');
    loadLeases();
  } catch (e) { toast(e.message, true); }
}


async function submitLease(e) {
  e.preventDefault();
  const body = {
    Property_ID:     parseInt(document.getElementById('lPropId').value),
    Tenant_ID:       parseInt(document.getElementById('lTenantId').value),
    Start_Date:      document.getElementById('lStart').value,
    End_Date:        document.getElementById('lEnd').value,
    Monthly_Rent:    parseFloat(document.getElementById('lRent').value),
    Security_Deposit:parseFloat(document.getElementById('lDeposit').value) || 0,
  };
  try {
    const r = await api('/agent-portal/leases', 'POST', body);
    toast(`✓ Lease #${r.Lease_ID} created! Tenant has 2 hrs to pay security deposit.`);
    document.getElementById('leaseModal').classList.add('hidden');
    loadLeases();
  } catch (e) { toast(e.message, true); }
}

// Payments
async function loadPayments() {
  const data = await api('/agent-portal/payments');
  if (!data) return;
  renderTable('paymentsTable',
    ['#','Property','Tenants','Date','Amount','Method','Status','Lease Commission'],
    data.map(p => [
      p.Payment_ID, p.Property_Title, p.Tenants||'—',
      fmtDate(p.Payment_Date), '₹'+fmtN(p.Amount), p.Method, badge(p.Status),
      // Show days-based lease commission only on the first-lease payment
      p.Is_Commission_Eligible
        ? `<span style="background:rgba(52,211,153,0.15);color:#34d399;padding:2px 10px;border-radius:50px;font-size:12px;font-weight:700;">💰 ₹${fmtN(p.Commission_Amount)}<br/><span style="font-size:10px;opacity:0.7">${p.Lease_Commission_Days} days × rent</span></span>`
        : `<span style="font-size:12px;color:var(--muted)">—</span>`
    ])
  );
}

navigateTo('dashboard');

// ── Sales ────────────────────────────────────────────────────
let saleCntIntervals = [];
async function loadSales() {
  saleCntIntervals.forEach(clearInterval);
  saleCntIntervals = [];
  const data = await api('/agent-portal/sales');
  if (!data) return;
  if (!data.length) {
    document.getElementById('salesTable').innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted)">No sales yet. Click "🏠 Create Sale" to start.</div>';
    return;
  }
  renderTable('salesTable',
    ['Sale#','Property','Location','Buyer','Buyer Phone','Amount','Status','Time Remaining'],
    data.map(s => [
      s.Sale_ID, s.Property_Title, s.Location,
      `${s.Buyer_Name}<br/><span style="font-size:11px;color:var(--muted)">${s.Buyer_Email}</span>`,
      s.Buyer_Phone,
      '₹'+fmtN(s.Amount),
      badge({ Pending_Payment:'pending', Completed:'success', Cancelled:'sold' }[s.Sale_Status] || 'pending'),
      s.Sale_Status === 'Pending_Payment'
        ? `<span id="scnt-${s.Sale_ID}" style="font-size:13px;font-weight:700;color:#fbbf24;">--:--:--</span>`
        : (s.Sale_Status === 'Completed' ? '✅ Completed' : '❌ Cancelled')
    ])
  );
  // Start countdowns for pending sales
  data.filter(s => s.Sale_Status === 'Pending_Payment').forEach(s => {
    let rem = s.time_remaining_seconds || 0;
    const el = document.getElementById(`scnt-${s.Sale_ID}`);
    function tick() {
      if (!el) return;
      if (rem <= 0) { el.textContent = 'EXPIRED'; el.style.color = 'var(--danger)'; return; }
      const h = Math.floor(rem/3600), m = Math.floor((rem%3600)/60), sec = rem%60;
      el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
      rem--;
    }
    tick();
    saleCntIntervals.push(setInterval(tick, 1000));
  });
}

async function submitSale(e) {
  e.preventDefault();
  const body = {
    Property_ID:     parseInt(document.getElementById('sPropId').value),
    Buyer_Tenant_ID: parseInt(document.getElementById('sBuyerId').value),
    Amount:          parseFloat(document.getElementById('sAmount').value),
  };
  try {
    const r = await api('/agent-portal/sales', 'POST', body);
    toast(r.message || '✓ Sale created! Buyer has 3 hrs to pay.');
    document.getElementById('saleModal').classList.add('hidden');
    loadSales();
  } catch (e) { toast(e.message, true); }
}

// ══════════════════════════════════════════════════════════════
// MY COMMISSIONS — What the owner owes me (separate from rent)
// ══════════════════════════════════════════════════════════════
let _agentCommTimers = [];

async function loadAgentCommissions() {
  const el = document.getElementById('commissionsAgentTable');
  if (!el) return;
  _agentCommTimers.forEach(clearInterval); _agentCommTimers = [];

  const data = await api('/agent-commission/agent');
  if (!data) return;

  if (!data.length) {
    el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted)">No commissions yet. Create a lease or sale to earn commission.</div>';
    return;
  }

  const statusBadge = s => ({
    Pending: '<span class="badge b-pending">⏳ Pending</span>',
    Overdue: '<span class="badge b-sold" style="background:rgba(239,68,68,.2);color:#f87171">⚠️ Overdue</span>',
    Paid:    '<span class="badge b-success">✅ Paid</span>',
  }[s] || s);

  renderTable('commissionsAgentTable',
    ['#','Property','Owner','Type','Amount','Status','Owner Deadline'],
    data.map(c => [
      c.Commission_ID,
      c.Property_Title,
      `${c.Owner_Name}<br/><span style="font-size:11px;color:var(--muted)">${c.Owner_Phone}</span>`,
      `<span style="font-size:12px;font-weight:600;color:var(--accent2)">${c.Commission_Type}</span>`,
      `<span style="font-weight:700;color:#34d399">₹${fmtN(c.Amount)}</span>`,
      statusBadge(c.Status),
      c.Status === 'Paid'
        ? `<span style="color:var(--success)">${fmtDate(c.Paid_At)}</span>`
        : `<span id="actimer-${c.Commission_ID}" style="font-size:13px;font-weight:700;color:${(c.seconds_remaining||0) <= 0 ? '#f87171' : '#fbbf24'}">--:--:--</span>`
    ])
  );

  // Start countdown timers for Pending/Overdue
  data.filter(c => c.Status !== 'Paid').forEach(c => {
    let rem = Math.max(0, c.seconds_remaining || 0);
    const timerEl = document.getElementById(`actimer-${c.Commission_ID}`);
    function tick() {
      if (!timerEl) return;
      if (rem <= 0) { timerEl.textContent = 'OVERDUE'; timerEl.style.color = '#f87171'; return; }
      const h = Math.floor(rem/3600), m = Math.floor((rem%3600)/60), s = rem%60;
      timerEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      rem--;
    }
    tick();
    _agentCommTimers.push(setInterval(tick, 1000));
  });
}

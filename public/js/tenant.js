// ============================================================
//  Tenant Portal Logic
// ============================================================
'use strict';

PAGE_TITLES = {
  dashboard: 'My Dashboard', browse: 'Browse Properties',
  inquiries: 'My Inquiries', lease: 'My Lease', payments: 'Payment History',
  purchases: 'My Property Purchases', profile: 'My Profile'
};
PAGE_ACTIONS = {
  browse: ''
};

let allProps = [];

loadPage = async function(page) {
  try {
    if (page === 'dashboard')  await loadDash();
    if (page === 'browse')     await loadBrowse();
    if (page === 'inquiries')  await loadInquiries();
    if (page === 'lease')      await loadLease();
    if (page === 'payments')   await loadPayments();
    if (page === 'purchases')  await loadPurchases();
    if (page === 'profile')    await loadProfile();
  } catch (e) { toast(e.message, true); }
};

// Dashboard
async function loadDash() {
  const d = await api('/tenant-portal/dashboard');
  if (!d) return;
  renderStats('dashStats', [
    { icon:'💬', label:'Total Inquiries',   value: d.total_inquiries },
    { icon:'📄', label:'Active Leases',     value: d.active_leases   },
    { icon:'🔔', label:'Open Inquiries',    value: d.open_inquiries  },
    { icon:'🏠', label:'Pending Purchases', value: d.pending_sales || 0 },
    { icon:'💰', label:'Total Paid',        value: '₹'+fmtN(d.total_paid) },
  ]);
}

// Browse properties
async function loadBrowse() {
  const data = await api('/properties');
  if (!data) return;
  allProps = data;
  renderPropGrid(allProps);
}

function filterProps() {
  const q   = document.getElementById('browseSearch').value.toLowerCase();
  const typ = document.getElementById('browseType').value;
  const st  = document.getElementById('browseStatus').value;
  const px  = parseInt(document.getElementById('browsePrice').value) || Infinity;
  renderPropGrid(allProps.filter(p =>
    (p.Title.toLowerCase().includes(q) || p.Location.toLowerCase().includes(q)) &&
    (!typ  || p.Type === typ) &&
    (!st   || p.Status === st) &&
    (parseFloat(p.Price) <= px)
  ));
}

function renderPropGrid(props) {
  const grid = document.getElementById('propGrid');
  if (!props.length) { grid.innerHTML = '<div style="color:var(--muted);padding:30px">No properties match your filters.</div>'; return; }
  grid.innerHTML = props.map(p => `
    <div class="prop-card" onclick="showPropDetail(${p.Property_ID})">
      <div class="prop-type">${p.Type}</div>
      <div class="prop-title">${p.Title}</div>
      <div class="prop-loc">📍 ${p.Location}</div>
      <div class="prop-price">₹${fmtN(p.Price)}</div>
      <div class="prop-ai">AI Est: ₹${fmtN(p.AI_Est_Price)}</div>
      <div class="prop-footer">
        ${badge(p.Status)}
        ${p.Status === 'Available' || p.Status === 'Pending'
          ? `<button class="prop-inq-btn" onclick="event.stopPropagation();openInquiryModal(${p.Property_ID},'${p.Title.replace(/'/g,"\\'")}')">Send Inquiry</button>`
          : `<span style="font-size:12px;color:var(--muted)">Not available</span>`}
      </div>
    </div>`).join('');
}

async function showPropDetail(id) {
  try {
    const p = await api(`/properties/${id}`);
    if (!p) return;
    document.getElementById('modalTitle').textContent = p.Title;
    document.getElementById('modalBody').innerHTML = `
      <div class="detail-grid" style="grid-template-columns:repeat(2,1fr);">
        <div class="detail-item"><label>Type</label><p>${p.Type}</p></div>
        <div class="detail-item"><label>Status</label><p>${badge(p.Status)}</p></div>
        <div class="detail-item"><label>Location</label><p>${p.Location}</p></div>
        <div class="detail-item"><label>Price</label><p>₹${fmtN(p.Price)}</p></div>
        <div class="detail-item"><label>AI Est. Price</label><p>₹${fmtN(p.AI_Est_Price)}</p></div>
        <div class="detail-item"><label>Owner</label><p>${p.Owner_Name}</p></div>
        <div class="detail-item"><label>Agent(s)</label><p>${p.Agent_Names || '—'}</p></div>
      </div>
      <div><label style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)">Amenities</label>
        <div class="amenity-pills">${(p.amenities||[]).map(a=>`<span class="amenity-pill">✓ ${a.Amenity_Name}</span>`).join('') || '<span style="color:var(--muted)">None listed</span>'}</div>
      </div>
      ${p.Status==='Available'||p.Status==='Pending'
        ? `<button class="form-submit" onclick="openInquiryModal(${p.Property_ID},'${p.Title.replace(/'/g,"\\'")}')">💬 Send Inquiry</button>` : ''}`;
    document.getElementById('modal').classList.remove('hidden');
  } catch (e) { toast(e.message, true); }
}

// Inquiry modal (inline form)
let inqPropertyId = null;
function openInquiryModal(propId, propTitle) {
  inqPropertyId = propId;
  document.getElementById('modalTitle').textContent = `Send Inquiry — ${propTitle}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Your Message</label>
      <textarea id="inqMsg" rows="4" placeholder="Is this property still available? I'd like to schedule a visit." style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text);padding:10px 13px;border-radius:10px;font-size:13px;resize:vertical;"></textarea>
    </div>
    <button class="form-submit" onclick="submitInquiry()">💬 Submit Inquiry</button>`;
  document.getElementById('modal').classList.remove('hidden');
}

async function submitInquiry() {
  const msg = document.getElementById('inqMsg').value.trim();
  if (!msg) { toast('Please write a message', true); return; }
  try {
    await api('/tenant-portal/inquiries', 'POST', { Property_ID: inqPropertyId, Message: msg });
    toast('✓ Inquiry sent! Agent will respond soon.');
    closeModal();
    navigateTo('inquiries');
  } catch (e) { toast(e.message, true); }
}

// My Inquiries
async function loadInquiries() {
  const data = await api('/tenant-portal/inquiries');
  if (!data) return;
  renderTable('inquiriesTable',
    ['#', 'Property', 'Location', 'Agent', 'Date', 'Status', 'Message'],
    data.map(i => [
      i.Inquiry_ID, i.Property_Title, i.Location,
      `${i.Agent_Name}<br/><span style="font-size:11px;color:var(--muted)">${i.Agent_Phone}</span>`,
      fmtDate(i.Date), badge(i.Status),
      `<span style="max-width:200px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${i.Message}">${i.Message}</span>`
    ])
  );
}

// My Lease — shows countdown + pay form for Pending_Payment leases
let countdownIntervals = [];
async function loadLease() {
  countdownIntervals.forEach(clearInterval);
  countdownIntervals = [];
  const data = await api('/tenant-portal/leases');
  if (!data || !data.length) {
    document.getElementById('leaseContent').innerHTML = `
      <div class="detail-panel" style="text-align:center;padding:40px;">
        <div style="font-size:40px;margin-bottom:12px;">📄</div>
        <div class="detail-title">No Active Lease</div>
        <div class="detail-sub">Once an agent creates a lease for you, it will appear here.</div>
      </div>`;
    return;
  }
  document.getElementById('leaseContent').innerHTML = data.map(l => {
    const isPending     = l.Lease_Status === 'Pending_Payment';
    const isTerminated  = l.Lease_Status === 'Terminated' || l.Lease_Status === 'Expired';
    const statusLabel   = { Active:'active', Pending_Payment:'pending', Terminated:'sold', Expired:'sold' };
    return `
    <div class="detail-panel" style="margin-bottom:16px;" id="lease-panel-${l.Lease_ID}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div class="detail-title">${l.Property_Title}</div>
        ${badge(statusLabel[l.Lease_Status] || 'pending')}
      </div>
      <div class="detail-sub">${l.Type} · ${l.Location}</div>

      ${isPending ? `
        <!-- ⏳ COUNTDOWN TIMER -->
        <div style="margin:18px 0;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:12px;padding:16px;">
          <div style="font-size:12px;font-weight:600;color:#fbbf24;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">⚠️ Security Deposit Required</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Pay your security deposit before time runs out, or the lease will be cancelled automatically.</div>
          <div style="font-size:28px;font-weight:800;color:#fbbf24;font-feature-settings:'tnum';" id="countdown-${l.Lease_ID}">--:--:--</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">time remaining</div>
        </div>
        <!-- 💳 PAY FORM -->
        <div style="background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.2);border-radius:12px;padding:18px;">
          <div style="font-size:13px;font-weight:600;color:var(--success);margin-bottom:14px;">💳 Pay Security Deposit (₹${fmtN(l.Security_Deposit)})</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div class="form-group">
              <label>Amount (₹)</label>
              <input type="number" id="payAmt-${l.Lease_ID}" value="${l.Security_Deposit}" min="1"
                style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text);padding:10px 13px;border-radius:10px;font-size:13px;" />
            </div>
            <div class="form-group">
              <label>Payment Method</label>
              <select id="payMethod-${l.Lease_ID}"
                style="background:#111326;border:1px solid var(--border);color:var(--text);padding:10px 13px;border-radius:10px;font-size:13px;">
                <option>UPI</option><option>NEFT</option><option>IMPS</option>
                <option>Card</option><option>Cash</option><option>Bank Transfer</option>
              </select>
            </div>
          </div>
          <button class="form-submit" onclick="submitSecurityPayment(${l.Lease_ID})">
            💰 Confirm Payment
          </button>
        </div>` : ''}

      <div class="detail-grid" style="margin-top:18px;">
        <div class="detail-item"><label>Start Date</label><p>${fmtDate(l.Start_Date)}</p></div>
        <div class="detail-item"><label>End Date</label><p>${fmtDate(l.End_Date)}</p></div>
        <div class="detail-item"><label>Monthly Rent</label><p>₹${fmtN(l.Monthly_Rent)}</p></div>
        <div class="detail-item"><label>Security Deposit</label><p>₹${fmtN(l.Security_Deposit)}</p></div>
        <div class="detail-item"><label>Agent</label><p>${l.Agent_Name}</p></div>
        <div class="detail-item"><label>Owner</label><p>${l.Owner_Name}</p></div>
      </div>

      ${isTerminated ? `<div style="margin-top:14px;padding:10px 14px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);border-radius:8px;font-size:13px;color:var(--danger);">⚠️ This lease was ${l.Lease_Status.toLowerCase()}. The property is now available again.</div>` : ''}
    </div>`;
  }).join('');

  // Start countdown timers for Pending_Payment leases
  data.filter(l => l.Lease_Status === 'Pending_Payment').forEach(l => {
    let remaining = l.time_remaining_seconds || 0;
    const el = document.getElementById(`countdown-${l.Lease_ID}`);
    function tick() {
      if (!el) return;
      if (remaining <= 0) {
        el.textContent = 'EXPIRED';
        el.style.color = 'var(--danger)';
        loadLease(); // reload to show terminated state
        return;
      }
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      const s = remaining % 60;
      el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      remaining--;
    }
    tick();
    countdownIntervals.push(setInterval(tick, 1000));
  });
}

async function submitSecurityPayment(leaseId) {
  const amount = document.getElementById(`payAmt-${leaseId}`).value;
  const method = document.getElementById(`payMethod-${leaseId}`).value;
  if (!amount || parseFloat(amount) <= 0) { toast('Enter a valid amount', true); return; }
  try {
    const r = await api('/tenant-portal/pay-security', 'POST', { Lease_ID: leaseId, Amount: parseFloat(amount), Method: method });
    toast(r.message || '✓ Payment successful!');
    loadLease(); // refresh to show Active state
  } catch (e) { toast(e.message, true); }
}


// Payments
async function loadPayments() {
  const data = await api('/tenant-portal/payments');
  if (!data) return;
  renderTable('paymentsTable',
    ['#','Property','Date','Amount','Method','Status'],
    data.map(p => [p.Payment_ID, p.Property_Title, fmtDate(p.Payment_Date), '₹'+fmtN(p.Amount), p.Method, badge(p.Status)])
  );
}

// ── My Purchases (Property Sales) ───────────────────────────
let purchaseCntIntervals = [];
async function loadPurchases() {
  purchaseCntIntervals.forEach(clearInterval);
  purchaseCntIntervals = [];
  const data = await api('/tenant-portal/sales');
  if (!data) return;
  const el = document.getElementById('purchasesContent');
  if (!data.length) {
    el.innerHTML = `
      <div class="detail-panel" style="text-align:center;padding:40px;">
        <div style="font-size:40px;margin-bottom:12px;">🏠</div>
        <div class="detail-title">No Purchase Deals</div>
        <div class="detail-sub">When an agent initiates a property sale for you, it will appear here with a payment countdown.</div>
      </div>`;
    return;
  }
  el.innerHTML = data.map(s => {
    const isPending    = s.Sale_Status === 'Pending_Payment';
    const isCompleted  = s.Sale_Status === 'Completed';
    const isCancelled  = s.Sale_Status === 'Cancelled';
    const statusLabel  = { Pending_Payment:'pending', Completed:'success', Cancelled:'sold' };
    return `
    <div class="detail-panel" style="margin-bottom:16px;" id="sale-panel-${s.Sale_ID}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div class="detail-title">${s.Property_Title}</div>
        ${badge(statusLabel[s.Sale_Status] || 'pending')}
      </div>
      <div class="detail-sub">${s.Type} · ${s.Location}</div>

      ${isPending ? `
        <!-- ⏳ COUNTDOWN TIMER -->
        <div style="margin:18px 0;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:12px;padding:16px;">
          <div style="font-size:12px;font-weight:600;color:#fbbf24;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">⚠️ Payment Required Within 3 Hours</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">If not paid in time, the property will be released and your deal will be cancelled.</div>
          <div style="font-size:28px;font-weight:800;color:#fbbf24;font-feature-settings:'tnum';" id="scnt2-${s.Sale_ID}">--:--:--</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">time remaining</div>
        </div>
        <!-- 💰 PAY FORM -->
        <div style="background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.2);border-radius:12px;padding:18px;">
          <div style="font-size:13px;font-weight:600;color:var(--success);margin-bottom:14px;">💰 Pay for Property — ₹${fmtN(s.Amount)}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div class="form-group">
              <label>Amount (₹)</label>
              <input type="number" id="saleAmt-${s.Sale_ID}" value="${s.Amount}" min="1"
                style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text);padding:10px 13px;border-radius:10px;font-size:13px;" />
            </div>
            <div class="form-group">
              <label>Payment Method</label>
              <select id="saleMethod-${s.Sale_ID}"
                style="background:#111326;border:1px solid var(--border);color:var(--text);padding:10px 13px;border-radius:10px;font-size:13px;">
                <option>UPI</option><option>NEFT</option><option>IMPS</option>
                <option>Card</option><option>Cash</option><option>Bank Transfer</option>
              </select>
            </div>
          </div>
          <button class="form-submit" onclick="submitSalePayment(${s.Sale_ID})">
            🏠 Confirm Purchase
          </button>
        </div>` : ''}

      <div class="detail-grid" style="margin-top:18px;">
        <div class="detail-item"><label>Sale Amount</label><p>₹${fmtN(s.Amount)}</p></div>
        <div class="detail-item"><label>Property Type</label><p>${s.Type}</p></div>
        <div class="detail-item"><label>Agent</label><p>${s.Agent_Name}</p></div>
        <div class="detail-item"><label>Agent Phone</label><p>${s.Agent_Phone}</p></div>
        <div class="detail-item"><label>Initiation Date</label><p>${fmtDate(s.Created_At)}</p></div>
        ${s.Method ? `<div class="detail-item"><label>Payment Method</label><p>${s.Method}</p></div>` : ''}
      </div>

      ${isCompleted ? `<div style="margin-top:14px;padding:12px 16px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);border-radius:8px;font-size:13px;color:var(--success);">🎉 Purchase complete! This property is now officially yours (Sold).</div>` : ''}
      ${isCancelled ? `<div style="margin-top:14px;padding:12px 16px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);border-radius:8px;font-size:13px;color:var(--danger);">⚠️ This deal was cancelled (time expired). Contact the agent to restart.</div>` : ''}
    </div>`;
  }).join('');

  // Start countdown timers
  data.filter(s => s.Sale_Status === 'Pending_Payment').forEach(s => {
    let remaining = s.time_remaining_seconds || 0;
    const el2 = document.getElementById(`scnt2-${s.Sale_ID}`);
    function tick() {
      if (!el2) return;
      if (remaining <= 0) {
        el2.textContent = 'EXPIRED';
        el2.style.color = 'var(--danger)';
        loadPurchases();
        return;
      }
      const h = Math.floor(remaining/3600), m = Math.floor((remaining%3600)/60), sec = remaining%60;
      el2.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
      remaining--;
    }
    tick();
    purchaseCntIntervals.push(setInterval(tick, 1000));
  });
}

async function submitSalePayment(saleId) {
  const amount = document.getElementById(`saleAmt-${saleId}`).value;
  const method = document.getElementById(`saleMethod-${saleId}`).value;
  if (!amount || parseFloat(amount) <= 0) { toast('Enter a valid amount', true); return; }
  try {
    const r = await api('/tenant-portal/pay-sale', 'POST', { Sale_ID: saleId, Amount: parseFloat(amount), Method: method });
    toast(r.message || '✓ Purchase payment successful!');
    loadPurchases();
  } catch (e) { toast(e.message, true); }
}

// init
navigateTo('dashboard');


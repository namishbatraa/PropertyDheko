/* ============================================================
   PropVault — Main Application JS (SPA)
   ============================================================ */
'use strict';

const API = '/api';

// ── State ──────────────────────────────────────────────────
let currentPage = 'dashboard';
let allData = {};       // cache per page
let editingId = null;

// ── DOM refs ───────────────────────────────────────────────
const pageTitle = document.getElementById('pageTitle');
const addBtn    = document.getElementById('addBtn');
const modal     = document.getElementById('modal');
const modalTitle= document.getElementById('modalTitle');
const modalForm = document.getElementById('modalForm');
const toast     = document.getElementById('toast');
const menuBtn   = document.getElementById('menuBtn');
const sidebar   = document.getElementById('sidebar');

// ── Routing ────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(link.dataset.page);
    sidebar.classList.remove('open');
  });
});

menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  pageTitle.textContent = pageMeta[page]?.title || page;
  addBtn.style.display  = pageMeta[page]?.addable ? 'block' : 'none';
  loadPage(page);
}

// ── Page configs ───────────────────────────────────────────
const pageMeta = {
  dashboard:  { title: 'Dashboard'   },
  properties: { title: 'Properties',  addable: true, endpoint: 'properties' },
  agents:     { title: 'Agents',      addable: true, endpoint: 'agents'     },
  owners:     { title: 'Owners',      addable: true, endpoint: 'owners'     },
  tenants:    { title: 'Tenants',     addable: true, endpoint: 'tenants'    },
  inquiries:  { title: 'Inquiries',   addable: true, endpoint: 'inquiries'  },
  leases:     { title: 'Leases',      addable: true, endpoint: 'leases'     },
  payments:   { title: 'Payments',    addable: true, endpoint: 'payments'   },
};

// ── Load page ──────────────────────────────────────────────
async function loadPage(page) {
  if (page === 'dashboard') { await loadDashboard(); return; }
  const meta = pageMeta[page];
  if (!meta?.endpoint) return;
  try {
    const data = await apiFetch(`/${meta.endpoint}`);
    allData[page] = data;
    renderTable(page, data);
  } catch (e) { showToast(e.message, true); }
}

// ── Dashboard ──────────────────────────────────────────────
async function loadDashboard() {
  const d = await apiFetch('/dashboard');
  const STATS = [
    { icon:'🏢', label:'Total Properties', value: d.total_properties },
    { icon:'🤝', label:'Total Agents',     value: d.total_agents     },
    { icon:'🔑', label:'Tenants',          value: d.total_tenants    },
    { icon:'👤', label:'Owners',           value: d.total_owners     },
    { icon:'📄', label:'Active Leases',    value: d.active_leases    },
    { icon:'💬', label:'Open Inquiries',   value: d.open_inquiries   },
    { icon:'✅', label:'Available Props',  value: d.available_props  },
    { icon:'💰', label:'Total Revenue',    value: '₹' + fmtN(d.total_revenue) },
  ];
  document.getElementById('statsGrid').innerHTML = STATS.map(s => `
    <div class="stat-card glass-card">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');

  // Donut chart
  renderDonut(d.statusBreakdown);

  // Agent bar chart
  renderBars(d.topAgents);

  // Recent payments
  document.getElementById('recentPayments').innerHTML =
    `<div class="payment-list">${d.recentPayments.map(p => `
      <div class="payment-row">
        <div class="payment-info">
          <div class="payment-prop">${p.Property_Title}</div>
          <div class="payment-date">${fmtDate(p.Payment_Date)} · ${p.Method}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="badge badge-${p.Status.toLowerCase()}">${p.Status}</span>
          <span class="payment-amount">₹${fmtN(p.Amount)}</span>
        </div>
      </div>`).join('')}</div>`;
}

function renderDonut(data) {
  const COLORS = ['#6c63ff','#38bdf8','#f87171','#fbbf24'];
  const total  = data.reduce((s, d) => s + d.count, 0);
  let offset   = 0;
  const r = 60, cx = 80, cy = 80, circ = 2 * Math.PI * r;
  const slices = data.map((d, i) => {
    const pct = d.count / total;
    const dash = pct * circ;
    const slice = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${COLORS[i % COLORS.length]}" stroke-width="22"
      stroke-dasharray="${dash} ${circ}"
      stroke-dashoffset="${-offset * circ}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += pct;
    return { slice, color: COLORS[i % COLORS.length], label: d.Status, count: d.count };
  });
  document.getElementById('statusChart').innerHTML = `
    <svg class="donut-svg" width="160" height="160" viewBox="0 0 160 160">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="22"/>
      ${slices.map(s => s.slice).join('')}
      <text x="${cx}" y="${cy+5}" text-anchor="middle" fill="#e2e8f0" font-size="18" font-weight="700">${total}</text>
    </svg>
    <div class="donut-legend">
      ${slices.map(s => `<div class="legend-item">
        <div class="legend-dot" style="background:${s.color}"></div>
        <span style="color:var(--text-muted)">${s.label}</span>
        <span style="margin-left:auto;font-weight:600">${s.count}</span>
      </div>`).join('')}
    </div>`;
}

function renderBars(agents) {
  const max = Math.max(...agents.map(a => a.property_count), 1);
  document.getElementById('agentBars').innerHTML = `
    <div class="bar-container">
      ${agents.map(a => `
        <div class="bar-row">
          <div class="bar-label" title="${a.Name}">${a.Name}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(a.property_count/max)*100}%"></div>
          </div>
          <div class="bar-count">${a.property_count}</div>
        </div>`).join('')}
    </div>`;
}

// ── Table Rendering ────────────────────────────────────────
const colDefs = {
  properties: {
    cols: ['ID','Title','Type','Location','Price','AI Est.','Status','Owner','Agents','Actions'],
    row: d => [
      d.Property_ID, d.Title, d.Type, d.Location,
      '₹'+fmtN(d.Price), '₹'+fmtN(d.AI_Est_Price),
      badge(d.Status), d.Owner_Name,
      `<span title="${d.Agent_IDs||''}">` + (d.Agent_Names || '—') + '</span>',
      actions(d.Property_ID, 'properties')
    ]
  },
  agents: {
    cols: ['ID','Name','Phone','Commission %','Actions'],
    row: d => [d.Agent_ID, d.Name, d.Phone, d.Commission_Rate+'%', actions(d.Agent_ID, 'agents')]
  },
  owners: {
    cols: ['ID','Name','Phone','Email','Actions'],
    row: d => [d.Owner_ID, d.Name, d.Phone, d.Email, actions(d.Owner_ID, 'owners')]
  },
  tenants: {
    cols: ['ID','Name','Phone','Email','Actions'],
    row: d => [d.Tenant_ID, d.Name, d.Phone, d.Email, actions(d.Tenant_ID, 'tenants')]
  },
  inquiries: {
    cols: ['ID','Property','Tenant','Agent','Date','Status','Actions'],
    row: d => [d.Inquiry_ID, d.Property_Title, d.Tenant_Name, d.Agent_Name, fmtDate(d.Date), badge(d.Status), actions(d.Inquiry_ID,'inquiries')]
  },
  leases: {
    cols: ['ID','Property','Tenants','Start','End','Rent/mo','Deposit','Actions'],
    row: d => [d.Lease_ID, d.Property_Title, d.Tenants||'—', fmtDate(d.Start_Date), fmtDate(d.End_Date), '₹'+fmtN(d.Monthly_Rent), '₹'+fmtN(d.Security_Deposit), actions(d.Lease_ID,'leases')]
  },
  payments: {
    cols: ['ID','Property','Date','Amount','Method','Status','Actions'],
    row: d => [d.Payment_ID, d.Property_Title, fmtDate(d.Payment_Date), '₹'+fmtN(d.Amount), d.Method, badge(d.Status), actions(d.Payment_ID,'payments')]
  },
};

function renderTable(page, data) {
  const def = colDefs[page];
  if (!def) return;
  const el = document.getElementById(`${page}Table`);
  if (!data.length) { el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">No records found.</div>'; return; }
  el.innerHTML = `
    <table class="data-table">
      <thead><tr>${def.cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${data.map(d=>`<tr>${def.row(d).map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function badge(status) {
  return `<span class="badge badge-${status.toLowerCase()}">${status}</span>`;
}
function actions(id, page) {
  return `<div class="action-btns">
    <button class="btn-icon btn-edit"   onclick="startEdit('${page}',${id})">✏️</button>
    <button class="btn-icon btn-delete" onclick="deleteRecord('${page}',${id})">🗑️</button>
  </div>`;
}

// ── Search / Filter ────────────────────────────────────────
document.getElementById('searchProperties')?.addEventListener('input', filterProperties);
document.getElementById('filterStatus')?.addEventListener('change', filterProperties);

function filterProperties() {
  const q   = document.getElementById('searchProperties').value.toLowerCase();
  const st  = document.getElementById('filterStatus').value;
  const dat = (allData.properties || []).filter(p =>
    (p.Title.toLowerCase().includes(q) || p.Location.toLowerCase().includes(q)) &&
    (!st || p.Status === st)
  );
  renderTable('properties', dat);
}

// ── Modal Forms ────────────────────────────────────────────
const formDefs = {
  properties: {
    title: 'Property',
    fields: [
      { name:'Title',    label:'Title',       type:'text',   required:true },
      { name:'Type',     label:'Type',        type:'select', options:['Apartment','Villa','Studio','Penthouse','Bungalow','Cottage','Office','Warehouse'] },
      { name:'Location', label:'Location',    type:'text',   required:true },
      { name:'Price',    label:'Price (₹)',   type:'number', required:true },
      { name:'Status',   label:'Status',      type:'select', options:['Available','Rented','Sold','Pending'] },
      { name:'Owner_ID', label:'Owner ID',    type:'number', required:true },
      { name:'Agent_IDs',label:'Agent IDs (comma-separated, first = primary)', type:'text', required:true, placeholder:'e.g. 1,2,3' },
    ]
  },
  agents: {
    title: 'Agent',
    fields: [
      { name:'Name',            label:'Full Name',       type:'text',   required:true },
      { name:'Phone',           label:'Phone',           type:'text',   required:true },
      { name:'Commission_Rate', label:'Commission Rate %', type:'number', required:true },
    ]
  },
  owners: {
    title: 'Owner',
    fields: [
      { name:'Name',  label:'Full Name', type:'text',  required:true },
      { name:'Phone', label:'Phone',     type:'text',  required:true },
      { name:'Email', label:'Email',     type:'email', required:true },
    ]
  },
  tenants: {
    title: 'Tenant',
    fields: [
      { name:'Name',  label:'Full Name', type:'text',  required:true },
      { name:'Phone', label:'Phone',     type:'text',  required:true },
      { name:'Email', label:'Email',     type:'email', required:true },
    ]
  },
  inquiries: {
    title: 'Inquiry',
    fields: [
      { name:'Tenant_ID',   label:'Tenant ID',   type:'number', required:true },
      { name:'Property_ID', label:'Property ID', type:'number', required:true },
      { name:'Agent_ID',    label:'Agent ID',    type:'number', required:true },
      { name:'Date',        label:'Date',        type:'date',   required:true },
      { name:'Status',      label:'Status',      type:'select', options:['New','Responded','Closed'] },
      { name:'Message',     label:'Message',     type:'textarea'},
    ]
  },
  leases: {
    title: 'Lease',
    fields: [
      { name:'Property_ID',     label:'Property ID',      type:'number', required:true },
      { name:'Tenant_ID',       label:'Tenant ID',        type:'number', required:true },
      { name:'Start_Date',      label:'Start Date',       type:'date',   required:true },
      { name:'End_Date',        label:'End Date',         type:'date',   required:true },
      { name:'Monthly_Rent',    label:'Monthly Rent (₹)', type:'number', required:true },
      { name:'Security_Deposit',label:'Security Deposit', type:'number' },
    ]
  },
  payments: {
    title: 'Payment',
    fields: [
      { name:'Lease_ID',     label:'Lease ID',     type:'number', required:true },
      { name:'Payment_Date', label:'Payment Date', type:'date',   required:true },
      { name:'Amount',       label:'Amount (₹)',   type:'number', required:true },
      { name:'Method',       label:'Method',       type:'select', options:['UPI','NEFT','IMPS','Cheque','Cash','Bank Transfer','Card'] },
      { name:'Status',       label:'Status',       type:'select', options:['Pending','Success','Failed'] },
    ]
  },
};

addBtn.addEventListener('click', () => openModal(currentPage));

function openModal(page, data = null) {
  const def = formDefs[page];
  if (!def) return;
  editingId = data ? (data[Object.keys(data)[0]]) : null;
  modalTitle.textContent = (data ? 'Edit ' : 'Add ') + def.title;
  modalForm.innerHTML = def.fields.map(f => {
    let input;
    // For properties Agent_IDs field: populate from Agent_IDs CSV returned by API
    let val = data?.[f.name] ?? '';
    if (page === 'properties' && f.name === 'Agent_IDs' && data?.Agent_IDs) {
      val = data.Agent_IDs;  // already comma-separated from API
    }
    if (f.type === 'select') {
      input = `<select name="${f.name}" ${f.required?'required':''}>${f.options.map(o=>`<option value="${o}" ${o===val?'selected':''}>${o}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}" rows="3">${val}</textarea>`;
    } else {
      const ph = f.placeholder ? `placeholder="${f.placeholder}"` : '';
      input = `<input type="${f.type}" name="${f.name}" value="${val}" ${f.required?'required':''} ${ph} />`;
    }
    return `<div class="form-group"><label>${f.label}</label>${input}</div>`;
  }).join('') + `<button type="submit" class="form-submit">💾 Save</button>`;

  modalForm.onsubmit = e => { e.preventDefault(); submitForm(page); };
  modal.classList.remove('hidden');
}

document.getElementById('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
function closeModal() { modal.classList.add('hidden'); editingId = null; }

async function submitForm(page) {
  const fd   = new FormData(modalForm);
  const body = Object.fromEntries(fd.entries());
  try {
    if (editingId) {
      await apiFetch(`/${pageMeta[page].endpoint}/${editingId}`, 'PUT', body);
      showToast('Updated successfully ✓');
    } else {
      await apiFetch(`/${pageMeta[page].endpoint}`, 'POST', body);
      showToast('Created successfully ✓');
    }
    closeModal();
    loadPage(page);
  } catch (e) { showToast(e.message, true); }
}

// ── Edit / Delete ──────────────────────────────────────────
async function startEdit(page, id) {
  try {
    const data = await apiFetch(`/${pageMeta[page].endpoint}/${id}`);
    openModal(page, data);
  } catch (e) { showToast(e.message, true); }
}

async function deleteRecord(page, id) {
  if (!confirm('Delete this record?')) return;
  try {
    await apiFetch(`/${pageMeta[page].endpoint}/${id}`, 'DELETE');
    showToast('Deleted ✓');
    loadPage(page);
  } catch (e) { showToast(e.message, true); }
}

// expose globally for inline onclick
window.startEdit     = startEdit;
window.deleteRecord  = deleteRecord;

// ── API Helper ─────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className   = 'toast' + (isError ? ' error' : '');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── Formatters ─────────────────────────────────────────────
function fmtN(n)    { return Number(n).toLocaleString('en-IN'); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }

// ── Init ───────────────────────────────────────────────────
navigateTo('dashboard');

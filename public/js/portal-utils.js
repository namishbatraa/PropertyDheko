// ============================================================
//  PropVault Portal Utilities (shared across all 3 portals)
// ============================================================
'use strict';

// ── Auth guard ──────────────────────────────────────────────
const TOKEN    = localStorage.getItem('pv_token');
const ROLE     = localStorage.getItem('pv_role');
const REF_ID   = parseInt(localStorage.getItem('pv_ref_id'));
const USERNAME = localStorage.getItem('pv_username');

if (!TOKEN) window.location.href = '/';

// ── Set sidebar user info ───────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const uEl = document.getElementById('sbUsername');
  const aEl = document.getElementById('sbAvatar');
  const idLabels = { tenant: 'Tenant ID', owner: 'Owner ID', agent: 'Agent ID' };
  if (uEl) uEl.innerHTML = `
    <span style="display:block;font-weight:600">${USERNAME || 'User'}</span>
    <span style="font-size:11px;color:var(--muted)">${idLabels[ROLE] || 'ID'}: <span style="color:var(--accent2);font-weight:700">#${REF_ID}</span></span>`;
  if (aEl) aEl.textContent = (USERNAME || 'U')[0].toUpperCase();
  // Mobile sidebar
  const menuBtn = document.getElementById('menuBtn');
  const sidebar  = document.getElementById('sidebar');
  if (menuBtn && sidebar) menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
  // Nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
      sidebar.classList.remove('open');
    });
  });
});

// ── Navigation ──────────────────────────────────────────────
let currentPage = '';
function navigateTo(page) {
  if (currentPage === page) return;
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.remove('hidden');
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;
  // Update topbar actions
  const acts = document.getElementById('topbarActions');
  if (acts) acts.innerHTML = PAGE_ACTIONS[page] || '';
  loadPage(page);
}
// These maps are defined in each portal's own JS file
var PAGE_TITLES  = {};
var PAGE_ACTIONS = {};
function loadPage(page) {}   // overridden per portal

// ── API helper ──────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) { logout(); return null; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ── Logout ──────────────────────────────────────────────────
function logout() {
  localStorage.removeItem('pv_token');
  localStorage.removeItem('pv_role');
  localStorage.removeItem('pv_ref_id');
  localStorage.removeItem('pv_username');
  window.location.href = '/';
}

// ── Toast ───────────────────────────────────────────────────
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast' + (isErr ? ' err' : '');
  setTimeout(() => t.classList.add('hidden'), 3200);
}

// ── Modal ───────────────────────────────────────────────────
function closeModal() { document.getElementById('modal').classList.add('hidden'); }

// ── Formatters ──────────────────────────────────────────────
function fmtN(n)    { return Number(n).toLocaleString('en-IN'); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }
function badge(st)  {
  const map = {
    available:'b-available', rented:'b-rented', sold:'b-sold', pending:'b-pending',
    new:'b-new', responded:'b-responded', closed:'b-closed',
    success:'b-success', failed:'b-failed',
  };
  const cls = map[st?.toLowerCase()] || '';
  return `<span class="badge ${cls}">${st}</span>`;
}

// ── Generic table renderer ──────────────────────────────────
function renderTable(containerId, headers, rows) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted)">No records found.</div>'; return; }
  el.innerHTML = `<table class="data-table">
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

// ── Stats grid ──────────────────────────────────────────────
function renderStats(containerId, stats) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = stats.map((s, i) => `
    <div class="stat-card sc${(i%5)+1}">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');
}

// ── MY PROFILE ──────────────────────────────────────────────
let _profileData = null;

async function loadProfile() {
  const el = document.getElementById('profileContent');
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">Loading profile…</div>';
  try {
    _profileData = await api('/profile');
    if (!_profileData) return;
    renderProfilePage(_profileData);
  } catch (e) { el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger)">${e.message}</div>`; }
}

function renderProfilePage(p) {
  const el = document.getElementById('profileContent');
  if (!el) return;
  const roleIcons = { owner:'🏠', agent:'🤝', tenant:'🔑' };
  const roleColors = { owner:'var(--accent3)', agent:'var(--accent4)', tenant:'var(--success)' };
  const initial = (p.name || p.username || 'U')[0].toUpperCase();
  const isAgent = p.role === 'agent';

  el.innerHTML = `
    <!-- Profile Header -->
    <div class="profile-header">
      <div class="profile-avatar-wrap">
        <div class="profile-avatar">${initial}</div>
      </div>
      <div class="profile-meta">
        <div class="profile-name">${p.name || p.username}</div>
        <div class="profile-email">${p.email}</div>
        <div class="profile-role-badge">
          ${roleIcons[p.role] || '👤'} ${p.role.charAt(0).toUpperCase()+p.role.slice(1)}
          &nbsp;·&nbsp; ID #${p.ref_id}
        </div>
      </div>
    </div>

    <!-- Edit Info Card -->
    <div class="profile-card">
      <div class="profile-card-title">✏️ Personal Information</div>
      <div class="profile-inline-msg" id="profileMsg"></div>
      <form class="profile-form" onsubmit="saveProfile(event)">
        <div class="form-row">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="pName" value="${p.name || ''}" placeholder="Your full name" required />
          </div>
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="pUsername" value="${p.username || ''}" readonly style="opacity:0.45;cursor:not-allowed" title="Username cannot be changed" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="pEmail" value="${p.email || ''}" required />
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input type="text" id="pPhone" value="${p.phone || ''}" placeholder="Phone number" />
          </div>
        </div>
        ${isAgent ? `
        <div class="form-row" style="align-items:flex-start">
          <div class="form-group" style="max-width:220px">
            <label>Sale Commission Rate (%)</label>
            <input type="number" id="pCommission" value="${p.commission_rate ?? 5.0}" min="0" max="25" step="0.5" />
            <div style="font-size:11px;color:var(--muted);margin-top:4px">Earned as % of property sale price</div>
          </div>
          <div class="form-group">
            <label>Lease Commission Days &nbsp;<span style="color:var(--accent2);font-weight:700" id="pDaysDisplay">${p.lease_commission_days ?? 15}</span> days</label>
            <input type="range" id="pLeaseDays" min="0" max="60" value="${p.lease_commission_days ?? 15}" step="1"
              oninput="document.getElementById('pDaysDisplay').textContent=this.value"
              style="width:100%;accent-color:var(--accent2);cursor:pointer;margin-top:6px" />
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:2px"><span>0 days</span><span>60 days</span></div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px">Days of monthly rent earned <strong>once</strong> on first lease — e.g. 30 days = half a month's rent (30/60)</div>
          </div>
        </div>` : ''}
        <button type="submit" class="profile-save-btn" id="profileSaveBtn">💾 Save Changes</button>
      </form>
    </div>

    <!-- Change Password Card -->
    <div class="profile-card">
      <div class="profile-card-title">🔒 Change Password</div>
      <div class="profile-inline-msg" id="pwdMsg"></div>
      <form class="profile-form" onsubmit="changePassword(event)">
        <div class="form-group">
          <label>Current Password</label>
          <input type="password" id="pPwdCurrent" placeholder="Enter current password" required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>New Password</label>
            <input type="password" id="pPwdNew" placeholder="Min 6 characters" required minlength="6" />
          </div>
          <div class="form-group">
            <label>Confirm New Password</label>
            <input type="password" id="pPwdConfirm" placeholder="Repeat new password" required minlength="6" />
          </div>
        </div>
        <button type="submit" class="profile-save-btn" id="pwdSaveBtn">🔑 Update Password</button>
      </form>
    </div>`;
}

async function saveProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('profileSaveBtn');
  const msg = document.getElementById('profileMsg');
  btn.disabled = true; btn.textContent = 'Saving…';
  msg.className = 'profile-inline-msg';

  const body = {
    name:  document.getElementById('pName').value.trim(),
    email: document.getElementById('pEmail').value.trim(),
    phone: document.getElementById('pPhone').value.trim(),
  };
  const comm = document.getElementById('pCommission');
  if (comm) body.commission_rate = parseFloat(comm.value) || 5.0;
  const ldays = document.getElementById('pLeaseDays');
  if (ldays) body.lease_commission_days = parseInt(ldays.value);

  try {
    await api('/profile', 'PUT', body);
    msg.className = 'profile-inline-msg success';
    msg.textContent = '✓ Profile updated successfully!';
    toast('✓ Profile updated');
    // Refresh header
    if (_profileData) { _profileData = { ..._profileData, ...body }; renderProfilePage(_profileData); }
  } catch (err) {
    msg.className = 'profile-inline-msg error';
    msg.textContent = '✗ ' + err.message;
  } finally { btn.disabled = false; btn.textContent = '💾 Save Changes'; }
}

async function changePassword(e) {
  e.preventDefault();
  const btn = document.getElementById('pwdSaveBtn');
  const msg = document.getElementById('pwdMsg');
  btn.disabled = true; btn.textContent = 'Updating…';
  msg.className = 'profile-inline-msg';

  const currentPassword = document.getElementById('pPwdCurrent').value;
  const newPassword     = document.getElementById('pPwdNew').value;
  const confirm         = document.getElementById('pPwdConfirm').value;

  if (newPassword !== confirm) {
    msg.className = 'profile-inline-msg error';
    msg.textContent = '✗ New passwords do not match';
    btn.disabled = false; btn.textContent = '🔑 Update Password';
    return;
  }

  try {
    await api('/profile/password', 'PUT', { currentPassword, newPassword });
    msg.className = 'profile-inline-msg success';
    msg.textContent = '✓ Password updated! Please remember your new password.';
    toast('✓ Password changed');
    document.getElementById('pPwdCurrent').value = '';
    document.getElementById('pPwdNew').value = '';
    document.getElementById('pPwdConfirm').value = '';
  } catch (err) {
    msg.className = 'profile-inline-msg error';
    msg.textContent = '✗ ' + err.message;
  } finally { btn.disabled = false; btn.textContent = '🔑 Update Password'; }
}


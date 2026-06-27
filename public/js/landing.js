// ============================================================
//  PropVault Landing — Auth + Role Logic
// ============================================================
let selectedRole = null;
const ROLE_ICONS  = { tenant: '🔑', owner: '👤', agent: '🤝' };
const ROLE_LABELS = { tenant: 'Tenant', owner: 'Owner', agent: 'Agent' };

function selectRole(role) {
  selectedRole = role;
  document.getElementById('authRoleIcon').textContent = ROLE_ICONS[role];
  document.getElementById('authTitle').textContent = `${ROLE_LABELS[role]} Login`;
  // Show agent-only fields only for agents
  document.getElementById('agentFields').style.display = role === 'agent' ? 'block' : 'none';
  document.getElementById('authOverlay').classList.remove('hidden');
  switchTab('login');
}

function closeAuth() {
  document.getElementById('authOverlay').classList.add('hidden');
}

function switchTab(tab) {
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab !== 'login');
  document.getElementById('authTitle').textContent =
    `${ROLE_LABELS[selectedRole]} ${tab === 'login' ? 'Login' : 'Register'}`;
}

// ── Login ───────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn   = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  btn.textContent = 'Logging in…';
  btn.disabled = true;
  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:    document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value,
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    if (data.role !== selectedRole) throw new Error(`This account is registered as a ${data.role}, not ${selectedRole}.`);
    localStorage.setItem('pv_token',    data.token);
    localStorage.setItem('pv_role',     data.role);
    localStorage.setItem('pv_ref_id',   data.ref_id);
    localStorage.setItem('pv_username', data.username);
    window.location.href = `/${data.role}.html`;
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.textContent = 'Login →';
    btn.disabled = false;
  }
});

// ── Register ────────────────────────────────────────────────
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn   = document.getElementById('registerBtn');
  const errEl = document.getElementById('registerError');
  errEl.classList.add('hidden');
  btn.textContent = 'Creating account…';
  btn.disabled = true;
  try {
    const body = {
      username:        document.getElementById('regUsername').value,
      email:           document.getElementById('regEmail').value,
      password:        document.getElementById('regPassword').value,
      name:            document.getElementById('regName').value,
      phone:           document.getElementById('regPhone').value,
      role:                   selectedRole,
      commission_rate:        document.getElementById('regCommission').value || 5,
      lease_commission_days:  parseInt(document.getElementById('regLeaseDays')?.value || 15),
    };
    const res  = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    // Auto-login after register
    errEl.style.background = 'rgba(52,211,153,0.15)';
    errEl.style.borderColor = 'rgba(52,211,153,0.3)';
    errEl.style.color = '#34d399';
    errEl.textContent = '✓ Account created! Logging you in…';
    errEl.classList.remove('hidden');
    // Now login
    setTimeout(async () => {
      const res2 = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: body.email, password: body.password })
      });
      const d2 = await res2.json();
      localStorage.setItem('pv_token',    d2.token);
      localStorage.setItem('pv_role',     d2.role);
      localStorage.setItem('pv_ref_id',   d2.ref_id);
      localStorage.setItem('pv_username', d2.username);
      window.location.href = `/${d2.role}.html`;
    }, 1000);
  } catch (err) {
    errEl.style = '';
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.textContent = 'Create Account →';
    btn.disabled = false;
  }
});

// If already logged in, skip to portal
const existingToken = localStorage.getItem('pv_token');
const existingRole  = localStorage.getItem('pv_role');
if (existingToken && existingRole) {
  const goBtn = document.createElement('a');
  goBtn.href  = `/${existingRole}.html`;
  goBtn.className = 'nav-link';
  goBtn.textContent = `↩ Back to Portal`;
  document.querySelector('.nav-links').appendChild(goBtn);
}

// Close overlay on outside click
document.getElementById('authOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeAuth();
});

// ── Forgot Password ─────────────────────────────────────────
function showForgotForm() {
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('forgotForm').classList.remove('hidden');
  document.getElementById('authTitle').textContent = 'Reset Password';
  document.getElementById('forgotResult').style.display = 'none';
  document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value || '';
}

function hideForgotForm() {
  document.getElementById('forgotForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('authTitle').textContent = `${ROLE_LABELS[selectedRole]} Login`;
}

async function forgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const btn   = document.getElementById('forgotBtn');
  const res   = document.getElementById('forgotResult');
  if (!email) { res.style.display='block'; res.style.background='rgba(239,68,68,0.1)'; res.style.borderColor='rgba(239,68,68,0.3)'; res.style.color='#fca5a5'; res.innerHTML='Please enter your email'; return; }

  btn.disabled = true; btn.textContent = 'Generating…';
  res.style.display = 'none';

  try {
    const r = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Reset failed');

    res.style.display = 'block';
    res.style.background = 'rgba(52,211,153,0.1)';
    res.style.borderColor = 'rgba(52,211,153,0.3)';
    res.style.color = '#e2e8f0';
    res.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:#34d399;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">✓ Password Reset</div>
      <div style="font-size:13px;margin-bottom:10px;color:#94a3b8;">Your temporary password is:</div>
      <div style="font-family:'Orbitron',monospace;font-size:20px;font-weight:700;color:#c4b5fd;letter-spacing:3px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.25);border-radius:8px;padding:10px 16px;text-align:center;cursor:pointer;" onclick="navigator.clipboard.writeText('${data.tempPassword}');this.textContent='✓ Copied!';setTimeout(()=>this.textContent='${data.tempPassword}',1500);" title="Click to copy">${data.tempPassword}</div>
      <div style="font-size:11px;color:#64748b;margin-top:8px;">💡 Click the password to copy it. Login and then go to <strong style="color:#a78bfa">My Profile → Change Password</strong>.</div>`;
  } catch (err) {
    res.style.display = 'block';
    res.style.background = 'rgba(239,68,68,0.1)';
    res.style.borderColor = 'rgba(239,68,68,0.3)';
    res.style.color = '#fca5a5';
    res.innerHTML = '✗ ' + err.message;
  } finally { btn.disabled = false; btn.textContent = '🔑 Reset Password'; }
}


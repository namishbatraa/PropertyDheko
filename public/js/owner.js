// ============================================================
//  Owner Portal Logic — 3D Space Theme
// ============================================================
'use strict';

PAGE_TITLES = {
  dashboard: 'Owner Dashboard', properties: 'My Properties',
  inquiries: 'Inquiries', leases: 'Lease Overview', payments: 'Payment History',
  commissions: 'Agent Commissions', profile: 'My Profile'
};
PAGE_ACTIONS = {
  properties: `<button class="action-btn" onclick="openAddProp()">＋ Add Property</button>`
};

let allMyProps = [];
let editPropId = null;

loadPage = async function(page) {
  try {
    if (page === 'dashboard')   await loadDash();
    if (page === 'properties')  await loadMyProps();
    if (page === 'inquiries')   await loadInquiries();
    if (page === 'leases')      await loadLeases();
    if (page === 'payments')    await loadPayments();
    if (page === 'commissions') await loadCommissions();
    if (page === 'profile')     await loadProfile();
  } catch (e) { toast(e.message, true); }
};

// Dashboard
async function loadDash() {
  const d = await api('/owner-portal/dashboard');
  if (!d) return;
  renderStats('dashStats', [
    { icon:'🏢', label:'My Properties',               value: d.my_properties  },
    { icon:'📄', label:'Active Leases',               value: d.active_leases  },
    { icon:'💬', label:'Open Inquiries',              value: d.open_inquiries },
    { icon:'💰', label:'Total Revenue (Full)',         value: '₹'+fmtN(d.total_revenue) },
    { icon:'⚠️', label:'Agent Dues Pending',          value: d.pending_commissions
        ? `<span style="color:#fbbf24;font-weight:700">${d.pending_commissions} (₹${fmtN(d.total_agent_dues)})</span>`
        : '<span style="color:var(--success)">None ✓</span>' },
  ]);
  // Status breakdown
  if (d.statusBreakdown?.length) {
    const COLORS = { Available:'#34d399', Rented:'#38bdf8', Sold:'#f87171', Pending:'#fbbf24' };
    const total  = d.statusBreakdown.reduce((s,x) => s+x.count, 0);
    document.getElementById('dashStatusChart').innerHTML = `
      <div class="glass-card" style="padding:22px;margin-top:0;">
        <div class="stat-label" style="margin-bottom:14px">Property Status Breakdown</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${d.statusBreakdown.map(s => `
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="width:90px;font-size:13px;color:var(--muted)">${s.Status}</span>
              <div style="flex:1;height:10px;background:rgba(255,255,255,.07);border-radius:5px;overflow:hidden;">
                <div style="width:${Math.round((s.count/total)*100)}%;height:100%;background:${COLORS[s.Status]||'#6c63ff'};border-radius:5px;"></div>
              </div>
              <span style="font-size:13px;font-weight:600;width:25px">${s.count}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }
}

// My properties
async function loadMyProps() {
  const data = await api('/owner-portal/properties');
  if (!data) return;
  allMyProps = data;
  renderMyPropsTable(allMyProps);
}

function filterMyProps() {
  const q  = document.getElementById('propSearch').value.toLowerCase();
  const st = document.getElementById('propStatusFilter').value;
  renderMyPropsTable(allMyProps.filter(p =>
    (p.Title.toLowerCase().includes(q) || p.Location.toLowerCase().includes(q)) && (!st || p.Status===st)
  ));
}

function renderMyPropsTable(data) {
  renderTable('propsTable',
    ['#','Title','Type','Location','Price','AI Est.','Status','Agents','Inquiries','Actions'],
    data.map(p => [
      p.Property_ID, p.Title, p.Type, p.Location,
      '₹'+fmtN(p.Price), '₹'+fmtN(p.AI_Est_Price),
      badge(p.Status),
      `<span title="IDs: ${p.Agent_IDs||''}">${p.Agent_Names || '—'}</span>`,
      p.inquiry_count || 0,
      p.Status === 'Sold'
        // Sold: show permanent lock, no edit
        ? `<span style="font-size:11px;color:var(--danger);font-weight:600;">🔒 Sold (Locked)</span>`
        : `<div class="action-btns">
            <button class="btn-icon btn-edit" onclick="editProp(${p.Property_ID})" title="Edit">✏️</button>
           </div>`
    ])
  );
}

// Add property modal
let agentMapLoaded = false;
function openAddProp() {
  editPropId = null;
  agentMapLoaded = false;
  document.getElementById('modalTitle').textContent = 'Add New Property';
  ['propTitle','propLoc','propPrice','propAmenities'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('propAgentId').value = '';
  // Reset agent map panel
  const panel = document.getElementById('agentMapPanel');
  if (panel) panel.classList.add('hidden');
  const body = document.getElementById('agentMapBody');
  if (body) body.innerHTML = '<div class="agent-map-loading">Scanning agents…</div>';
  document.getElementById('modal').classList.remove('hidden');
}

// Toggle agent mapping table
async function toggleAgentMap() {
  const panel = document.getElementById('agentMapPanel');
  const runBtn = document.getElementById('runBtn');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (!isHidden) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  if (agentMapLoaded) return;
  try {
    runBtn && (runBtn.style.opacity = '0.6');
    const agents = await api('/agents');
    agentMapLoaded = true;
    renderAgentMap(agents || []);
  } catch(e) {
    document.getElementById('agentMapBody').innerHTML =
      `<div style="padding:14px;color:var(--danger);font-size:13px;">⚠ ${e.message}</div>`;
  } finally {
    runBtn && (runBtn.style.opacity = '1');
  }
}

function renderAgentMap(agents) {
  const body = document.getElementById('agentMapBody');
  if (!body) return;
  if (!agents.length) {
    body.innerHTML = '<div style="padding:14px;text-align:center;color:var(--muted);font-size:13px;">No agents found.</div>';
    return;
  }
  body.innerHTML = `
    <table class="agent-map-table">
      <thead><tr>
        <th>#</th>
        <th>Agent Name</th>
        <th>Ref ID (Agent_ID)</th>
        <th>Phone</th>
        <th>Commission</th>
      </tr></thead>
      <tbody>
        ${agents.map(a => `
          <tr onclick="selectAgent(${a.Agent_ID})" title="Click to assign Agent ${a.Agent_ID}">
            <td>${a.Agent_ID}</td>
            <td><strong>${a.Name}</strong></td>
            <td><span class="agent-id-badge">#${a.Agent_ID}</span></td>
            <td>${a.Phone || '—'}</td>
            <td>${a.Commission_Rate != null ? a.Commission_Rate + '%' : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// Clicking a row in the agent directory APPENDS the agent ID to the comma list
function selectAgent(agentId) {
  const input = document.getElementById('propAgentId');
  const current = input.value.split(',').map(s => s.trim()).filter(Boolean);
  const idStr = String(agentId);
  if (!current.includes(idStr)) {
    current.push(idStr);
    input.value = current.join(',');
    toast('✓ Agent #' + agentId + ' added (total: ' + current.length + ')');
  } else {
    toast('Agent #' + agentId + ' already in list', true);
  }
  // Keep panel open so user can add more agents
}

async function editProp(id) {
  try {
    const p = await api(`/properties/${id}`);
    if (!p) return;
    if (p.Status === 'Sold') {
      toast('🔒 This property has been sold and cannot be edited.', true);
      return;
    }
    editPropId = id;
    agentMapLoaded = false;
    document.getElementById('modalTitle').textContent = 'Edit Property';
    document.getElementById('propTitle').value      = p.Title;
    document.getElementById('propType').value       = p.Type;
    document.getElementById('propLoc').value        = p.Location;
    document.getElementById('propPrice').value      = p.Price;
    document.getElementById('propStatus').value     = p.Status;
    // Populate comma-separated Agent IDs
    document.getElementById('propAgentId').value    = p.Agent_IDs || '';
    // Reset agent map panel
    const panel = document.getElementById('agentMapPanel');
    if (panel) panel.classList.add('hidden');
    const body = document.getElementById('agentMapBody');
    if (body) body.innerHTML = '<div class="agent-map-loading">Scanning agents…</div>';
    document.getElementById('modal').classList.remove('hidden');
  } catch (e) { toast(e.message, true); }
}

async function submitProp(e) {
  e.preventDefault();
  const body = {
    Title:     document.getElementById('propTitle').value,
    Type:      document.getElementById('propType').value,
    Location:  document.getElementById('propLoc').value,
    Price:     document.getElementById('propPrice').value,
    Status:    document.getElementById('propStatus').value,
    Owner_ID:  REF_ID,
    Agent_IDs: document.getElementById('propAgentId').value,  // comma-separated
  };
  try {
    if (editPropId) {
      await api(`/properties/${editPropId}`, 'PUT', body);
      toast('✓ Property updated');
    } else {
      const r = await api('/properties', 'POST', body);
      toast(`✓ Property added! AI Est: ₹${fmtN(r?.AI_Est_Price)}`);
    }
    closeModal();
    loadMyProps();
  } catch (e) { toast(e.message, true); }
}

// Inquiries on my properties
async function loadInquiries() {
  const data = await api('/owner-portal/inquiries');
  if (!data) return;
  renderTable('inquiriesTable',
    ['#','Property','Tenant','Phone','Agent','Date','Status','Message'],
    data.map(i => [
      i.Inquiry_ID, i.Property_Title,
      i.Tenant_Name, i.Tenant_Phone, i.Agent_Name,
      fmtDate(i.Date), badge(i.Status),
      `<span style="max-width:180px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${i.Message}">${i.Message}</span>`
    ])
  );
}

// Leases
async function loadLeases() {
  const data = await api('/owner-portal/leases');
  if (!data) return;
  renderTable('leasesTable',
    ['#','Property','Tenants','Start','End','Rent/mo','Deposit'],
    data.map(l => [
      l.Lease_ID, l.Property_Title, l.Tenants||'—',
      fmtDate(l.Start_Date), fmtDate(l.End_Date),
      '₹'+fmtN(l.Monthly_Rent), '₹'+fmtN(l.Security_Deposit)
    ])
  );
}

// Payments
async function loadPayments() {
  const data = await api('/owner-portal/payments');
  if (!data) return;
  renderTable('paymentsTable',
    ['#','Property','Date','Amount','Method','Status'],
    data.map(p => [p.Payment_ID, p.Property_Title, fmtDate(p.Payment_Date), '₹'+fmtN(p.Amount), p.Method, badge(p.Status)])
  );
}

navigateTo('dashboard');

// ── Metaverse Universe Engine (Portal) ─────────────────────
(function initMetaversePortal() {
  const sc = document.getElementById('spaceCanvas');
  const cc = document.getElementById('portalCometCanvas');
  if (!sc) return;
  const sctx = sc.getContext('2d');
  const cctx = cc ? cc.getContext('2d') : null;

  let W, H;
  function resize() {
    W = sc.width  = window.innerWidth;
    H = sc.height = window.innerHeight;
    if (cc) { cc.width = W; cc.height = H; }
  }
  window.addEventListener('resize', resize);
  resize();

  const rand = (a,b) => Math.random()*(b-a)+a;
  const lerp = (a,b,t) => a+(b-a)*t;

  // Mouse
  let mx = W/2, my = H/2, tmx = mx, tmy = my;
  document.addEventListener('mousemove', e => { tmx = e.clientX; tmy = e.clientY; });

  // Star layers
  const layers = [[], [], []];
  const counts  = [130, 60, 20];
  const speeds  = [0.04, 0.09, 0.18];
  for (let l=0; l<3; l++) {
    for (let i=0; i<counts[l]; i++) {
      layers[l].push({
        x: rand(0,W), y: rand(0,H),
        r: rand(0.3, 0.7+l*0.6),
        spd: rand(0.04,0.12)+l*0.05,
        op: rand(0.25,0.85),
        hue: [260,190,40,320,220][Math.floor(rand(0,5))],
        bk: rand(0.004,0.015),
        ph: rand(0, Math.PI*2)
      });
    }
  }

  // Galaxy spiral
  const spiral = [];
  const ARMS = 3, SARM = 70;
  for (let a=0; a<ARMS; a++) {
    const off = (a/ARMS)*Math.PI*2;
    for (let i=0; i<SARM; i++) {
      const t2 = i/SARM;
      const ang = off + t2 * Math.PI * 3.2;
      const dist = t2 * Math.min(W,H) * 0.22;
      const sp = dist * 0.13;
      spiral.push({
        ox: rand(-sp,sp), oy: rand(-sp,sp),
        ang, dist,
        r: rand(0.3, 1.1),
        hue: a===0 ? 260 : a===1 ? 190 : 40,
        op: rand(0.15,0.55) * (1-t2*0.5)
      });
    }
  }
  let galAngle = 0;
  const GX = 0.78, GY = 0.62; // bottom-right quadrant

  // Constellation pairs
  let constPairs = [];
  function buildConst() {
    constPairs = [];
    const pool = layers[0].filter(s => s.op > 0.55).slice(0,35);
    for (let g=0; g<4; g++) {
      const n = Math.floor(rand(3,5));
      const grp = [];
      for (let i=0; i<n; i++) grp.push(pool[Math.floor(rand(0,pool.length))]);
      for (let i=0; i<grp.length-1; i++) constPairs.push([grp[i], grp[i+1]]);
    }
  }
  buildConst();
  window.addEventListener('resize', buildConst);

  // Shooting stars
  let shooters = [];
  function spawnShooter() {
    const hues = [260,190,40,0,300];
    shooters.push({
      x: rand(-W*0.1, W*1.1), y: rand(0, H*0.5),
      len: rand(90,200), spd: rand(8,15),
      angle: Math.PI/5 + rand(-0.4,0.4),
      op: 1, hue: hues[Math.floor(rand(0,hues.length))],
      w: rand(1,2.2)
    });
  }
  setInterval(spawnShooter, 2600);

  // Comet trail
  let trail = [];
  const MAX_T = 22;

  let t = 0;
  function draw() {
    t += 0.016;
    galAngle += 0.0004;
    mx = lerp(mx, tmx, 0.06);
    my = lerp(my, tmy, 0.06);

    sctx.clearRect(0,0,W,H);

    // Galaxy
    const gx=GX*W, gy=GY*H;
    spiral.forEach(s => {
      const ang = s.ang + galAngle;
      const x = gx + Math.cos(ang)*s.dist + s.ox;
      const y = gy + Math.sin(ang)*s.dist*0.42 + s.oy;
      const al = s.op * (0.45+0.55*Math.sin(t*1.8+s.ang));
      sctx.beginPath(); sctx.arc(x,y,s.r,0,Math.PI*2);
      sctx.fillStyle=`hsla(${s.hue},80%,85%,${al})`; sctx.fill();
    });
    // Galaxy core glow
    const gg = sctx.createRadialGradient(gx,gy,0,gx,gy,70);
    gg.addColorStop(0,'rgba(167,139,250,0.2)');
    gg.addColorStop(0.4,'rgba(124,58,237,0.06)');
    gg.addColorStop(1,'transparent');
    sctx.beginPath(); sctx.arc(gx,gy,70,0,Math.PI*2);
    sctx.fillStyle=gg; sctx.fill();

    // Constellations
    constPairs.forEach(([a,b]) => {
      const dx=a.x-b.x, dy=a.y-b.y;
      if (Math.sqrt(dx*dx+dy*dy) > W*0.28) return;
      sctx.beginPath(); sctx.moveTo(a.x,a.y); sctx.lineTo(b.x,b.y);
      sctx.strokeStyle=`rgba(167,139,250,${0.03+0.03*Math.sin(t+a.ph)})`;
      sctx.lineWidth=0.6; sctx.stroke();
    });

    // Stars with parallax
    layers.forEach((layer,li) => {
      const f = speeds[li];
      const ox=(mx/W-0.5)*-f*55, oy=(my/H-0.5)*-f*38;
      layer.forEach(s => {
        const al = s.op * (0.5+0.5*Math.sin(t*s.bk*60+s.ph));
        sctx.beginPath(); sctx.arc(s.x+ox, s.y+oy, s.r, 0, Math.PI*2);
        sctx.fillStyle=`hsla(${s.hue},70%,90%,${al})`; sctx.fill();
        s.y -= s.spd;
        if (s.y < -3) { s.y=H+3; s.x=rand(0,W); }
      });
    });

    // Shooting stars
    shooters = shooters.filter(s=>s.op>0.02);
    shooters.forEach(s => {
      const ex=s.x+Math.cos(s.angle)*s.len, ey=s.y+Math.sin(s.angle)*s.len;
      const g=sctx.createLinearGradient(s.x,s.y,ex,ey);
      g.addColorStop(0,`hsla(${s.hue},80%,98%,${s.op})`);
      g.addColorStop(0.5,`hsla(${s.hue},60%,85%,${s.op*0.3})`);
      g.addColorStop(1,'hsla(0,0%,100%,0)');
      sctx.beginPath(); sctx.moveTo(s.x,s.y); sctx.lineTo(ex,ey);
      sctx.strokeStyle=g; sctx.lineWidth=s.w; sctx.stroke();
      // Sparkle head
      const hg=sctx.createRadialGradient(s.x,s.y,0,s.x,s.y,3.5);
      hg.addColorStop(0,`hsla(${s.hue},100%,100%,${s.op})`);
      hg.addColorStop(1,'transparent');
      sctx.beginPath(); sctx.arc(s.x,s.y,3.5,0,Math.PI*2);
      sctx.fillStyle=hg; sctx.fill();
      s.x+=Math.cos(s.angle)*s.spd; s.y+=Math.sin(s.angle)*s.spd;
      s.op-=0.013;
    });

    // Comet trail
    if (cctx) {
      trail.push({ x:mx, y:my, hue: 250+Math.sin(t)*80 });
      if (trail.length > MAX_T) trail.shift();
      cctx.clearRect(0,0,W,H);
      trail.forEach((p,i) => {
        const frac = i/trail.length;
        const al = frac * 0.45;
        const r  = frac * 5.5;
        if (r < 0.2 || al < 0.01) return;
        const g = cctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
        g.addColorStop(0,`hsla(${p.hue},80%,85%,${al})`);
        g.addColorStop(1,'transparent');
        cctx.beginPath(); cctx.arc(p.x,p.y,r,0,Math.PI*2);
        cctx.fillStyle=g; cctx.fill();
      });
      // Cursor glow
      const cg=cctx.createRadialGradient(mx,my,0,mx,my,14);
      cg.addColorStop(0,'rgba(167,139,250,0.3)');
      cg.addColorStop(0.5,'rgba(34,211,238,0.1)');
      cg.addColorStop(1,'transparent');
      cctx.beginPath(); cctx.arc(mx,my,14,0,Math.PI*2);
      cctx.fillStyle=cg; cctx.fill();
    }

    requestAnimationFrame(draw);
  }
  draw();
})();

// ══════════════════════════════════════════════════════════════
// AGENT COMMISSIONS — Owner pays agent separately (72-hr timer)
// Full rent goes to owner → owner owes commission to agent.
// ══════════════════════════════════════════════════════════════
let _commTimers = [];

async function loadCommissions() {
  const el = document.getElementById('commissionsTable');
  if (!el) return;
  _commTimers.forEach(clearInterval); _commTimers = [];
  el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted)">Loading…</div>';

  const data = await api('/owner-portal/commissions');
  if (!data) return;

  if (!data.length) {
    el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--success)">✅ No pending commissions. All agents have been paid!</div>';
    return;
  }

  const statusBadge = s => ({
    Pending: '<span class="badge b-pending">Pending</span>',
    Overdue: '<span class="badge b-sold" style="background:rgba(239,68,68,.2);color:#f87171">⚠️ Overdue</span>',
    Paid:    '<span class="badge b-success">Paid</span>',
  }[s] || s);

  renderTable('commissionsTable',
    ['#','Property','Agent','Type','Amount','Status','Time Remaining','Action'],
    data.map(c => [
      c.Commission_ID,
      c.Property_Title,
      `${c.Agent_Name}<br/><span style="font-size:11px;color:var(--muted)">${c.Agent_Phone}</span>`,
      `<span style="font-size:12px;font-weight:600;color:var(--accent2)">${c.Commission_Type}</span>`,
      `<span style="font-weight:700;color:#34d399">₹${fmtN(c.Amount)}</span>`,
      statusBadge(c.Status),
      // Timer cell
      c.Status === 'Paid'
        ? '—'
        : `<span id="ctimer-${c.Commission_ID}" style="font-size:13px;font-weight:700;color:${c.seconds_remaining <= 0 ? '#f87171' : '#fbbf24'}">--:--:--</span>`,
      // Pay button
      c.Status !== 'Paid'
        ? `<button class="btn-icon btn-respond" onclick="payCommission(${c.Commission_ID})" title="Mark as Paid to agent">💸 Pay</button>`
        : '<span style="color:var(--success);font-size:13px">✓ Done</span>'
    ])
  );

  // Start countdown timers
  data.filter(c => c.Status !== 'Paid').forEach(c => {
    let rem = Math.max(0, c.seconds_remaining || 0);
    const el = document.getElementById(`ctimer-${c.Commission_ID}`);
    function tick() {
      if (!el) return;
      if (rem <= 0) { el.textContent = 'OVERDUE'; el.style.color = '#f87171'; return; }
      const h = Math.floor(rem/3600), m = Math.floor((rem%3600)/60), s = rem%60;
      el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      rem--;
    }
    tick();
    _commTimers.push(setInterval(tick, 1000));
  });
}

async function payCommission(id) {
  if (!confirm('Mark this agent commission as Paid?')) return;
  try {
    const r = await api(`/owner-portal/commissions/${id}/pay`, 'PUT');
    toast(r.message || '✅ Commission paid!');
    loadCommissions();
  } catch (e) { toast(e.message, true); }
}

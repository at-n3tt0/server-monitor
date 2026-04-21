/* ── State ──────────────────────────────────────────────────────── */
let ws = null;
let config = {};
let targets = {};       // { id: { ...state, history, agentMetrics, agentHistory } }
let alerts  = [];
const charts = {};
let activeModal = null; // 'modal-detail' | 'modal-agent'
let detailId    = null;
let wsTimer     = null;

/* ── WebSocket ──────────────────────────────────────────────────── */
function connect() {
  setWsBadge('connecting', 'Conectando...');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.addEventListener('open',    () => { setWsBadge('connected', 'Conectado'); clearTimeout(wsTimer); });
  ws.addEventListener('message', e => { try { handleMsg(JSON.parse(e.data)); } catch(_){} });
  ws.addEventListener('close',   () => { setWsBadge('disconnected', 'Desconectado'); wsTimer = setTimeout(connect, 3000); });
  ws.addEventListener('error',   () => ws.close());
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

/* ── Message Handler ────────────────────────────────────────────── */
function handleMsg(msg) {
  if (msg.type === 'init') {
    config = msg.config;
    Object.values(msg.state).forEach(t => { targets[t.id] = t; });
    alerts = msg.alerts || [];
    renderAll();
  } else if (msg.type === 'update') {
    const prev = targets[msg.target.id];
    targets[msg.target.id] = {
      ...msg.target,
      history:      msg.history      || [],
      agentMetrics: msg.agentMetrics || null,
      agentHistory: msg.agentHistory || []
    };
    updateCard(msg.target.id, prev?.status);
    updateSummary();
    if (detailId === msg.target.id) {
      if (msg.target.type === 'agent') refreshAgentModal(msg.target.id);
      else                             refreshDetailModal(msg.target.id);
    }
  } else if (msg.type === 'alert') {
    alerts.unshift(msg.alert);
    if (alerts.length > 50) alerts.pop();
    prependAlert(msg.alert);
    playSound(msg.alert.newStatus);
  } else if (msg.type === 'configUpdated') {
    config = msg.config;
    document.getElementById('sum-interval').textContent = config.checkInterval + 's';
  }
  document.getElementById('last-update').textContent = 'Atualizado: ' + fmtTime(new Date());
}

/* ── Render All ─────────────────────────────────────────────────── */
function renderAll() {
  const grid = document.getElementById('targets-grid');
  grid.innerHTML = '';
  Object.values(targets).forEach(t => grid.appendChild(makeCard(t)));
  renderAlerts();
  updateSummary();
  document.getElementById('sum-interval').textContent = (config.checkInterval || 30) + 's';
}

/* ── Cards ──────────────────────────────────────────────────────── */
function makeCard(t) {
  const card = document.createElement('div');
  card.id = `card-${t.id}`;
  card.className = `target-card ${t.status}`;
  card.innerHTML = t.type === 'agent' ? agentCardHTML(t) : connCardHTML(t);
  card.addEventListener('click', () => t.type === 'agent' ? openAgentModal(t.id) : openDetailModal(t.id));
  if (t.type !== 'agent') {
    setTimeout(() => { const c = document.getElementById(`spark-${t.id}`); if (c) renderSparkline(t.id, c); }, 50);
  }
  return card;
}

function connCardHTML(t) {
  const rt    = t.responseTime != null ? t.responseTime + ' ms' : '—';
  const upt   = t.totalChecks  > 0    ? t.uptime + '%'         : '—';
  const ago   = t.lastCheck ? 'Verificado ' + timeAgo(t.lastCheck) : 'Aguardando...';
  return `
    <div class="card-header">
      <div><div class="card-name">${esc(t.name)}</div><div class="card-type">${typeLabel(t)}</div></div>
      <div class="status-badge ${t.status}"><span class="status-dot"></span>${statusTxt(t.status)}</div>
    </div>
    <div class="card-metrics">
      <div class="metric"><span class="metric-val">${rt}</span><span class="metric-lbl">Resposta</span></div>
      <div class="metric"><span class="metric-val">${upt}</span><span class="metric-lbl">Uptime</span></div>
      <div class="metric"><span class="metric-val">${t.totalChecks}</span><span class="metric-lbl">Checks</span></div>
    </div>
    <canvas id="spark-${t.id}" class="card-sparkline"></canvas>
    <div class="card-footer">${ago}</div>`;
}

function agentCardHTML(t) {
  const m   = t.agentMetrics;
  const ago = t.lastCheck ? 'Verificado ' + timeAgo(t.lastCheck) : 'Aguardando...';
  const hostname = m ? esc(m.hostname) : '—';
  const platform = m ? esc(m.platform + ' ' + m.arch) : '—';

  const cpuPct  = m ? m.cpu.usage    : null;
  const memPct  = m ? m.memory.usedPercent : null;
  const topDisk = m?.disks?.length ? Math.max(...m.disks.map(d => d.usedPercent)) : null;

  function bar(pct, cls) {
    if (pct == null) return `<div class="progress-bar-wrap"><div class="progress-bar ${cls}" style="width:0%"></div></div>`;
    const extra = pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : '';
    return `<div class="progress-bar-wrap"><div class="progress-bar ${cls} ${extra}" style="width:${pct}%"></div></div>`;
  }

  return `
    <div class="card-header">
      <div>
        <div class="card-name">${esc(t.name)}</div>
        <div class="card-type">${hostname} · ${platform}</div>
      </div>
      <div class="status-badge ${t.status}"><span class="status-dot"></span>${statusTxt(t.status)}</div>
    </div>
    <div class="agent-metrics">
      <div class="ag-metric-row">
        <div class="ag-metric-header"><span class="ag-metric-name">CPU</span><span class="ag-metric-value">${cpuPct != null ? cpuPct + '%' : '—'}</span></div>
        ${bar(cpuPct, 'cpu-bar')}
      </div>
      <div class="ag-metric-row">
        <div class="ag-metric-header"><span class="ag-metric-name">RAM</span><span class="ag-metric-value">${memPct != null ? memPct + '%' : '—'}</span></div>
        ${bar(memPct, 'mem-bar')}
      </div>
      <div class="ag-metric-row">
        <div class="ag-metric-header"><span class="ag-metric-name">Disco</span><span class="ag-metric-value">${topDisk != null ? topDisk + '%' : '—'}</span></div>
        ${bar(topDisk, 'disk-bar')}
      </div>
    </div>
    <div class="card-footer">${ago}</div>`;
}

function updateCard(id, prevStatus) {
  const t = targets[id];
  let card = document.getElementById(`card-${id}`);
  if (!card) {
    document.getElementById('targets-grid').appendChild(makeCard(t));
    return;
  }
  card.className = `target-card ${t.status}`;
  card.innerHTML = t.type === 'agent' ? agentCardHTML(t) : connCardHTML(t);
  card.addEventListener('click', () => t.type === 'agent' ? openAgentModal(t.id) : openDetailModal(t.id));
  if (t.type !== 'agent') {
    setTimeout(() => { const c = document.getElementById(`spark-${id}`); if (c) renderSparkline(id, c); }, 50);
  }
  if (prevStatus && prevStatus !== 'unknown' && prevStatus !== t.status) {
    const fc = t.status === 'down' ? 'flash-down' : 'flash-up';
    card.classList.add(fc); setTimeout(() => card.classList.remove(fc), 700);
  }
}

/* ── Sparkline ──────────────────────────────────────────────────── */
function renderSparkline(id, canvas) {
  const hist   = (targets[id]?.history || []).slice(-30);
  if (charts[`sp-${id}`]) charts[`sp-${id}`].destroy();
  charts[`sp-${id}`] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: hist.map((_, i) => i),
      datasets: [{ data: hist.map(h => h.responseTime ?? 0), backgroundColor: hist.map(h => statusColor(h.status)), borderWidth: 0, borderRadius: 2 }]
    },
    options: { animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, min: 0 } }, responsive: true, maintainAspectRatio: false }
  });
}

/* ── Connectivity Detail Modal ──────────────────────────────────── */
function openDetailModal(id) {
  detailId = id;
  refreshDetailModal(id);
  openModal('modal-detail');
}

function refreshDetailModal(id) {
  const t = targets[id]; if (!t) return;
  document.getElementById('detail-name').textContent = t.name;
  document.getElementById('detail-meta').textContent = typeLabel(t);
  document.getElementById('detail-status').textContent = statusTxt(t.status);
  document.getElementById('detail-rt').textContent     = t.responseTime != null ? t.responseTime + ' ms' : '—';
  document.getElementById('detail-uptime').textContent = t.totalChecks > 0 ? t.uptime + '%' : '—';
  document.getElementById('detail-checks').textContent = t.totalChecks;
  document.getElementById('detail-last-check').textContent = t.lastCheck ? 'Última: ' + fmtTime(new Date(t.lastCheck)) : '—';
  document.getElementById('detail-check-btn').onclick = () => send({ action: 'check', targetId: id });
  document.getElementById('detail-remove-btn').onclick = () => removeTarget(id, 'modal-detail');

  const hist = (t.history || []).slice(-60);
  const canvas = document.getElementById('detail-chart');
  if (charts['detail-conn']) { charts['detail-conn'].destroy(); }
  charts['detail-conn'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: hist.map(h => fmtTime(new Date(h.time))),
      datasets: [{
        label: 'Resposta (ms)', data: hist.map(h => h.responseTime),
        borderColor: '#1f6feb', backgroundColor: 'rgba(31,111,235,.15)',
        borderWidth: 2, pointRadius: 3, pointBackgroundColor: hist.map(h => statusColor(h.status)),
        fill: true, tension: .3, spanGaps: true
      }]
    },
    options: {
      animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y != null ? c.parsed.y + ' ms' : 'Offline' } } },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: 'rgba(48,54,61,.8)' } },
        y: { ticks: { color: '#8b949e', callback: v => v + ' ms' }, grid: { color: 'rgba(48,54,61,.8)' }, min: 0 }
      },
      responsive: true, maintainAspectRatio: false
    }
  });
}

/* ── Agent Detail Modal ─────────────────────────────────────────── */
function openAgentModal(id) {
  detailId = id;
  switchTab('overview');
  refreshAgentModal(id);
  openModal('modal-agent');
}

function refreshAgentModal(id) {
  const t = targets[id]; if (!t) return;
  const m = t.agentMetrics;

  document.getElementById('ag-name').textContent     = t.name;
  document.getElementById('ag-hostname').textContent = m ? `${m.hostname} · ${m.platform} ${m.arch}` : '—';
  document.getElementById('ag-check-btn').onclick    = () => send({ action: 'check', targetId: id });
  document.getElementById('ag-remove-btn').onclick   = () => removeTarget(id, 'modal-agent');

  if (!m) return;

  // Overview
  const cpuPct = m.cpu.usage;
  const memPct = m.memory.usedPercent;
  const mainDisk = m.disks?.[0];

  setBar('ov-cpu-bar',  cpuPct,  'cpu-bar');
  setBar('ov-mem-bar',  memPct,  'mem-bar');
  setBar('ov-disk-bar', mainDisk?.usedPercent ?? 0, 'disk-bar');

  document.getElementById('ov-cpu').textContent  = cpuPct + '%';
  document.getElementById('ov-mem').textContent  = memPct + '%';
  document.getElementById('ov-disk').textContent = mainDisk ? mainDisk.usedPercent + '%' : '—';
  document.getElementById('ov-uptime').textContent = fmtUptime(m.uptime);

  document.getElementById('ov-cpu-sub').textContent  = `${m.cpu.cores} núcleos · ${m.cpu.model}`;
  document.getElementById('ov-mem-sub').textContent  = `${fmtBytes(m.memory.used)} / ${fmtBytes(m.memory.total)}`;
  document.getElementById('ov-disk-sub').textContent = mainDisk ? `${mainDisk.mount}: ${fmtBytes(mainDisk.used)} / ${fmtBytes(mainDisk.total)}` : '—';
  document.getElementById('ov-uptime-sub').textContent = m.loadAvg ? `Load: ${m.loadAvg.join(' ')}` : '';

  document.getElementById('inf-hostname').textContent  = m.hostname;
  document.getElementById('inf-os').textContent        = `${m.platform} ${m.release}`;
  document.getElementById('inf-arch').textContent      = m.arch;
  document.getElementById('inf-cpu-model').textContent = m.cpu.model;
  document.getElementById('inf-cores').textContent     = m.cpu.cores;
  document.getElementById('inf-procs').textContent     = m.processes ?? '—';
  document.getElementById('inf-load').textContent      = m.loadAvg ? m.loadAvg.join(' / ') : '—';
  document.getElementById('inf-last').textContent      = t.lastCheck ? fmtTime(new Date(t.lastCheck)) : '—';

  // Top processes
  const tpSection = document.getElementById('top-procs-section');
  if (m.topProcs?.length) {
    tpSection.style.display = '';
    document.getElementById('top-procs-body').innerHTML = m.topProcs.map(p =>
      `<tr><td>${p.pid}</td><td>${esc(p.user)}</td><td>${p.cpu}%</td><td>${p.mem}%</td><td style="font-family:monospace;font-size:12px">${esc(p.cmd)}</td></tr>`
    ).join('');
  } else {
    tpSection.style.display = 'none';
  }

  // CPU chart
  const agH    = t.agentHistory || [];
  const labels = agH.map(h => fmtTime(new Date(h.time)));
  const cpuData = agH.map(h => h.cpu);
  const memData = agH.map(h => h.memPercent);

  buildLineChart('ag-cpu-chart', 'ag-cpu', labels,
    [{ label: 'CPU %', data: cpuData, borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,.12)', fill: true }]);

  // Memory chart
  buildLineChart('ag-mem-chart', 'ag-mem', labels,
    [{ label: 'RAM %', data: memData, borderColor: '#bc8cff', backgroundColor: 'rgba(188,140,255,.12)', fill: true }]);

  // Cores grid
  const cGrid = document.getElementById('cpu-cores-grid');
  if (m.cpu.perCore?.length) {
    cGrid.innerHTML = m.cpu.perCore.map((v, i) => `
      <div class="core-item">
        <div class="core-lbl">Core ${i}</div>
        <div class="core-val">${v}%</div>
        <div class="progress-bar-wrap"><div class="progress-bar cpu-bar ${v>=90?'danger':v>=75?'warn':''}" style="width:${v}%"></div></div>
      </div>`).join('');
  } else { cGrid.innerHTML = ''; }

  // Memory breakdown
  document.getElementById('mem-breakdown').innerHTML = `
    <div class="mem-block"><div class="mem-block-val">${fmtBytes(m.memory.total)}</div><div class="mem-block-lbl">Total</div></div>
    <div class="mem-block"><div class="mem-block-val">${fmtBytes(m.memory.used)}</div><div class="mem-block-lbl">Usado</div></div>
    <div class="mem-block"><div class="mem-block-val">${fmtBytes(m.memory.free)}</div><div class="mem-block-lbl">Livre</div></div>`;

  // Disk list
  document.getElementById('disk-list').innerHTML = (m.disks || []).map(d => `
    <div class="disk-item">
      <div class="disk-header">
        <div><div class="disk-mount">${esc(d.mount)}</div><div class="disk-fs">${d.filesystem || ''}</div></div>
        <div class="disk-percent" style="color:${d.usedPercent>=90?'var(--down)':d.usedPercent>=75?'var(--degraded)':'var(--up)'}">${d.usedPercent}%</div>
      </div>
      <div class="disk-bar-wrap">
        <div class="progress-bar-wrap"><div class="progress-bar disk-bar ${d.usedPercent>=90?'danger':d.usedPercent>=75?'warn':''}" style="width:${d.usedPercent}%"></div></div>
      </div>
      <div class="disk-sizes"><span>${fmtBytes(d.used)} usados</span><span>${fmtBytes(d.free)} livres / ${fmtBytes(d.total)} total</span></div>
    </div>`).join('');

  // Network
  document.getElementById('network-list').innerHTML = (m.network || []).map(n => {
    const rts = n.rates
      ? `<div class="net-rates"><div class="net-rate-item">↓ RX <span class="net-rate-val">${fmtBytes(n.rates.rxBps)}/s</span></div><div class="net-rate-item">↑ TX <span class="net-rate-val">${fmtBytes(n.rates.txBps)}/s</span></div></div>`
      : '';
    return `
      <div class="net-item">
        <div class="net-header"><span class="net-iface">${esc(n.name)}</span><span class="net-addr">${n.address}</span></div>
        <div style="font-size:12px;color:var(--text2)">MAC: ${n.mac || '—'}</div>
        ${rts}
      </div>`;
  }).join('');
}

function setBar(elId, pct, cls) {
  const el = document.getElementById(elId); if (!el) return;
  const extra = pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : '';
  el.className = `progress-bar ${cls} ${extra}`;
  el.style.width = (pct || 0) + '%';
}

function buildLineChart(canvasId, key, labels, datasets) {
  if (charts[key]) charts[key].destroy();
  const canvas = document.getElementById(canvasId); if (!canvas) return;
  charts[key] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map(d => ({
        ...d, borderWidth: 2, pointRadius: 2, tension: .3, spanGaps: true
      }))
    },
    options: {
      animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y != null ? c.parsed.y + '%' : '—' } } },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: 'rgba(48,54,61,.8)' } },
        y: { ticks: { color: '#8b949e', callback: v => v + '%' }, grid: { color: 'rgba(48,54,61,.8)' }, min: 0, max: 100 }
      },
      responsive: true, maintainAspectRatio: false
    }
  });
}

/* ── Tab Switching ──────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b  => b.classList.toggle('active',  b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  // Refresh charts when switching to their tab (they may have been hidden)
  if (name === 'cpu' || name === 'memory') {
    setTimeout(() => { if (detailId) refreshAgentModal(detailId); }, 50);
  }
}

/* ── Alerts ─────────────────────────────────────────────────────── */
function renderAlerts() {
  const list = document.getElementById('alerts-list');
  list.innerHTML = alerts.length ? alerts.map(alertHTML).join('') : '<p class="empty-text">Nenhum evento ainda.</p>';
}

function prependAlert(a) {
  const list = document.getElementById('alerts-list');
  list.querySelector('.empty-text')?.remove();
  const el = document.createElement('div');
  el.innerHTML = alertHTML(a);
  list.insertBefore(el.firstElementChild, list.firstChild);
}

function alertHTML(a) {
  const arrow = a.newStatus === 'down' ? '↓' : a.newStatus === 'up' ? '↑' : '~';
  return `<div class="alert-item ${a.newStatus}">
    <div class="alert-name">${arrow} ${esc(a.name)}</div>
    <div class="alert-desc">${statusTxt(a.prevStatus)} → ${statusTxt(a.newStatus)}</div>
    <div class="alert-time">${fmtTime(new Date(a.time))}</div>
  </div>`;
}

function clearAlerts() { alerts = []; renderAlerts(); }

/* ── Summary ────────────────────────────────────────────────────── */
function updateSummary() {
  const all = Object.values(targets);
  document.getElementById('sum-total').textContent    = all.length;
  document.getElementById('sum-up').textContent       = all.filter(t => t.status === 'up').length;
  document.getElementById('sum-down').textContent     = all.filter(t => t.status === 'down').length;
  document.getElementById('sum-degraded').textContent = all.filter(t => t.status === 'degraded').length;
}

/* ── Add Target Form ────────────────────────────────────────────── */
function toggleFormFields() {
  const type = document.getElementById('f-type').value;
  document.getElementById('f-agent-section').style.display = type === 'agent' ? '' : 'none';
  document.getElementById('f-host-row').style.display      = (type === 'ping' || type === 'tcp') ? '' : 'none';
  document.getElementById('f-url-row').style.display       = type === 'http'  ? '' : 'none';
  document.getElementById('f-port-row').style.display      = type === 'tcp'   ? '' : 'none';
  document.getElementById('f-degraded-row').style.display  = type !== 'agent' ? '' : 'none';
}

function submitAddForm(e) {
  e.preventDefault();
  const type   = document.getElementById('f-type').value;
  const name   = document.getElementById('f-name').value.trim();
  const timeout  = parseInt(document.getElementById('f-timeout').value)  || 5000;
  const degraded = parseInt(document.getElementById('f-degraded').value) || 500;
  if (!name) return;

  const id = 'tgt_' + Date.now();
  const target = { id, name, type, timeout };

  if (type === 'agent') {
    target.url    = document.getElementById('f-agent-url').value.trim();
    target.secret = document.getElementById('f-agent-secret').value.trim() || undefined;
    if (!target.url) return alert('Informe a URL do agente.');
  } else if (type === 'http') {
    target.url = document.getElementById('f-url').value.trim();
    target.degradedThreshold = degraded;
    if (!target.url) return alert('Informe a URL.');
  } else {
    target.host = document.getElementById('f-host').value.trim();
    target.degradedThreshold = degraded;
    if (!target.host) return alert('Informe o host/IP.');
    if (type === 'tcp') {
      target.port = parseInt(document.getElementById('f-port').value);
      if (!target.port) return alert('Informe a porta.');
    }
  }

  config.targets.push(target);
  send({ action: 'saveConfig', config });
  closeModal('modal-add');
  document.getElementById('add-form').reset();
  toggleFormFields();
}

function removeTarget(id, modalId) {
  if (!confirm('Remover este alvo do monitoramento?')) return;
  config.targets = config.targets.filter(t => t.id !== id);
  delete targets[id];
  send({ action: 'saveConfig', config });
  closeModal(modalId);
  document.getElementById(`card-${id}`)?.remove();
  updateSummary();
}

/* ── Modal Helpers ──────────────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  activeModal = id;
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (activeModal === id) { activeModal = null; detailId = null; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && activeModal) closeModal(activeModal); });

/* ── Sound ──────────────────────────────────────────────────────── */
function playSound(status) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.frequency.value = status === 'down' ? 220 : 660;
    g.gain.setValueAtTime(.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .4);
    osc.start(); osc.stop(ctx.currentTime + .4);
  } catch (_) {}
}

/* ── WS Badge ───────────────────────────────────────────────────── */
function setWsBadge(cls, txt) {
  const el = document.getElementById('ws-status');
  el.className = `ws-badge ${cls}`;
  el.innerHTML = `<span class="ws-dot"></span> ${txt}`;
}

/* ── Helpers ────────────────────────────────────────────────────── */
function statusTxt(s)   { return { up:'Online', down:'Offline', degraded:'Lento', unknown:'Aguardando' }[s] || s; }
function statusColor(s) { return { up:'#3fb950', down:'#f85149', degraded:'#d29922', unknown:'#8b949e' }[s] || '#8b949e'; }

function typeLabel(t) {
  if (t.type === 'http')  return `HTTP · ${t.url || ''}`;
  if (t.type === 'tcp')   return `TCP · ${t.host || ''}:${t.port || ''}`;
  if (t.type === 'ping')  return `Ping · ${t.host || ''}`;
  if (t.type === 'agent') return `Agente · ${t.url || ''}`;
  return t.type;
}

function fmtTime(d) { return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 5)    return 'agora';
  if (s < 60)   return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s/60)}m`;
  return `há ${Math.floor(s/3600)}h`;
}

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < u.length-1) { v /= 1024; i++; }
  return `${Math.round(v * 10) / 10} ${u[i]}`;
}

function fmtUptime(secs) {
  if (!secs) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function esc(s) { return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Refresh time-ago labels every 10s
setInterval(() => {
  document.querySelectorAll('.card-footer').forEach(el => {
    const id = el.closest('.target-card')?.id?.replace('card-','');
    if (id && targets[id]?.lastCheck) el.textContent = 'Verificado ' + timeAgo(targets[id].lastCheck);
  });
}, 10000);

/* ── Init ───────────────────────────────────────────────────────── */
toggleFormFields();
connect();

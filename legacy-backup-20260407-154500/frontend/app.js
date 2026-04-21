const state = {
  auth: null,
  config: null,
  snapshot: null,
  selectedTargetId: null,
  diagnosticsByTarget: {},
  diagnosticsLoadingTargetId: null,
  charts: new Map(),
  websocket: null,
  users: [],
  auditEvents: [],
  monitoringProfiles: [],
  profileDrafts: [],
  onboardingHosts: [],
  onboardingPlansByTarget: {},
  onboardingDraftsByTarget: {},
  selectedOnboardingTargetId: null,
  onboardingLoadingTargetId: null,
  currentView: "dashboard",
  editingTargetId: null,
  editingUsername: null
};

const chartPalette = {
  text: "#dce7f5",
  muted: "rgba(141, 154, 174, 0.88)",
  grid: "rgba(133, 153, 184, 0.12)",
  accent: "#4da3ff",
  cpu: "#5fe39f",
  memory: "#f6b44f",
  rx: "#4da3ff",
  tx: "#8d6bff",
  latency: "#4da3ff",
  packetLoss: "#ff5c70",
  warning: "#ffb84d",
  critical: "#ff5c70"
};

function isAdmin() {
  return state.auth?.role === "admin";
}

function isMutableMethod(method = "GET") {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase());
}

function showAuthenticatedShell(enabled) {
  document.getElementById("login-shell").classList.toggle("is-hidden", enabled);
  document.getElementById("app-shell").classList.toggle("is-hidden", !enabled);
}

function showError(elementId, message) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.classList.toggle("is-hidden", !message);
}

function showFeedback(elementId, message, isError = false) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.classList.toggle("is-hidden", !message);
  element.classList.toggle("feedback-error", Boolean(message && isError));
}

async function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const headers = {
    ...(options.headers || {})
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (state.auth?.csrfToken && isMutableMethod(method)) {
    headers["x-csrf-token"] = state.auth.csrfToken;
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    method,
    headers
  });

  if (response.status === 401) {
    handleUnauthorized();
    throw new Error("unauthorized");
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();
  let data = null;

  if (rawText) {
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(rawText);
      } catch (_) {
        throw new Error("Resposta JSON invalida do backend.");
      }
    } else {
      const compact = rawText.replace(/\s+/g, " ").trim();
      if (compact.startsWith("<!DOCTYPE") || compact.startsWith("<html")) {
        throw new Error("O backend retornou HTML em vez de JSON. Verifique se o endpoint existe e se o backend foi reiniciado.");
      }
      if (compact.startsWith("Cannot GET /api") || compact.startsWith("Cannot POST /api") || compact.startsWith("Cannot PUT /api") || compact.startsWith("Cannot DELETE /api")) {
        throw new Error(`Endpoint da API nao encontrado: ${method.toUpperCase()} ${url}. Reinicie o backend para carregar a versao atual.`);
      }
      throw new Error(`Resposta inesperada do backend (${contentType || "sem content-type"}).`);
    }
  }

  if (!response.ok) {
    const error = new Error(data.error?.message || "Falha na requisicao");
    error.payload = data.error;
    throw error;
  }
  return data;
}

async function loadSession() {
  try {
    const data = await requestJson("/api/auth/me");
    state.auth = data.user;
    showAuthenticatedShell(true);
    updateUserUi();
    await bootstrap();
    connectWebsocket();
    if (isAdmin()) {
      await Promise.all([loadUsers(), loadAudit()]);
    }
  } catch (error) {
    if (error.message !== "unauthorized") {
      console.error(error);
    }
  }
}

function handleUnauthorized() {
  if (state.websocket) {
    state.websocket.close();
    state.websocket = null;
  }
  state.auth = null;
  state.config = null;
  state.snapshot = null;
  state.diagnosticsByTarget = {};
  state.diagnosticsLoadingTargetId = null;
  state.users = [];
  state.auditEvents = [];
  state.onboardingHosts = [];
  state.onboardingPlansByTarget = {};
  state.onboardingDraftsByTarget = {};
  state.selectedOnboardingTargetId = null;
  state.onboardingLoadingTargetId = null;
  showAuthenticatedShell(false);
  showError("login-error", "Sua sessao expirou. Entre novamente.");
}

async function bootstrap() {
  setDashboardLoading(true);
  try {
    const data = await requestJson("/api/bootstrap");
    state.auth = data.auth;
    state.config = data.config;
    state.snapshot = data.snapshot;
    ensureSelectedTarget();
    updateUserUi();
    render();
    if (state.currentView === "diagnostics" && state.selectedTargetId) {
      await loadDiagnostics(state.selectedTargetId);
    }
    if (state.currentView === "onboarding" && isAdmin()) {
      await loadOnboardingEligible();
    }
  } finally {
    setDashboardLoading(false);
  }
}

function connectWebsocket() {
  if (!state.auth) {
    return;
  }
  if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  setWsStatus("Conectando");
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  state.websocket = socket;

  socket.addEventListener("open", () => setWsStatus("Conectado"));
  socket.addEventListener("error", () => {
    console.error("[ws] erro de conexao com /ws");
    setWsStatus("Desconectado");
  });
  socket.addEventListener("close", () => {
    setWsStatus("Desconectado");
    if (state.auth) {
      setTimeout(connectWebsocket, 3000);
    }
  });
  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "bootstrap") {
      state.auth = message.payload.auth;
      state.config = message.payload.config;
      state.snapshot = message.payload.snapshot;
      ensureSelectedTarget();
      render();
      return;
    }
    if (message.type === "target_update") {
      await bootstrap();
      if (state.currentView === "onboarding" && isAdmin()) {
        await loadOnboardingEligible();
      }
      return;
    }
    if (
      message.type === "alert"
      || message.type === "alert_resolved"
      || message.type === "config_updated"
      || message.type === "correlation_update"
      || message.type === "correlation_resolved"
    ) {
      await bootstrap();
      if (state.currentView === "onboarding" && isAdmin()) {
        await loadOnboardingEligible();
      }
    }
  });
}

function setWsStatus(text) {
  document.getElementById("ws-status").textContent = text;
}

function updateUserUi() {
  document.getElementById("user-name").textContent = state.auth?.username || "-";
  document.getElementById("user-role").textContent = state.auth?.role || "-";
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("is-hidden", !isAdmin());
  });
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll(".nav-tab").forEach((element) => {
    element.classList.toggle("active", element.dataset.view === view);
  });
  document.querySelectorAll(".view-pane").forEach((element) => {
    element.classList.toggle("active", element.id === `view-${view}`);
  });
  if (view === "diagnostics" && state.selectedTargetId) {
    loadDiagnostics(state.selectedTargetId).catch((error) => {
      if (error.message !== "unauthorized") {
        showFeedback("diagnostic-feedback", error.payload?.message || error.message, true);
      }
    });
  }
  if (view === "onboarding" && isAdmin()) {
    loadOnboardingEligible().catch((error) => {
      if (error.message !== "unauthorized") {
        showFeedback("onboarding-feedback", error.payload?.message || error.message, true);
      }
    });
  }
}

function ensureSelectedTarget() {
  if (!state.snapshot) {
    state.selectedTargetId = null;
    return;
  }
  const preferredTargetIds = (state.snapshot.hosts || []).map((host) => host.primaryTargetId).filter(Boolean);
  const targetIds = preferredTargetIds.length ? preferredTargetIds : Object.keys(state.snapshot.targets || {});
  if (!targetIds.length) {
    state.selectedTargetId = null;
    return;
  }
  if (!state.selectedTargetId || !state.snapshot.targets[state.selectedTargetId]) {
    state.selectedTargetId = targetIds[0];
  }
}

function getTargetBundles() {
  return Object.values(state.snapshot?.targets || {}).sort((left, right) => left.target.name.localeCompare(right.target.name));
}

function getHostSummaries() {
  return [...(state.snapshot?.hosts || [])].sort((left, right) => left.hostname.localeCompare(right.hostname));
}

function getSelectedHostSummary() {
  return getHostSummaries().find((host) => host.targetIds.includes(state.selectedTargetId)) || null;
}

function getHostPrimaryBundle(host) {
  return host?.primaryTargetId ? state.snapshot?.targets?.[host.primaryTargetId] || null : null;
}

function getSelectedBundle() {
  return state.snapshot?.targets?.[state.selectedTargetId] || null;
}

function getLatestAgentMetrics(bundle) {
  return bundle?.history?.agentMetrics?.at(-1)?.metrics || null;
}

function getLatestDiskUsage(bundle) {
  const disks = getLatestAgentMetrics(bundle)?.disks || [];
  return disks.length ? Math.max(...disks.map((disk) => Number(disk.usedPercent) || 0)) : null;
}

function normalizeIdentifier(value) {
  if (!value) {
    return null;
  }
  return String(value).trim().toLowerCase() || null;
}

function getBundleIdentifiers(bundle) {
  const latestAgent = getLatestAgentMetrics(bundle);
  return [
    normalizeIdentifier(bundle?.target?.host),
    normalizeIdentifier(extractHostnameFromUrl(bundle?.target?.url)),
    normalizeIdentifier(latestAgent?.hostname),
    normalizeIdentifier(latestAgent?.fqdn)
  ].filter(Boolean);
}

function getRelatedBundlesForSelected(selected) {
  if (!selected) {
    return [];
  }
  const selectedIdentifiers = getBundleIdentifiers(selected);
  if (!selectedIdentifiers.length) {
    return [selected];
  }
  return getTargetBundles().filter((bundle) => {
    const identifiers = getBundleIdentifiers(bundle);
    return identifiers.some((value) => selectedIdentifiers.includes(value));
  });
}

function getSelectedRoleHint(selected) {
  if (!selected) {
    return null;
  }
  return state.diagnosticsByTarget[selected.target.id]?.detectedRoles?.[0] || null;
}

function getAggregateRatePoints(networkMetrics = []) {
  const grouped = new Map();
  for (const entry of networkMetrics.filter((item) => item.interfaceName)) {
    const key = entry.collectedAt;
    const bucket = grouped.get(key) || { rxRate: 0, txRate: 0 };
    bucket.rxRate += Number(entry.rxRate) || 0;
    bucket.txRate += Number(entry.txRate) || 0;
    grouped.set(key, bucket);
  }
  return [...grouped.entries()]
    .sort((left, right) => new Date(left[0]) - new Date(right[0]))
    .slice(-24)
    .map(([collectedAt, values]) => ({ collectedAt, ...values }));
}

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function setDashboardLoading(enabled) {
  const message = enabled ? "CARREGANDO\nAguardando dados reais do backend" : "";
  [
    "chart-hosts-cpu",
    "chart-hosts-memory",
    "chart-hosts-traffic",
    "chart-hosts-latency"
  ].forEach((canvasId) => {
    setChartShellState(canvasId, enabled ? "loading" : "", message);
  });
}

function setChartShellState(canvasId, stateName, message = "") {
  const canvas = document.getElementById(canvasId);
  const shell = canvas?.parentElement;
  if (!shell) {
    return;
  }
  if (!stateName) {
    delete shell.dataset.state;
    delete shell.dataset.message;
    canvas.style.visibility = "";
    return;
  }
  shell.dataset.state = stateName;
  shell.dataset.message = message;
  canvas.style.visibility = stateName === "ready" ? "" : "hidden";
}

function getSeriesState(values, errorMessage = "") {
  const sanitized = values.filter((value) => value != null && !Number.isNaN(Number(value)));
  if (errorMessage) {
    return { state: "error", message: `ERRO DE COLETA\n${errorMessage}` };
  }
  if (!sanitized.length) {
    return { state: "empty", message: "SEM DADOS\nNenhum dado real disponivel para este painel" };
  }
  return { state: "ready", message: "" };
}

function render() {
  renderSummary();
  renderHostWall();
  renderMainHostCharts();
  renderAlerts();
  renderCorrelations();
  renderOperationalTable();
  renderDiagnostics();
  try {
    renderOnboarding();
  } catch (error) {
    console.error("[ui] falha ao renderizar onboarding", error);
    showFeedback("onboarding-feedback", error.message || "Falha ao renderizar onboarding.", true);
  }
  renderTargetsAdmin();
  renderUsers();
  renderAudit();
  document.getElementById("last-updated").textContent = `Atualizado em ${new Date(state.snapshot?.generatedAt || Date.now()).toLocaleString("pt-BR")}`;
  bindDashboardDrilldowns();
}

function ensureSelectedOnboardingHost() {
  const targetIds = state.onboardingHosts.map((host) => host.targetId);
  if (!targetIds.length) {
    state.selectedOnboardingTargetId = null;
    return;
  }
  if (!state.selectedOnboardingTargetId || !targetIds.includes(state.selectedOnboardingTargetId)) {
    state.selectedOnboardingTargetId = targetIds[0];
  }
}

function renderSummary() {
  if (!state.snapshot) {
    return;
  }
  const hosts = getHostSummaries();
  const uptimes = hosts.map((host) => host.uptime).filter((value) => value != null);
  const cards = [
    { label: "Total hosts", value: hosts.length, note: hosts.length === 1 ? "Apenas 1 host real conectado" : "Hosts reais conectados", tone: "accent" },
    { label: "Online", value: hosts.filter((host) => host.status === "up").length, note: "Hosts saudaveis", tone: "online" },
    { label: "Warning", value: hosts.filter((host) => host.status === "degraded").length, note: "Hosts com degradacao real", tone: "warning" },
    { label: "Critical", value: hosts.filter((host) => host.status === "down").length, note: "Hosts ou servicos indisponiveis", tone: "critical" },
    { label: "Alertas ativos", value: (state.snapshot.activeAlerts || []).length, note: "Eventos ainda abertos", tone: (state.snapshot.activeAlerts || []).length ? "critical" : "accent" },
    { label: "Uptime medio", value: uptimes.length ? formatDuration(average(uptimes)) : "-", note: hosts.length <= 1 ? "Media do host conectado" : "Media dos hosts com agent", tone: "accent" }
  ];

  document.getElementById("summary-grid").innerHTML = cards.map((card) => `
    <article class="summary-card ${card.tone}">
      <span class="summary-card-label">${card.label}</span>
      <strong class="summary-card-value">${escapeHtml(String(card.value))}</strong>
      <span class="summary-card-note">${card.note}</span>
    </article>
  `).join("");
}

function renderHostWall() {
  const container = document.getElementById("host-wall");
  if (!container) {
    return;
  }
  destroyChartKeys("host-spark-");
  const hosts = getHostSummaries();
  if (!hosts.length) {
    container.innerHTML = `<p class="empty-state">Nenhum host real monitorado.</p>`;
    return;
  }

  container.innerHTML = hosts.map((host) => {
    const bundle = getHostPrimaryBundle(host);
    const latestAgent = getLatestAgentMetrics(bundle);
    const alertCount = Number(host.alertCount || 0);
    const criticalAlertCount = Number(host.criticalAlertCount || 0);
    const warningAlertCount = Number(host.warningAlertCount || 0);
    const domId = toDomSafeId(host.id || host.hostname);
    return `
      <article class="host-wall-card dashboard-drilldown-panel ${host.status || "unknown"}" data-host-primary-target-id="${host.primaryTargetId}">
        <div class="host-wall-top">
          <div>
            <div class="host-wall-name">${escapeHtml(host.hostname || "-")}</div>
            <div class="host-wall-meta">${escapeHtml(bundle?.target?.type?.toUpperCase() || "HOST")} | ${escapeHtml(host.targetCount === 1 ? "1 target relacionado" : `${host.targetCount} targets relacionados`)}</div>
          </div>
          <div class="host-wall-badges">
            <span class="pill status-${host.status || "unknown"}">${statusLabel(host.status)}</span>
            <span class="pill badge-muted">${alertCount} alert${alertCount === 1 ? "a" : "as"}</span>
          </div>
        </div>
        <div class="host-wall-metrics">
          ${renderMetricCard("CPU", formatMetric(host.cpuUsage, "%"), latestAgent?.cpu?.cores ? `${latestAgent.cpu.cores} cores` : "Sem amostra de CPU")}
          ${renderMetricCard("RAM", formatMetric(host.memoryUsedPercent, "%"), latestAgent?.memory ? `${formatBytes(latestAgent.memory.used)} / ${formatBytes(latestAgent.memory.total)}` : "Sem amostra de memoria")}
          ${renderMetricCard("Disco", formatMetric(host.diskUsedPercent, "%"), latestAgent?.disks?.length ? `${latestAgent.disks.length} particoes observadas` : "Sem amostra de disco")}
          ${renderMetricCard("Latencia", formatMetric(host.averageLatencyMs, " ms"), host.lastCheckAt ? `Ultimo check ${formatTime(host.lastCheckAt)}` : "Sem check recente")}
        </div>
        <div class="host-wall-charts">
          <div class="host-mini-panel">
            <span class="host-mini-label">CPU</span>
            <div class="chart-shell host-spark-shell"><canvas id="host-spark-cpu-${domId}"></canvas></div>
          </div>
          <div class="host-mini-panel">
            <span class="host-mini-label">RAM</span>
            <div class="chart-shell host-spark-shell"><canvas id="host-spark-ram-${domId}"></canvas></div>
          </div>
          <div class="host-mini-panel">
            <span class="host-mini-label">Latencia</span>
            <div class="chart-shell host-spark-shell"><canvas id="host-spark-latency-${domId}"></canvas></div>
          </div>
        </div>
        <div class="host-wall-footer">
          <span class="muted">${escapeHtml(host.uptime != null ? `Uptime ${formatDuration(host.uptime)}` : "Sem uptime real")}</span>
          <span class="muted">${escapeHtml(criticalAlertCount ? `${criticalAlertCount} critico(s)` : warningAlertCount ? `${warningAlertCount} warning` : "Sem alertas relevantes")}</span>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-host-primary-target-id]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedTargetId = element.dataset.hostPrimaryTargetId;
      syncDiagnosticTargetSelector();
      openSelectedDetailView();
    });
  });

  hosts.forEach((host) => renderHostWallSparklines(host));
}

function toDomSafeId(value) {
  return String(value || "host").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function renderHostWallSparklines(host) {
  const domId = toDomSafeId(host.id || host.hostname);
  renderHostSparkline(`host-spark-cpu-${domId}`, `host-spark-cpu-${domId}`, (host.series?.cpu || []).map((entry) => entry.value), chartPalette.cpu);
  renderHostSparkline(`host-spark-ram-${domId}`, `host-spark-ram-${domId}`, (host.series?.memory || []).map((entry) => entry.value), chartPalette.memory);
  renderHostSparkline(`host-spark-latency-${domId}`, `host-spark-latency-${domId}`, (host.series?.latency || []).map((entry) => entry.value), chartPalette.latency);
}

function renderHostSparkline(canvasId, chartKey, values, color) {
  const numericValues = values.filter((value) => value != null && !Number.isNaN(Number(value)));
  if (!numericValues.length) {
    if (state.charts.has(chartKey)) {
      state.charts.get(chartKey).destroy();
      state.charts.delete(chartKey);
    }
    setChartShellState(canvasId, "empty", "Sem dados");
    return;
  }
  makeChart(canvasId, chartKey, {
    type: "line",
    data: {
      labels: numericValues.map((_, index) => String(index + 1)),
      datasets: [{
        data: numericValues,
        borderColor: color,
        backgroundColor: `${color}22`,
        fill: true,
        tension: 0.26,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, grid: { display: false } }
      }
    }
  });
}

function hostColor(index, alpha = 1) {
  const palette = [
    "#4da3ff",
    "#5fe39f",
    "#f6b44f",
    "#ff5c70",
    "#8d6bff",
    "#45d0d5",
    "#d38dff",
    "#7fdc6d"
  ];
  const hex = palette[index % palette.length];
  if (alpha >= 1) {
    return hex;
  }
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderMainHostCharts() {
  destroyChartKeys("host-main-");
  const hosts = getHostSummaries();
  renderHostSeriesChart({
    canvasId: "chart-hosts-cpu",
    chartKey: "host-main-cpu",
    hosts,
    seriesKey: "cpu",
    valueLabel: "CPU",
    suffix: "%",
    yTitle: "CPU (%)"
  });
  renderHostSeriesChart({
    canvasId: "chart-hosts-memory",
    chartKey: "host-main-memory",
    hosts,
    seriesKey: "memory",
    valueLabel: "RAM",
    suffix: "%",
    yTitle: "RAM (%)"
  });
  renderHostTrafficChart(hosts);
  renderHostSeriesChart({
    canvasId: "chart-hosts-latency",
    chartKey: "host-main-latency",
    hosts,
    seriesKey: "latency",
    valueLabel: "Latencia",
    suffix: " ms",
    yTitle: "Latencia (ms)"
  });
}

function formatChartTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function renderHostSeriesChart({ canvasId, chartKey, hosts, seriesKey, valueLabel, suffix = "", yTitle = "" }) {
  const hostSeries = hosts.map((host, index) => ({
    host,
    index,
    series: (host.series?.[seriesKey] || []).filter((point) => point?.value != null && point?.timestamp)
  })).filter((entry) => entry.series.length);
  const referenceSeries = [...hostSeries].sort((left, right) => right.series.length - left.series.length)[0]?.series || [];
  const labels = referenceSeries.map((point) => formatChartTimestamp(point.timestamp));
  const datasets = hostSeries.flatMap(({ host, index, series }) => {
    if (!series.length) {
      return [];
    }
    return [{
      label: host.hostname,
      data: series.map((point) => Number(point.value)),
      borderColor: hostColor(index, 1),
      backgroundColor: hostColor(index, 0.14),
      fill: false,
      tension: 0.24,
      pointRadius: 0,
      pointHoverRadius: 3,
      borderWidth: 2
    }];
  });

  if (!datasets.length) {
    setChartShellState(canvasId, "empty", `SEM DADOS\nNenhuma serie real de ${valueLabel.toLowerCase()} disponivel`);
    return;
  }

  makeChart(canvasId, chartKey, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: chartPalette.text,
            boxWidth: 10,
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatMetric(context.parsed.y, suffix)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: chartPalette.muted },
          grid: { color: chartPalette.grid }
        },
        y: {
          ticks: {
            color: chartPalette.muted,
            callback(value) {
              return `${value}${suffix.trim()}`;
            }
          },
          title: yTitle ? { display: true, text: yTitle, color: chartPalette.muted } : undefined,
          grid: { color: chartPalette.grid }
        }
      }
    }
  });
}

function renderHostTrafficChart(hosts) {
  const referenceSeries = hosts
    .flatMap((host) => [host.series?.rx || [], host.series?.tx || []])
    .sort((left, right) => right.length - left.length)[0] || [];
  const labels = referenceSeries.map((point) => formatChartTimestamp(point.timestamp));
  const datasets = [];
  hosts.forEach((host, index) => {
    const rxSeries = (host.series?.rx || []).filter((point) => point?.value != null && point?.timestamp);
    const txSeries = (host.series?.tx || []).filter((point) => point?.value != null && point?.timestamp);
    if (rxSeries.length) {
      datasets.push({
        label: `${host.hostname} RX`,
        data: rxSeries.map((point) => Number(point.value)),
        borderColor: hostColor(index, 1),
        backgroundColor: hostColor(index, 0.16),
        fill: false,
        tension: 0.22,
        pointRadius: 0,
        pointHoverRadius: 3,
        borderWidth: 2
      });
    }
    if (txSeries.length) {
      datasets.push({
        label: `${host.hostname} TX`,
        data: txSeries.map((point) => Number(point.value)),
        borderColor: hostColor(index + 4, 1),
        backgroundColor: hostColor(index + 4, 0.16),
        fill: false,
        tension: 0.22,
        pointRadius: 0,
        pointHoverRadius: 3,
        borderDash: [6, 4],
        borderWidth: 2
      });
    }
  });

  if (!datasets.length) {
    setChartShellState("chart-hosts-traffic", "empty", "SEM DADOS\nNenhuma serie real de trafego disponivel");
    return;
  }

  makeChart("chart-hosts-traffic", "host-main-traffic", {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: chartPalette.text,
            boxWidth: 10,
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatBytes(context.parsed.y)}/s`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: chartPalette.muted },
          grid: { color: chartPalette.grid }
        },
        y: {
          ticks: {
            color: chartPalette.muted,
            callback(value) {
              return `${formatBytes(value)}/s`;
            }
          },
          title: { display: true, text: "Bytes/s", color: chartPalette.muted },
          grid: { color: chartPalette.grid }
        }
      }
    }
  });
}

function renderMetricCard(label, value, note) {
  return `
    <article class="metric-card">
      <span class="metric-card-label">${label}</span>
      <strong class="metric-card-value">${escapeHtml(String(value ?? "-"))}</strong>
      <span class="metric-card-note">${escapeHtml(String(note ?? "-"))}</span>
    </article>
  `;
}

function renderSelectedMetricCards(selected, roleHint, latestAgent, diskUsage) {
  const target = selected.target;
  const current = selected.current || {};
  const checks = selected.history?.checks || [];
  const lastHttpStatus = [...checks].reverse().find((entry) => entry.httpStatus != null)?.httpStatus ?? current.details?.httpStatus ?? null;
  const recentFailures = checks.filter((entry) => entry.status === "down").length;

  const cardsByType = {
    ping: [
      renderMetricCard("Latencia", formatMetric(current.latencyMs, " ms"), `Jitter ${formatMetric(current.jitterMs, " ms")} | Perda ${formatMetric(current.packetLoss, "%")}`),
      renderMetricCard("Disponibilidade", formatMetric(current.availability, "%"), current.message || "Sem mensagem"),
      renderMetricCard("Oscilacoes", String(countStatusTransitions(checks)), "Mudancas de estado nas amostras recentes"),
      renderMetricCard("Ultimo check", current.lastCheckAt ? formatTime(current.lastCheckAt) : "-", `${checks.length} amostras historicas`)
    ],
    agent: [
      renderMetricCard("CPU", formatMetric(latestAgent?.cpu?.usage, "%"), latestAgent?.cpu?.cores ? `${latestAgent.cpu.cores} cores` : "Sem dado de agente"),
      renderMetricCard("RAM", formatMetric(latestAgent?.memory?.usedPercent, "%"), latestAgent ? `${formatBytes(latestAgent.memory.used)} / ${formatBytes(latestAgent.memory.total)}` : "Sem dado de agente"),
      renderMetricCard("Disco", formatMetric(diskUsage, "%"), latestAgent?.disks?.length ? `${latestAgent.disks.length} particoes observadas` : "Sem dado de disco"),
      renderMetricCard("Uptime", formatDuration(latestAgent?.uptime), escapeHtml(latestAgent?.hostname || "-"))
    ],
    http: [
      renderMetricCard("Resposta", formatMetric(current.latencyMs, " ms"), lastHttpStatus != null ? `HTTP ${lastHttpStatus}` : "Sem status code recente"),
      renderMetricCard("Disponibilidade", formatMetric(current.availability, "%"), current.message || "Sem mensagem"),
      renderMetricCard("Falhas recentes", String(recentFailures), `${checks.length} checks no historico`),
      renderMetricCard("Endpoint", target.url || "-", `Intervalo ${target.intervalSeconds}s | Timeout ${target.timeout}ms`)
    ],
    tcp: [
      renderMetricCard("Resposta TCP", formatMetric(current.latencyMs, " ms"), target.port ? `Porta ${target.port}` : "Sem porta"),
      renderMetricCard("Disponibilidade", formatMetric(current.availability, "%"), current.message || "Sem mensagem"),
      renderMetricCard("Falhas recentes", String(recentFailures), `${checks.length} checks no historico`),
      renderMetricCard("Host", target.host || "-", `Intervalo ${target.intervalSeconds}s | Timeout ${target.timeout}ms`)
    ],
    dns: [
      renderMetricCard("Resolucao", formatMetric(current.latencyMs, " ms"), `Lookup ${target.metadata?.lookupHostname || "-"}`),
      renderMetricCard("Disponibilidade", formatMetric(current.availability, "%"), current.message || "Sem mensagem"),
      renderMetricCard("Falhas recentes", String(recentFailures), `${checks.length} consultas historicas`),
      renderMetricCard("Servidor DNS", target.host || "-", `Intervalo ${target.intervalSeconds}s | Timeout ${target.timeout}ms`)
    ],
    gateway: [
      renderMetricCard("Latencia", formatMetric(current.latencyMs, " ms"), `Jitter ${formatMetric(current.jitterMs, " ms")}`),
      renderMetricCard("Packet loss", formatMetric(current.packetLoss, "%"), `Disponibilidade ${formatMetric(current.availability, "%")}`),
      renderMetricCard("Oscilacoes", String(countStatusTransitions(checks)), "Mudancas de estado nas amostras recentes"),
      renderMetricCard("Gateway", target.host || "-", `Intervalo ${target.intervalSeconds}s | Timeout ${target.timeout}ms`)
    ]
  };

  const defaultCards = [
    renderMetricCard("Target", target.name, `Intervalo ${target.intervalSeconds}s | Timeout ${target.timeout}ms`),
    renderMetricCard("Status", statusLabel(current.status), current.message || "Sem mensagem"),
    renderMetricCard("Ultimo check", current.lastCheckAt ? formatTime(current.lastCheckAt) : "-", current.details?.protocol || "Sem detalhe"),
    renderMetricCard("Papel", roleHint?.label || "Sem papel em cache", roleHint ? `Confianca ${roleHint.confidence}%` : "Use Diagnostico para enriquecer a leitura")
  ];

  return [...(cardsByType[target.type] || []), ...defaultCards].slice(0, 4).join("");
}

function renderGauges(selected, roleHint) {
  const container = document.getElementById("gauges-grid");
  const kicker = document.getElementById("gauges-kicker");
  const title = document.getElementById("gauges-title");
  if (!container || !kicker || !title) {
    return;
  }
  if (!selected) {
    kicker.textContent = "Indicadores";
    title.textContent = "Saude instantanea";
    container.innerHTML = "";
    return;
  }

  const target = selected.target;
  const current = selected.current || {};
  const latestAgent = getLatestAgentMetrics(selected);
  const diskUsage = getLatestDiskUsage(selected);
  const checks = selected.history?.checks || [];
  const latencyCritical = target.thresholds?.criticalLatencyMs || 500;
  const packetLossCritical = target.thresholds?.criticalPacketLoss || 100;
  const jitterCritical = target.thresholds?.jitterCriticalMs || 100;
  const recentFailureRate = calculateFailureRate(checks);

  kicker.textContent = roleHint ? `Indicadores | ${roleHint.label}` : `Indicadores | ${target.type.toUpperCase()}`;
  title.textContent = getGaugeTitleForType(target.type);

  const gaugesByType = {
    ping: [
      buildLatencyGaugeModel(current.latencyMs, latencyCritical, "Latencia", "ms", "Latencia atual"),
      buildGaugeModel("Perda", current.packetLoss, "%", "Packet loss atual"),
      buildLatencyGaugeModel(current.jitterMs, jitterCritical, "Jitter", "ms", "Variacao recente"),
      buildGaugeModel("Disponib.", current.availability, "%", "Disponibilidade do alvo")
    ],
    agent: [
      buildGaugeModel("CPU", latestAgent?.cpu?.usage, "%", "Uso instantaneo"),
      buildGaugeModel("RAM", latestAgent?.memory?.usedPercent, "%", "Memoria em uso"),
      buildGaugeModel("Disco", diskUsage, "%", "Maior particao"),
      buildGaugeModel("Saude", current.availability, "%", "Disponibilidade do agente")
    ],
    http: [
      buildLatencyGaugeModel(current.latencyMs, latencyCritical, "Resposta", "ms", "Tempo de resposta HTTP"),
      buildGaugeModel("Disponib.", current.availability, "%", "Disponibilidade do endpoint"),
      buildGaugeModel("Falhas", recentFailureRate, "%", "Taxa de falha recente"),
      buildCustomGaugeModel("HTTP", current.details?.httpStatus ? `HTTP ${current.details.httpStatus}` : "-", httpStatusProgress(current.details?.httpStatus), current.details?.httpStatus || "-", "Status code mais recente", gaugeColor(httpStatusProgress(current.details?.httpStatus)))
    ],
    tcp: [
      buildLatencyGaugeModel(current.latencyMs, latencyCritical, "TCP", "ms", "Tempo de handshake"),
      buildGaugeModel("Disponib.", current.availability, "%", "Disponibilidade da porta"),
      buildGaugeModel("Falhas", recentFailureRate, "%", "Taxa de falha recente"),
      buildCustomGaugeModel("Porta", target.port ? String(target.port) : "-", current.status === "up" ? 100 : current.status === "degraded" ? 60 : 0, target.port ? String(target.port) : "-", "Estado atual da porta", current.status === "down" ? chartPalette.critical : current.status === "degraded" ? chartPalette.warning : chartPalette.accent)
    ],
    dns: [
      buildLatencyGaugeModel(current.latencyMs, latencyCritical, "DNS", "ms", "Tempo de resolucao"),
      buildGaugeModel("Disponib.", current.availability, "%", "Disponibilidade de resolucao"),
      buildGaugeModel("Falhas", recentFailureRate, "%", "Taxa de falha recente"),
      buildCustomGaugeModel("Lookup", target.metadata?.lookupHostname ? shorten(target.metadata.lookupHostname, 10) : "-", current.status === "up" ? 100 : current.status === "degraded" ? 60 : 0, current.status === "up" ? "OK" : "ERR", "Hostname consultado", current.status === "down" ? chartPalette.critical : chartPalette.accent)
    ],
    gateway: [
      buildLatencyGaugeModel(current.latencyMs, latencyCritical, "Latencia", "ms", "Latencia da borda"),
      buildCustomGaugeModel("Perda", formatMetric(current.packetLoss, "%"), percentProgress(current.packetLoss, packetLossCritical), current.packetLoss == null ? "-" : `${Math.round(Number(current.packetLoss))}%`, "Packet loss atual", gaugeColor(percentProgress(current.packetLoss, packetLossCritical))),
      buildLatencyGaugeModel(current.jitterMs, jitterCritical, "Jitter", "ms", "Variacao recente"),
      buildGaugeModel("Disponib.", current.availability, "%", "Disponibilidade do gateway")
    ]
  };

  const gauges = gaugesByType[target.type] || [
    buildGaugeModel("Disponib.", current.availability, "%", "Disponibilidade atual"),
    buildLatencyGaugeModel(current.latencyMs, latencyCritical, "Latencia", "ms", "Latencia atual")
  ];

  container.innerHTML = gauges.map((gauge) => `
    <article class="gauge-card">
      <header>
        <span class="gauge-label">${gauge.label}</span>
        <span class="gauge-value">${gauge.displayValue}</span>
      </header>
      <div class="gauge-meter" style="--value:${gauge.progress};--gauge-color:${gauge.color}">
        <div class="gauge-center">${gauge.center}</div>
      </div>
      <div class="gauge-note">${gauge.note}</div>
    </article>
  `).join("");
}

function buildGaugeModel(label, value, suffix, note) {
  const numericValue = value == null ? null : Math.max(0, Math.min(100, Number(value)));
  return {
    label,
    displayValue: formatMetric(value, suffix),
    progress: numericValue ?? 0,
    center: numericValue == null ? "-" : `${Math.round(numericValue)}${suffix}`,
    note,
    color: gaugeColor(numericValue)
  };
}

function buildLatencyGaugeModel(latencyValue, criticalLatency, label = "Latencia", unit = "ms", note = "") {
  const latency = latencyValue == null ? null : Number(latencyValue);
  const progress = latency == null ? 0 : Math.max(0, Math.min(100, (latency / Math.max(criticalLatency, 1)) * 100));
  return {
    label,
    displayValue: formatMetric(latencyValue, ` ${unit}`),
    progress,
    center: latency == null ? "-" : `${Math.round(latency)}${unit}`,
    note: note || `Percentual do limite critico (${criticalLatency} ${unit})`,
    color: gaugeColor(progress)
  };
}

function buildCustomGaugeModel(label, displayValue, progress, center, note, color) {
  return {
    label,
    displayValue,
    progress,
    center,
    note,
    color
  };
}

function gaugeColor(value) {
  if (value == null) {
    return chartPalette.accent;
  }
  if (value >= 85) {
    return chartPalette.critical;
  }
  if (value >= 65) {
    return chartPalette.warning;
  }
  return chartPalette.cpu;
}

function destroyChartKeys(prefix) {
  for (const [key, chart] of state.charts.entries()) {
    if (key.startsWith(prefix)) {
      chart.destroy();
      state.charts.delete(key);
    }
  }
}

function renderSpecializedPanels(selected, roleHint) {
  destroyChartKeys("detail-special-");
  const container = document.getElementById("detail-panels-grid");
  if (!container) {
    return;
  }
  if (!selected) {
    container.innerHTML = `<article class="noc-panel noc-span-12"><div class="specialized-empty">Selecione um target para abrir os paineis especializados do tipo de monitoramento.</div></article>`;
    return;
  }

  const panels = buildSpecializedPanels(selected, roleHint);
  container.innerHTML = panels.map((panel) => {
    if (panel.kind === "chart") {
      return `
        <article class="noc-panel dashboard-drilldown-panel ${panel.span}" data-drilldown="selected-target">
          <div class="panel-header panel-header-tight">
            <div>
              <p class="panel-kicker">${escapeHtml(panel.kicker)}</p>
              <h2>${escapeHtml(panel.title)}</h2>
            </div>
          </div>
          <div class="chart-shell specialized-panel-body">
            <canvas id="detail-special-canvas-${panel.id}"></canvas>
          </div>
        </article>
      `;
    }
    return `
      <article class="noc-panel dashboard-drilldown-panel ${panel.span}" data-drilldown="selected-target">
        <div class="panel-header panel-header-tight">
          <div>
            <p class="panel-kicker">${escapeHtml(panel.kicker)}</p>
            <h2>${escapeHtml(panel.title)}</h2>
          </div>
        </div>
        <div id="detail-special-content-${panel.id}" class="specialized-panel-body"></div>
      </article>
    `;
  }).join("");

  panels.forEach((panel) => panel.render());
  renderLatencyByTargetChart();
}

function shorten(value, maxLength = 18) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function countStatusTransitions(checks = []) {
  let changes = 0;
  let previous = null;
  for (const check of checks) {
    if (previous && previous !== check.status) {
      changes += 1;
    }
    previous = check.status;
  }
  return changes;
}

function calculateFailureRate(checks = []) {
  if (!checks.length) {
    return null;
  }
  const failures = checks.filter((check) => check.status === "down").length;
  return (failures / checks.length) * 100;
}

function percentProgress(value, criticalValue = 100) {
  if (value == null) {
    return 0;
  }
  return Math.max(0, Math.min(100, (Number(value) / Math.max(Number(criticalValue) || 1, 1)) * 100));
}

function httpStatusProgress(statusCode) {
  const code = Number(statusCode);
  if (!code) {
    return 0;
  }
  if (code >= 200 && code < 400) {
    return 100;
  }
  if (code >= 400 && code < 500) {
    return 65;
  }
  return 20;
}

function getGaugeTitleForType(type) {
  return {
    ping: "Conectividade e estabilidade",
    agent: "Saude do host monitorado",
    http: "Aplicacao e disponibilidade web",
    tcp: "Disponibilidade de porta",
    dns: "Resolucao e disponibilidade DNS",
    gateway: "Borda, perda e jitter"
  }[type] || "Indicadores do target";
}

function statusToAvailabilityValue(check) {
  if (check?.availability != null) {
    return Number(check.availability);
  }
  if (check?.status === "up") {
    return 100;
  }
  if (check?.status === "degraded") {
    return 50;
  }
  if (check?.status === "down") {
    return 0;
  }
  return null;
}

function getCheckLabels(checks = []) {
  return checks.map((entry) => formatTime(entry.checkedAt));
}

function getStatusDistribution(checks = []) {
  return {
    labels: ["Online", "Warning", "Critical"],
    data: [
      checks.filter((entry) => entry.status === "up").length,
      checks.filter((entry) => entry.status === "degraded").length,
      checks.filter((entry) => entry.status === "down").length
    ]
  };
}

function getRecentProblemEvents(checks = [], limit = 8) {
  return checks
    .filter((entry) => entry.status === "down" || entry.status === "degraded")
    .slice(-limit)
    .reverse();
}

function getStatusTransitions(checks = [], limit = 8) {
  const items = [];
  let previous = null;
  for (const check of checks) {
    if (previous && previous !== check.status) {
      items.push(check);
    }
    previous = check.status;
  }
  return items.slice(-limit).reverse();
}

function renderSpecialChart(panelId, config, values, errorMessage = "") {
  const key = `detail-special-${panelId}`;
  const stateInfo = getSeriesState(values, errorMessage);
  const canvasId = `detail-special-canvas-${panelId}`;
  if (stateInfo.state !== "ready") {
    if (state.charts.has(key)) {
      state.charts.get(key).destroy();
      state.charts.delete(key);
    }
    setChartShellState(canvasId, stateInfo.state, stateInfo.message);
    return;
  }
  makeChart(canvasId, key, config);
}

function renderSpecialHtml(panelId, html) {
  const element = document.getElementById(`detail-special-content-${panelId}`);
  if (element) {
    element.innerHTML = html;
  }
}

function renderSpecialEmpty(message) {
  return `<div class="specialized-empty">${escapeHtml(message)}</div>`;
}

function renderSummaryGrid(items = []) {
  if (!items.length) {
    return renderSpecialEmpty("Sem dados reais disponiveis para este painel.");
  }
  return `
    <div class="specialized-summary-grid">
      ${items.map((item) => `
        <article class="specialized-summary-card">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(String(item.value ?? "-"))}</strong>
          <p>${escapeHtml(item.note || "-")}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderListPanel(items = [], formatter, emptyMessage) {
  if (!items.length) {
    return renderSpecialEmpty(emptyMessage);
  }
  return `<div class="specialized-list">${items.map(formatter).join("")}</div>`;
}

function renderTablePanel(columns = [], rows = [], emptyMessage) {
  if (!rows.length) {
    return renderSpecialEmpty(emptyMessage);
  }
  return `
    <div class="specialized-table-wrap">
      <table class="specialized-table">
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function getRoleBasedOrdering(roleHint) {
  return {
    file_server: ["cpu", "memory", "disk", "traffic", "health", "interfaces", "processes", "related"],
    dns_server: ["cpu", "memory", "traffic", "disk", "health", "related", "interfaces", "processes"],
    active_directory: ["cpu", "memory", "disk", "traffic", "health", "related", "interfaces", "processes"],
    web_server: ["cpu", "memory", "traffic", "disk", "health", "related", "processes", "interfaces"],
    database_server: ["cpu", "memory", "disk", "traffic", "health", "processes", "related", "interfaces"]
  }[roleHint?.role] || ["cpu", "memory", "disk", "traffic", "health", "interfaces", "processes", "related"];
}

function buildSpecializedPanels(selected, roleHint) {
  const target = selected.target;
  const checks = selected.history?.checks || [];
  const agentMetrics = selected.history?.agentMetrics || [];
  const networkMetrics = selected.history?.networkMetrics || [];
  const latestAgent = getLatestAgentMetrics(selected);
  const relatedBundles = getRelatedBundlesForSelected(selected).filter((bundle) => bundle.target.id !== target.id);
  const current = selected.current || {};

  function chartPanel(id, span, kicker, title, builder) {
    return {
      id,
      span,
      kind: "chart",
      kicker,
      title,
      render: builder
    };
  }

  function htmlPanel(id, span, kicker, title, builder) {
    return {
      id,
      span,
      kind: "html",
      kicker,
      title,
      render: () => renderSpecialHtml(id, builder())
    };
  }

  const commonLatencyError = current.status === "down" ? current.message || "" : "";

  if (target.type === "ping") {
    return [
      chartPanel("ping-latency", "noc-span-4", "Ping", "Latencia ao longo do tempo", () => renderSpecialChart("ping-latency", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Latencia", data: checks.map((entry) => entry.latencyMs), borderColor: chartPalette.latency, backgroundColor: "rgba(77, 163, 255, 0.12)", fill: true, tension: 0.24, pointRadius: 0 }] },
        options: metricChartOptions("ms")
      }, checks.map((entry) => entry.latencyMs), commonLatencyError)),
      chartPanel("ping-loss", "noc-span-4", "Ping", "Packet loss", () => renderSpecialChart("ping-loss", {
        type: "bar",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Packet loss", data: checks.map((entry) => entry.packetLoss), backgroundColor: "rgba(255, 92, 112, 0.55)", borderColor: chartPalette.packetLoss, borderRadius: 5 }] },
        options: percentageChartOptions()
      }, checks.map((entry) => entry.packetLoss), commonLatencyError)),
      chartPanel("ping-jitter", "noc-span-4", "Ping", "Jitter", () => renderSpecialChart("ping-jitter", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Jitter", data: checks.map((entry) => entry.jitterMs), borderColor: chartPalette.warning, backgroundColor: "rgba(255, 184, 77, 0.10)", fill: true, tension: 0.24, pointRadius: 0 }] },
        options: metricChartOptions("ms")
      }, checks.map((entry) => entry.jitterMs), commonLatencyError)),
      chartPanel("ping-availability", "noc-span-6", "Ping", "Disponibilidade e estabilidade", () => renderSpecialChart("ping-availability", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Disponibilidade", data: checks.map(statusToAvailabilityValue), borderColor: chartPalette.cpu, backgroundColor: "rgba(95, 227, 159, 0.08)", fill: true, tension: 0.2, pointRadius: 0 }] },
        options: percentageChartOptions()
      }, checks.map(statusToAvailabilityValue), commonLatencyError)),
      htmlPanel("ping-events", "noc-span-6", "Ping", "Timeline de quedas e oscilacoes", () => renderListPanel(getStatusTransitions(checks), (entry) => `
        <article class="specialized-list-item">
          <div class="specialized-list-top">
            <div class="specialized-list-title">${escapeHtml(statusLabel(entry.status))}</div>
            <span class="pill status-${entry.status || "unknown"}">${escapeHtml(formatTime(entry.checkedAt))}</span>
          </div>
          <div class="specialized-list-note">${escapeHtml(entry.message || "Mudanca de estado registrada")}</div>
        </article>
      `, "Sem transicoes reais suficientes para montar a timeline."))
    ];
  }

  if (target.type === "agent") {
    const disks = latestAgent?.disks || [];
    const interfaces = [...(latestAgent?.network || [])].sort((left, right) => ((Number(right.rx_rate) || 0) + (Number(right.tx_rate) || 0)) - ((Number(left.rx_rate) || 0) + (Number(left.tx_rate) || 0)));
    const processes = (latestAgent?.topProcesses || latestAgent?.relevantProcesses || []).slice(0, 10);
    const trafficPoints = getAggregateRatePoints(networkMetrics);
    const panelMap = {
      health: htmlPanel("agent-health", "noc-span-4", "Host", "Saude geral do host", () => renderSummaryGrid([
        { label: "Hostname", value: latestAgent?.hostname || "-", note: latestAgent?.os || "Sem sistema reportado" },
        { label: "Disponibilidade", value: formatMetric(current.availability, "%"), note: current.message || "Sem mensagem adicional" },
        { label: "Uptime", value: formatDuration(latestAgent?.uptime), note: latestAgent?.fqdn || "Sem FQDN" },
        { label: "Papel", value: roleHint?.label || "Sem papel em cache", note: roleHint ? `Confianca ${roleHint.confidence}%` : "Use Diagnostico para enriquecer a priorizacao" }
      ])),
      cpu: chartPanel("agent-cpu", "noc-span-3", "Agent", "CPU ao longo do tempo", () => renderSpecialChart("agent-cpu", {
        type: "line",
        data: { labels: agentMetrics.map((entry) => formatTime(entry.collectedAt)), datasets: [{ label: "CPU", data: agentMetrics.map((entry) => entry.cpuUsage), borderColor: chartPalette.cpu, backgroundColor: "rgba(95, 227, 159, 0.12)", fill: true, tension: 0.28, pointRadius: 0 }] },
        options: percentageChartOptions()
      }, agentMetrics.map((entry) => entry.cpuUsage))),
      memory: chartPanel("agent-memory", "noc-span-3", "Agent", "Memoria ao longo do tempo", () => renderSpecialChart("agent-memory", {
        type: "line",
        data: { labels: agentMetrics.map((entry) => formatTime(entry.collectedAt)), datasets: [{ label: "RAM", data: agentMetrics.map((entry) => entry.memoryUsedPercent), borderColor: chartPalette.memory, backgroundColor: "rgba(246, 180, 79, 0.12)", fill: true, tension: 0.28, pointRadius: 0 }] },
        options: percentageChartOptions()
      }, agentMetrics.map((entry) => entry.memoryUsedPercent))),
      disk: chartPanel("agent-disk", "noc-span-3", "Storage", "Disco por particao", () => renderSpecialChart("agent-disk", {
        type: "bar",
        data: { labels: disks.map((disk) => shorten(disk.mount || disk.fs || "disco", 14)), datasets: [{ label: "Uso %", data: disks.map((disk) => disk.usedPercent), backgroundColor: "rgba(246, 180, 79, 0.55)", borderColor: chartPalette.memory, borderRadius: 6 }] },
        options: percentageChartOptions()
      }, disks.map((disk) => disk.usedPercent))),
      traffic: chartPanel("agent-traffic", "noc-span-3", "Rede", "Historico de trafego RX/TX", () => renderSpecialChart("agent-traffic", {
        type: "line",
        data: { labels: trafficPoints.map((point) => formatTime(point.collectedAt)), datasets: [{ label: "RX/s", data: trafficPoints.map((point) => point.rxRate), borderColor: chartPalette.rx, backgroundColor: "rgba(77, 163, 255, 0.10)", tension: 0.24, pointRadius: 0 }, { label: "TX/s", data: trafficPoints.map((point) => point.txRate), borderColor: chartPalette.tx, backgroundColor: "rgba(141, 107, 255, 0.10)", tension: 0.24, pointRadius: 0 }] },
        options: rateChartOptions()
      }, trafficPoints.flatMap((point) => [point.rxRate, point.txRate]))),
      interfaces: htmlPanel("agent-interfaces", "noc-span-6", "Interfaces", "Interfaces e links mais usados", () => renderTablePanel(
        ["Interface", "RX total", "TX total", "RX/s", "TX/s", "Status"],
        interfaces.map((iface) => [
          escapeHtml(iface.interface || "-"),
          escapeHtml(formatBytes(iface.rx_bytes)),
          escapeHtml(formatBytes(iface.tx_bytes)),
          escapeHtml(`${formatBytes(iface.rx_rate)}/s`),
          escapeHtml(`${formatBytes(iface.tx_rate)}/s`),
          `<span class="pill status-${mapOperstateToStatus(iface.operstate)}">${escapeHtml(iface.operstate || "unknown")}</span>`
        ]),
        "Sem dados reais de interfaces para este host."
      )),
      processes: htmlPanel("agent-processes", "noc-span-6", "Processos", "Top processos observados", () => renderTablePanel(
        ["Processo", "CPU", "Memoria", "PID"],
        processes.map((process) => [
          escapeHtml(process.name || process.command || "-"),
          escapeHtml(formatMetric(process.cpu, "%")),
          escapeHtml(formatBytes(process.memory || process.memRss || process.mem_vsz)),
          escapeHtml(String(process.pid || "-"))
        ]),
        "Sem lista real de processos disponivel para este host."
      )),
      related: htmlPanel("agent-related", "noc-span-12", "Contexto", "Checks relacionados ao host", () => renderListPanel(relatedBundles, (bundle) => `
        <article class="specialized-list-item">
          <div class="specialized-list-top">
            <div class="specialized-list-title">${escapeHtml(bundle.target.name)}</div>
            <span class="pill status-${bundle.current?.status || "unknown"}">${statusLabel(bundle.current?.status)}</span>
          </div>
          <div class="specialized-list-note">${escapeHtml(bundle.target.type.toUpperCase())} | ${escapeHtml(bundle.target.host || bundle.target.url || "-")} | ${escapeHtml(bundle.current?.message || "Sem mensagem adicional")}</div>
        </article>
      `, "Nenhum outro target relacionado foi associado ao mesmo host."))
    };
    return getRoleBasedOrdering(roleHint).map((key) => panelMap[key]).filter(Boolean);
  }

  if (target.type === "http") {
    const statusDistribution = getStatusDistribution(checks);
    const statusCodes = [...checks].filter((entry) => entry.httpStatus != null);
    const codeBuckets = [...new Set(statusCodes.map((entry) => String(entry.httpStatus)))].sort();
    return [
      chartPanel("http-response", "noc-span-4", "HTTP", "Tempo de resposta", () => renderSpecialChart("http-response", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Resposta", data: checks.map((entry) => entry.latencyMs), borderColor: chartPalette.latency, backgroundColor: "rgba(77, 163, 255, 0.12)", fill: true, tension: 0.24, pointRadius: 0 }] },
        options: metricChartOptions("ms")
      }, checks.map((entry) => entry.latencyMs), commonLatencyError)),
      chartPanel("http-availability", "noc-span-4", "HTTP", "Disponibilidade", () => renderSpecialChart("http-availability", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Disponibilidade", data: checks.map(statusToAvailabilityValue), borderColor: chartPalette.cpu, backgroundColor: "rgba(95, 227, 159, 0.08)", fill: true, tension: 0.2, pointRadius: 0 }] },
        options: percentageChartOptions()
      }, checks.map(statusToAvailabilityValue), commonLatencyError)),
      chartPanel("http-status-codes", "noc-span-4", "HTTP", "Status code", () => renderSpecialChart("http-status-codes", {
        type: "bar",
        data: { labels: codeBuckets, datasets: [{ label: "Respostas", data: codeBuckets.map((code) => statusCodes.filter((entry) => String(entry.httpStatus) === code).length), backgroundColor: "rgba(77, 163, 255, 0.55)", borderColor: chartPalette.accent, borderRadius: 6 }] },
        options: baseChartOptions()
      }, statusCodes.length ? codeBuckets.map((code) => statusCodes.filter((entry) => String(entry.httpStatus) === code).length) : [])),
      chartPanel("http-degradation", "noc-span-6", "HTTP", "Degradacao e falhas", () => renderSpecialChart("http-degradation", {
        type: "bar",
        data: { labels: statusDistribution.labels, datasets: [{ label: "Checks", data: statusDistribution.data, backgroundColor: ["rgba(61,220,132,0.55)", "rgba(255,184,77,0.55)", "rgba(255,92,112,0.55)"], borderRadius: 6 }] },
        options: baseChartOptions()
      }, checks.length ? statusDistribution.data : [])),
      htmlPanel("http-failures", "noc-span-6", "HTTP", "Historico de falhas", () => renderListPanel(getRecentProblemEvents(checks), (entry) => `
        <article class="specialized-list-item">
          <div class="specialized-list-top">
            <div class="specialized-list-title">${escapeHtml(formatTime(entry.checkedAt))}</div>
            <span class="pill status-${entry.status || "unknown"}">${statusLabel(entry.status)}</span>
          </div>
          <div class="specialized-list-note">${escapeHtml(entry.message || "Falha registrada")} ${entry.httpStatus != null ? `| HTTP ${entry.httpStatus}` : ""}</div>
        </article>
      `, "Sem falhas reais recentes para este endpoint."))
    ];
  }

  if (target.type === "tcp") {
    const statusDistribution = getStatusDistribution(checks);
    return [
      chartPanel("tcp-response", "noc-span-4", "TCP", "Tempo de resposta da porta", () => renderSpecialChart("tcp-response", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "TCP ms", data: checks.map((entry) => entry.latencyMs), borderColor: chartPalette.latency, backgroundColor: "rgba(77, 163, 255, 0.12)", fill: true, tension: 0.24, pointRadius: 0 }] },
        options: metricChartOptions("ms")
      }, checks.map((entry) => entry.latencyMs), commonLatencyError)),
      chartPanel("tcp-availability", "noc-span-4", "TCP", "Disponibilidade da porta", () => renderSpecialChart("tcp-availability", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Disponibilidade", data: checks.map(statusToAvailabilityValue), borderColor: chartPalette.cpu, backgroundColor: "rgba(95, 227, 159, 0.08)", fill: true, tension: 0.2, pointRadius: 0 }] },
        options: percentageChartOptions()
      }, checks.map(statusToAvailabilityValue), commonLatencyError)),
      chartPanel("tcp-failures", "noc-span-4", "TCP", "Frequencia de falhas", () => renderSpecialChart("tcp-failures", {
        type: "bar",
        data: { labels: statusDistribution.labels, datasets: [{ label: "Checks", data: statusDistribution.data, backgroundColor: ["rgba(61,220,132,0.55)", "rgba(255,184,77,0.55)", "rgba(255,92,112,0.55)"], borderRadius: 6 }] },
        options: baseChartOptions()
      }, checks.length ? statusDistribution.data : [])),
      htmlPanel("tcp-timeline", "noc-span-8", "TCP", "Timeline de abertura e queda", () => renderListPanel(getStatusTransitions(checks), (entry) => `
        <article class="specialized-list-item">
          <div class="specialized-list-top">
            <div class="specialized-list-title">${escapeHtml(formatTime(entry.checkedAt))}</div>
            <span class="pill status-${entry.status || "unknown"}">${statusLabel(entry.status)}</span>
          </div>
          <div class="specialized-list-note">${escapeHtml(entry.message || "Mudanca de estado da porta")} | ${escapeHtml(target.host || "-")}:${escapeHtml(String(target.port || "-"))}</div>
        </article>
      `, "Sem transicoes reais recentes para esta porta.")),
      htmlPanel("tcp-summary", "noc-span-4", "TCP", "Resumo operacional", () => renderSummaryGrid([
        { label: "Host", value: target.host || "-", note: `Porta ${target.port || "-"}` },
        { label: "Disponibilidade", value: formatMetric(current.availability, "%"), note: current.message || "Sem mensagem adicional" },
        { label: "Latencia", value: formatMetric(current.latencyMs, " ms"), note: `${checks.length} checks no historico` },
        { label: "Falhas", value: String(checks.filter((entry) => entry.status === "down").length), note: "Falhas criticas no historico carregado" }
      ]))
    ];
  }

  if (target.type === "dns") {
    const statusDistribution = getStatusDistribution(checks);
    return [
      chartPanel("dns-latency", "noc-span-4", "DNS", "Tempo de resolucao", () => renderSpecialChart("dns-latency", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "DNS ms", data: checks.map((entry) => entry.latencyMs), borderColor: chartPalette.latency, backgroundColor: "rgba(77, 163, 255, 0.12)", fill: true, tension: 0.24, pointRadius: 0 }] },
        options: metricChartOptions("ms")
      }, checks.map((entry) => entry.latencyMs), commonLatencyError)),
      chartPanel("dns-availability", "noc-span-4", "DNS", "Disponibilidade", () => renderSpecialChart("dns-availability", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Disponibilidade", data: checks.map(statusToAvailabilityValue), borderColor: chartPalette.cpu, backgroundColor: "rgba(95, 227, 159, 0.08)", fill: true, tension: 0.2, pointRadius: 0 }] },
        options: percentageChartOptions()
      }, checks.map(statusToAvailabilityValue), commonLatencyError)),
      chartPanel("dns-failures", "noc-span-4", "DNS", "Falhas de resolucao", () => renderSpecialChart("dns-failures", {
        type: "bar",
        data: { labels: statusDistribution.labels, datasets: [{ label: "Checks", data: statusDistribution.data, backgroundColor: ["rgba(61,220,132,0.55)", "rgba(255,184,77,0.55)", "rgba(255,92,112,0.55)"], borderRadius: 6 }] },
        options: baseChartOptions()
      }, checks.length ? statusDistribution.data : [])),
      htmlPanel("dns-events", "noc-span-6", "DNS", "Historico de falhas", () => renderListPanel(getRecentProblemEvents(checks), (entry) => `
        <article class="specialized-list-item">
          <div class="specialized-list-top">
            <div class="specialized-list-title">${escapeHtml(formatTime(entry.checkedAt))}</div>
            <span class="pill status-${entry.status || "unknown"}">${statusLabel(entry.status)}</span>
          </div>
          <div class="specialized-list-note">${escapeHtml(entry.message || "Falha de resolucao registrada")} | Lookup ${escapeHtml(target.metadata?.lookupHostname || "-")}</div>
        </article>
      `, "Sem falhas reais recentes de resolucao.")),
      htmlPanel("dns-summary", "noc-span-6", "DNS", "Resumo de resolucao", () => renderSummaryGrid([
        { label: "Servidor", value: target.host || "-", note: "IP do target DNS" },
        { label: "Lookup", value: target.metadata?.lookupHostname || "-", note: "Hostname consultado" },
        { label: "Latencia media", value: formatMetric(average(checks.map((entry) => entry.latencyMs).filter((value) => value != null)), " ms"), note: `${checks.length} checks no historico` },
        { label: "Falhas", value: String(checks.filter((entry) => entry.status === "down").length), note: "Falhas criticas no historico carregado" }
      ]))
    ];
  }

  if (target.type === "gateway") {
    return [
      chartPanel("gateway-latency", "noc-span-4", "Gateway", "Latencia", () => renderSpecialChart("gateway-latency", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Latencia", data: checks.map((entry) => entry.latencyMs), borderColor: chartPalette.latency, backgroundColor: "rgba(77, 163, 255, 0.12)", fill: true, tension: 0.24, pointRadius: 0 }] },
        options: metricChartOptions("ms")
      }, checks.map((entry) => entry.latencyMs), commonLatencyError)),
      chartPanel("gateway-loss", "noc-span-4", "Gateway", "Packet loss", () => renderSpecialChart("gateway-loss", {
        type: "bar",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Packet loss", data: checks.map((entry) => entry.packetLoss), backgroundColor: "rgba(255, 92, 112, 0.55)", borderColor: chartPalette.packetLoss, borderRadius: 5 }] },
        options: percentageChartOptions()
      }, checks.map((entry) => entry.packetLoss), commonLatencyError)),
      chartPanel("gateway-jitter", "noc-span-4", "Gateway", "Jitter", () => renderSpecialChart("gateway-jitter", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Jitter", data: checks.map((entry) => entry.jitterMs), borderColor: chartPalette.warning, backgroundColor: "rgba(255, 184, 77, 0.10)", fill: true, tension: 0.24, pointRadius: 0 }] },
        options: metricChartOptions("ms")
      }, checks.map((entry) => entry.jitterMs), commonLatencyError)),
      chartPanel("gateway-availability", "noc-span-6", "Gateway", "Disponibilidade", () => renderSpecialChart("gateway-availability", {
        type: "line",
        data: { labels: getCheckLabels(checks), datasets: [{ label: "Disponibilidade", data: checks.map(statusToAvailabilityValue), borderColor: chartPalette.cpu, backgroundColor: "rgba(95, 227, 159, 0.08)", fill: true, tension: 0.2, pointRadius: 0 }] },
        options: percentageChartOptions()
      }, checks.map(statusToAvailabilityValue), commonLatencyError)),
      htmlPanel("gateway-oscillation", "noc-span-6", "Gateway", "Historico de oscilacao", () => renderListPanel(getStatusTransitions(checks), (entry) => `
        <article class="specialized-list-item">
          <div class="specialized-list-top">
            <div class="specialized-list-title">${escapeHtml(formatTime(entry.checkedAt))}</div>
            <span class="pill status-${entry.status || "unknown"}">${statusLabel(entry.status)}</span>
          </div>
          <div class="specialized-list-note">${escapeHtml(entry.message || "Oscilacao de borda registrada")} | Perda ${escapeHtml(formatMetric(entry.packetLoss, "%"))} | Jitter ${escapeHtml(formatMetric(entry.jitterMs, " ms"))}</div>
        </article>
      `, "Sem oscilacoes reais recentes para este gateway."))
    ];
  }

  return [
    htmlPanel("fallback", "noc-span-12", "Target", "Visualizacao especializada", () => renderSpecialEmpty("Ainda nao existe renderizador especializado para este tipo com os dados reais disponiveis."))
  ];
}

function renderLatencyByTargetChart() {
  const bundles = getTargetBundles().slice(0, 12);
  const data = bundles.map((bundle) => bundle.current?.latencyMs ?? null);
  const stateInfo = getSeriesState(data);
  if (stateInfo.state !== "ready") {
    if (state.charts.has("chart-latency-targets")) {
      state.charts.get("chart-latency-targets").destroy();
      state.charts.delete("chart-latency-targets");
    }
    setChartShellState("chart-latency-targets", stateInfo.state, stateInfo.message);
    return;
  }
  makeChart("chart-latency-targets", "chart-latency-targets", {
    type: "bar",
    data: {
      labels: bundles.map((bundle) => shorten(bundle.target.name, 18)),
      datasets: [{
        label: "Latencia atual",
        data: bundles.map((bundle) => bundle.current?.latencyMs ?? null),
        backgroundColor: bundles.map((bundle) => latencyBarColor(bundle.current?.status)),
        borderRadius: 6
      }]
    },
    options: metricChartOptions("ms")
  });
}

function renderAlerts() {
  const body = document.getElementById("alerts-body");
  if (!body) {
    return;
  }
  body.innerHTML = (state.snapshot?.alerts || []).map((alert) => `
    <tr>
      <td>${new Date(alert.lastSeenAt).toLocaleString("pt-BR")}</td>
      <td><span class="pill severity-${alert.severity}">${alert.severity}</span></td>
      <td>${escapeHtml(alert.targetId)}</td>
      <td>${escapeHtml(alert.type)}</td>
      <td>${escapeHtml(alert.message)}</td>
      <td>${escapeHtml(alert.status)}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">Nenhum alerta registrado.</td></tr>`;
  renderAlertsTimeline();
}

function summarizeCorrelationEvidence(evidence = []) {
  return evidence
    .slice(0, 3)
    .map((item) => {
      const targetName = item.targetName ? `${item.targetName}: ` : "";
      return `${targetName}${item.explanation}`;
    })
    .join(" | ");
}

function renderCorrelations() {
  const body = document.getElementById("correlations-body");
  if (!body) {
    return;
  }
  const findings = (state.snapshot?.activeCorrelations?.length ? state.snapshot.activeCorrelations : state.snapshot?.correlations) || [];

  body.innerHTML = findings.map((finding) => `
    <tr>
      <td>${new Date(finding.lastSeenAt).toLocaleString("pt-BR")}</td>
      <td><span class="pill severity-${finding.severity}">${finding.severity}</span></td>
      <td>${escapeHtml(finding.hostKey || "-")}</td>
      <td>${escapeHtml(finding.title)}</td>
      <td>${escapeHtml(finding.explanation)}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">Nenhuma correlacao inteligente registrada.</td></tr>`;
}

function renderAlertsTimeline() {
  const buckets = new Map();
  for (const alert of state.snapshot?.alerts || []) {
    const key = formatAlertBucket(alert.lastSeenAt);
    const entry = buckets.get(key) || { info: 0, warning: 0, critical: 0 };
    entry[alert.severity] = (entry[alert.severity] || 0) + 1;
    buckets.set(key, entry);
  }
  const rows = [...buckets.entries()].sort((left, right) => new Date(left[0]) - new Date(right[0])).slice(-20);
  if (!rows.length) {
    if (state.charts.has("chart-alerts-timeline")) {
      state.charts.get("chart-alerts-timeline").destroy();
      state.charts.delete("chart-alerts-timeline");
    }
    setChartShellState("chart-alerts-timeline", "empty", "Sem dados");
    return;
  }
  makeChart("chart-alerts-timeline", "chart-alerts-timeline", {
    type: "bar",
    data: {
      labels: rows.map(([key]) => formatTime(key)),
      datasets: [
        { label: "Info", data: rows.map(([, value]) => value.info), backgroundColor: "rgba(77, 163, 255, 0.65)" },
        { label: "Warning", data: rows.map(([, value]) => value.warning), backgroundColor: "rgba(255, 184, 77, 0.65)" },
        { label: "Critical", data: rows.map(([, value]) => value.critical), backgroundColor: "rgba(255, 92, 112, 0.78)" }
      ]
    },
    options: stackedChartOptions()
  });
}

function renderOperationalTable() {
  const body = document.getElementById("operational-body");
  if (!body) {
    return;
  }
  const hosts = getHostSummaries();
  body.innerHTML = hosts.map((host) => {
    return `
      <tr data-operational-target="${host.primaryTargetId}">
        <td>${escapeHtml(host.hostname)}</td>
        <td><span class="pill status-${host.status || "unknown"}">${statusLabel(host.status)}</span></td>
        <td>${formatMetric(host.cpuUsage, "%")}</td>
        <td>${formatMetric(host.memoryUsedPercent, "%")}</td>
        <td>${formatMetric(host.diskUsedPercent, "%")}</td>
        <td>${formatMetric(host.averageLatencyMs, " ms")}</td>
        <td>${String(host.alertCount || 0)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7">Sem hosts reais monitorados.</td></tr>`;

  body.querySelectorAll("[data-operational-target]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedTargetId = row.dataset.operationalTarget;
      syncDiagnosticTargetSelector();
      openSelectedDetailView();
    });
  });
}

function openSelectedDetailView() {
  if (!state.selectedTargetId) {
    return;
  }
  switchView("diagnostics");
  syncDiagnosticTargetSelector();
  loadDiagnostics(state.selectedTargetId).catch((error) => {
    if (error.message !== "unauthorized") {
      showFeedback("diagnostic-feedback", error.payload?.message || error.message, true);
    }
  });
}

function bindDashboardDrilldowns() {
  document.querySelectorAll("[data-drilldown='selected-target']").forEach((element) => {
    element.onclick = (event) => {
      const interactive = event.target.closest("button, a, input, select, textarea, tr");
      if (interactive) {
        return;
      }
      openSelectedDetailView();
    };
  });
}

function syncDiagnosticTargetSelector() {
  const selector = document.getElementById("diagnostic-target-selector");
  if (!selector) {
    return;
  }
  const bundles = getTargetBundles();
  selector.innerHTML = bundles.map((bundle) => `
    <option value="${escapeHtml(bundle.target.id)}" ${bundle.target.id === state.selectedTargetId ? "selected" : ""}>
      ${escapeHtml(bundle.target.name)} (${escapeHtml(bundle.target.type)})
    </option>
  `).join("");
}

function getSelectedDiagnosis() {
  return state.selectedTargetId ? state.diagnosticsByTarget[state.selectedTargetId] || null : null;
}

function renderDiagnosticEmpty(containerId, message) {
  document.getElementById(containerId).innerHTML = `<div class="diagnostic-empty">${escapeHtml(message)}</div>`;
}

function renderDiagnosticIdentity(diagnosis) {
  const identity = diagnosis.identity || {};
  document.getElementById("diagnostic-identity").innerHTML = `
    <article class="diagnostic-card">
      <div class="diagnostic-kv">
        <div class="diagnostic-kv-row"><span>Hostname</span><strong>${escapeHtml(identity.hostname || "-")}</strong></div>
        <div class="diagnostic-kv-row"><span>FQDN</span><strong>${escapeHtml(identity.fqdn || "-")}</strong></div>
        <div class="diagnostic-kv-row"><span>Sistema</span><strong>${escapeHtml(identity.os || "-")}</strong></div>
        <div class="diagnostic-kv-row"><span>Versao</span><strong>${escapeHtml(identity.osVersion || "-")}</strong></div>
        <div class="diagnostic-kv-row"><span>Kernel</span><strong>${escapeHtml(identity.kernel || "-")}</strong></div>
        <div class="diagnostic-kv-row"><span>Arquitetura</span><strong>${escapeHtml(identity.arch || "-")}</strong></div>
        <div class="diagnostic-kv-row"><span>Uptime</span><strong>${escapeHtml(formatDuration(identity.uptime))}</strong></div>
      </div>
    </article>
  `;
}

function renderDiagnosticHealth(diagnosis) {
  const health = diagnosis.healthSummary || {};
  document.getElementById("diagnostic-health").innerHTML = `
    <article class="diagnostic-card">
      <div class="diagnostic-meta">
        <span class="pill status-${health.status || "unknown"}">${statusLabel(health.status)}</span>
        <span class="badge badge-muted">${escapeHtml(diagnosis.generatedAt ? new Date(diagnosis.generatedAt).toLocaleString("pt-BR") : "-")}</span>
      </div>
      <ul class="diagnostic-list">
        <li><strong>Status:</strong> ${escapeHtml(health.message || "Sem resumo operacional")}</li>
        <li><strong>Latencia media:</strong> ${escapeHtml(formatMetric(health.averageLatencyMs, " ms"))}</li>
        <li><strong>Packet loss medio:</strong> ${escapeHtml(formatMetric(health.averagePacketLoss, "%"))}</li>
        <li><strong>Jitter medio:</strong> ${escapeHtml(formatMetric(health.averageJitterMs, " ms"))}</li>
        <li><strong>Alertas ativos:</strong> ${escapeHtml(String((health.activeAlerts || []).length))}</li>
      </ul>
    </article>
  `;
}

function renderDiagnosticRelatedTargets(diagnosis) {
  const items = diagnosis.relatedTargets || [];
  if (!items.length) {
    renderDiagnosticEmpty("diagnostic-related-targets", "Nenhum target relacionado encontrado para esta identidade.");
    return;
  }
  document.getElementById("diagnostic-related-targets").innerHTML = items.map((item) => `
    <article class="diagnostic-card">
      <div class="diagnostic-meta">
        <span class="pill status-${item.status || "unknown"}">${statusLabel(item.status)}</span>
        <span class="badge badge-muted">${escapeHtml(item.type)}</span>
      </div>
      <h3>${escapeHtml(item.name)}</h3>
      <ul class="diagnostic-list">
        <li><strong>Endpoint:</strong> ${escapeHtml(item.endpoint || "-")}</li>
        <li><strong>Ultimo check:</strong> ${escapeHtml(item.lastCheckAt ? new Date(item.lastCheckAt).toLocaleString("pt-BR") : "-")}</li>
      </ul>
    </article>
  `).join("");
}

function renderDiagnosticRoles(diagnosis) {
  const roles = diagnosis.detectedRoles || [];
  if (!roles.length) {
    renderDiagnosticEmpty("diagnostic-roles", "Sem evidencia suficiente para classificar um papel provável com confianca minima.");
    return;
  }
  document.getElementById("diagnostic-roles").innerHTML = roles.map((role) => `
    <article class="diagnostic-card">
      <div class="diagnostic-meta">
        <span class="badge badge-muted">${escapeHtml(role.category)}</span>
        <span class="badge badge-muted">Confiança ${escapeHtml(String(role.confidence))}%</span>
      </div>
      <h3>${escapeHtml(role.label)}</h3>
      <div class="confidence-bar" style="--confidence:${escapeHtml(String(role.confidence))}%"><span></span></div>
      <div class="diagnostic-evidence">
        ${(role.evidence || []).map((item) => `
          <div class="diagnostic-evidence-item">
            <strong>${escapeHtml(item.explanation)}</strong>
            <span>${escapeHtml(item.value || item.source)}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderDiagnosticRisks(diagnosis) {
  const risks = diagnosis.risks || [];
  if (!risks.length) {
    renderDiagnosticEmpty("diagnostic-risks", "Nenhum risco objetivo identificado com os dados reais disponíveis neste momento.");
    return;
  }
  document.getElementById("diagnostic-risks").innerHTML = risks.map((risk) => `
    <article class="diagnostic-card">
      <div class="diagnostic-meta">
        <span class="pill status-${risk.severity === "critical" ? "down" : risk.severity === "warning" ? "degraded" : "up"}">${escapeHtml(risk.severity)}</span>
        <span class="badge badge-muted">${escapeHtml(risk.category)}</span>
      </div>
      <h3>${escapeHtml(risk.title)}</h3>
      <ul class="diagnostic-list">
        ${(risk.details || []).map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}
      </ul>
    </article>
  `).join("");
}

function renderSimpleDiagnosticCards(containerId, items, emptyMessage, mapper) {
  if (!items.length) {
    renderDiagnosticEmpty(containerId, emptyMessage);
    return;
  }
  document.getElementById(containerId).innerHTML = items.map(mapper).join("");
}

function renderDiagnostics() {
  syncDiagnosticTargetSelector();
  if (!state.snapshot || !state.selectedTargetId) {
    [
      "diagnostic-identity",
      "diagnostic-health",
      "diagnostic-related-targets",
      "diagnostic-roles",
      "diagnostic-risks",
      "diagnostic-gaps",
      "diagnostic-profiles",
      "diagnostic-checks",
      "diagnostic-actions",
      "diagnostic-notes"
    ].forEach((containerId) => renderDiagnosticEmpty(containerId, "Selecione um target para diagnosticar."));
    return;
  }

  if (state.diagnosticsLoadingTargetId === state.selectedTargetId) {
    [
      "diagnostic-identity",
      "diagnostic-health",
      "diagnostic-related-targets",
      "diagnostic-roles",
      "diagnostic-risks",
      "diagnostic-gaps",
      "diagnostic-profiles",
      "diagnostic-checks",
      "diagnostic-actions",
      "diagnostic-notes"
    ].forEach((containerId) => renderDiagnosticEmpty(containerId, "Carregando diagnostico com evidencias reais do backend..."));
    return;
  }

  const diagnosis = getSelectedDiagnosis();
  if (!diagnosis) {
    [
      "diagnostic-identity",
      "diagnostic-health",
      "diagnostic-related-targets",
      "diagnostic-roles",
      "diagnostic-risks",
      "diagnostic-gaps",
      "diagnostic-profiles",
      "diagnostic-checks",
      "diagnostic-actions",
      "diagnostic-notes"
    ].forEach((containerId) => renderDiagnosticEmpty(containerId, "Sem snapshot diagnostico ainda. Use Atualizar diagnostico para gerar um snapshot explicavel."));
    return;
  }

  renderDiagnosticIdentity(diagnosis);
  renderDiagnosticHealth(diagnosis);
  renderDiagnosticRelatedTargets(diagnosis);
  renderDiagnosticRoles(diagnosis);
  renderDiagnosticRisks(diagnosis);
  renderSimpleDiagnosticCards("diagnostic-gaps", diagnosis.monitoringGaps || [], "Nenhuma lacuna de monitoramento identificada.", (gap) => `
    <article class="diagnostic-card">
      <div class="diagnostic-meta">
        <span class="pill status-${gap.severity === "warning" ? "degraded" : "up"}">${escapeHtml(gap.severity)}</span>
        ${gap.suggestedProfileId ? `<span class="badge badge-muted">${escapeHtml(gap.suggestedProfileId)}</span>` : ""}
      </div>
      <h3>${escapeHtml(gap.message)}</h3>
      <ul class="diagnostic-list">${(gap.reasons || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>
  `);
  renderSimpleDiagnosticCards("diagnostic-profiles", diagnosis.recommendedProfiles || [], "Nenhum perfil recomendado com base nas evidencias atuais.", (profile) => `
    <article class="diagnostic-card" data-recommended-profile="${escapeHtml(profile.id)}">
      <div class="diagnostic-meta">
        <span class="badge badge-muted">${escapeHtml(profile.category)}</span>
        <span class="badge badge-muted">Confiança ${escapeHtml(String(profile.confidence))}%</span>
      </div>
      <h3>${escapeHtml(profile.name)}</h3>
      <ul class="diagnostic-list"><li>${escapeHtml(profile.reason)}</li></ul>
    </article>
  `);
  renderSimpleDiagnosticCards("diagnostic-checks", diagnosis.recommendedChecks || [], "Nenhum check adicional recomendado com base nas evidencias atuais.", (check) => `
    <article class="diagnostic-card">
      <div class="diagnostic-meta">
        <span class="badge badge-muted">${escapeHtml(check.type)}</span>
        <span class="pill status-${check.priority === "critical" ? "down" : check.priority === "warning" ? "degraded" : "up"}">${escapeHtml(check.priority || "info")}</span>
      </div>
      <h3>${escapeHtml(check.reason)}</h3>
      <ul class="diagnostic-list">
        ${check.proposedTarget ? `<li><strong>Proposta:</strong> ${escapeHtml(JSON.stringify(check.proposedTarget))}</li>` : ""}
        ${(check.requirements || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `);
  renderSimpleDiagnosticCards("diagnostic-actions", diagnosis.suggestedActions || [], "Nenhuma acao sugerida no momento.", (action) => `
    <article class="diagnostic-card"><ul class="diagnostic-list"><li>${escapeHtml(action)}</li></ul></article>
  `);
  renderSimpleDiagnosticCards("diagnostic-notes", [...(diagnosis.notes || []), ...(diagnosis.limitations || [])], "Sem notas adicionais.", (note) => `
    <article class="diagnostic-card"><ul class="diagnostic-list"><li>${escapeHtml(note)}</li></ul></article>
  `);
}

async function loadDiagnostics(targetId, force = false) {
  if (!targetId) {
    return;
  }
  if (!force && state.diagnosticsByTarget[targetId]) {
    renderDiagnostics();
    return;
  }
  state.diagnosticsLoadingTargetId = targetId;
  renderDiagnostics();
  try {
    const endpoint = force ? `/api/diagnostics/run/${encodeURIComponent(targetId)}` : `/api/diagnostics/${encodeURIComponent(targetId)}`;
    const payload = await requestJson(endpoint, force ? { method: "POST" } : {});
    state.diagnosticsByTarget[targetId] = payload.diagnosis;
    showFeedback("diagnostic-feedback", force ? "Diagnostico atualizado com sucesso." : "");
  } catch (error) {
    if (error.message !== "unauthorized") {
      showFeedback("diagnostic-feedback", error.payload?.message || error.message, true);
    }
  } finally {
    state.diagnosticsLoadingTargetId = null;
    renderDiagnostics();
  }
}

async function openRecommendedProfileFromDiagnosis() {
  const diagnosis = getSelectedDiagnosis();
  const profile = diagnosis?.recommendedProfiles?.[0];
  if (!profile) {
    showFeedback("diagnostic-feedback", "Nao ha perfil recomendado suficiente para abrir no momento.", true);
    return;
  }
  if (!isAdmin()) {
    showFeedback("diagnostic-feedback", "Apenas admin pode abrir a criacao com perfil recomendado.", true);
    return;
  }

  const bundle = getSelectedBundle();
  const latestAgent = getLatestAgentMetrics(bundle);
  const targetHost = bundle?.target?.host || extractHostnameFromUrl(bundle?.target?.url) || latestAgent?.hostname || "";
  const baseUrl = bundle?.target?.type === "http" ? bundle.target.url : "";
  const agentBundle = getTargetBundles().find((item) => item.target.type === "agent" && (item.target.url || "").includes(targetHost));
  const agentUrl = agentBundle?.target?.url || "";

  await openTargetDialog();
  document.getElementById("target-creation-mode").value = "profile";
  updateTargetCreationModeVisibility();
  document.getElementById("profile-category").value = profile.category === "network" ? "network" : "server";
  renderMonitoringProfileOptions();
  document.getElementById("profile-selector").value = profile.id;
  renderMonitoringProfileDescription();
  document.getElementById("profile-asset-name").value = bundle?.target?.name || latestAgent?.hostname || "";
  document.getElementById("profile-host").value = targetHost;
  document.getElementById("profile-base-url").value = baseUrl;
  document.getElementById("profile-agent-url").value = agentUrl;
  await applyMonitoringProfile();
  switchView("targets");
}

async function loadOnboardingEligible() {
  const data = await requestJson("/api/onboarding/eligible");
  state.onboardingHosts = data.hosts || [];
  ensureSelectedOnboardingHost();
  renderOnboarding();
  if (state.selectedOnboardingTargetId && !state.onboardingPlansByTarget[state.selectedOnboardingTargetId]) {
    await loadOnboardingPlan(state.selectedOnboardingTargetId);
  }
}

async function loadOnboardingPlan(targetId, force = false) {
  if (!targetId) {
    return;
  }
  state.onboardingLoadingTargetId = targetId;
  renderOnboarding();
  try {
    const endpoint = force ? `/api/onboarding/analyze/${encodeURIComponent(targetId)}` : `/api/onboarding/${encodeURIComponent(targetId)}`;
    const payload = await requestJson(endpoint, force ? { method: "POST" } : {});
    state.onboardingPlansByTarget[targetId] = payload.plan;
    state.onboardingDraftsByTarget[targetId] = (payload.plan?.recommendation?.drafts || []).map((draft) => ({
      name: draft.name,
      type: draft.type,
      host: draft.host,
      url: draft.url,
      port: draft.port,
      timeout: draft.timeout,
      intervalSeconds: draft.intervalSeconds,
      enabled: draft.enabled,
      secret: draft.secret,
      metadata: { ...(draft.metadata || {}) },
      thresholds: { ...(draft.thresholds || {}) },
      requirements: [...(draft.requirements || [])],
      validation: { ...(draft.validation || {}) }
    }));
    showFeedback("onboarding-feedback", force ? "Analise de onboarding atualizada com sucesso." : "");
  } catch (error) {
    if (error.message !== "unauthorized") {
      showFeedback("onboarding-feedback", error.payload?.message || error.message, true);
    }
  } finally {
    state.onboardingLoadingTargetId = null;
    renderOnboarding();
  }
}

function getSelectedOnboardingPlan() {
  return state.selectedOnboardingTargetId ? state.onboardingPlansByTarget[state.selectedOnboardingTargetId] || null : null;
}

function getSelectedOnboardingDrafts() {
  return state.selectedOnboardingTargetId ? state.onboardingDraftsByTarget[state.selectedOnboardingTargetId] || [] : [];
}

function renderOnboarding() {
  const hostList = document.getElementById("onboarding-host-list");
  if (!hostList) {
    return;
  }

  hostList.innerHTML = state.onboardingHosts.map((host) => `
    <article class="target-card ${state.selectedOnboardingTargetId === host.targetId ? "active" : ""}" data-onboarding-target="${host.targetId}">
      <div class="target-card-top">
        <div>
          <div class="target-card-name">${escapeHtml(host.identity?.hostname || host.hostId || host.targetId)}</div>
          <div class="target-card-type">${escapeHtml(host.probableRole || "Sem classificacao fechada")}</div>
        </div>
        <span class="pill status-${host.status === "ready" ? "up" : host.status === "needs_review" ? "degraded" : "unknown"}">${escapeHtml(host.status)}</span>
      </div>
      <div class="target-card-grid">
        <div class="target-card-stat"><span>Perfil</span><strong>${escapeHtml(host.recommendedProfile?.name || "-")}</strong></div>
        <div class="target-card-stat"><span>Confianca</span><strong>${formatMetric(host.confidence, "%")}</strong></div>
        <div class="target-card-stat"><span>Relacionados</span><strong>${escapeHtml(String(host.relatedTargets || 0))}</strong></div>
        <div class="target-card-stat"><span>Ultima coleta</span><strong>${escapeHtml(host.createdAt ? formatTime(host.createdAt) : "-")}</strong></div>
      </div>
      <div class="muted onboarding-host-note">${escapeHtml(host.reason)}</div>
    </article>
  `).join("") || `<p class="empty-state">Nenhum host com agente ativo esta elegivel para onboarding neste momento.</p>`;

  hostList.querySelectorAll("[data-onboarding-target]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedOnboardingTargetId = element.dataset.onboardingTarget;
      renderOnboarding();
      loadOnboardingPlan(state.selectedOnboardingTargetId).catch((error) => {
        if (error.message !== "unauthorized") {
          showFeedback("onboarding-feedback", error.payload?.message || error.message, true);
        }
      });
    });
  });

  const plan = getSelectedOnboardingPlan();
  const loading = state.onboardingLoadingTargetId && state.onboardingLoadingTargetId === state.selectedOnboardingTargetId;
  document.getElementById("run-onboarding-analysis").disabled = !state.selectedOnboardingTargetId || loading;
  document.getElementById("apply-onboarding").disabled = !plan?.recommendation?.applyReady || loading || !isAdmin();

  if (!state.selectedOnboardingTargetId) {
    document.getElementById("onboarding-title").textContent = "Selecione um host elegivel";
    document.getElementById("onboarding-subtitle").textContent = "O sistema vai reutilizar o diagnostico e os perfis existentes para sugerir targets reais, sempre com confirmacao do admin.";
    document.getElementById("onboarding-summary").innerHTML = `<p class="empty-state">Ainda nao ha host selecionado para onboarding.</p>`;
    document.getElementById("onboarding-identity").innerHTML = `<div class="diagnostic-empty">Sem host selecionado.</div>`;
    document.getElementById("onboarding-evidence").innerHTML = `<div class="diagnostic-empty">Sem analise carregada.</div>`;
    document.getElementById("onboarding-gaps").innerHTML = `<div class="diagnostic-empty">Sem lacunas calculadas.</div>`;
    document.getElementById("onboarding-profile").innerHTML = `<div class="diagnostic-empty">Sem perfil sugerido.</div>`;
    document.getElementById("onboarding-drafts-empty").classList.remove("is-hidden");
    document.getElementById("onboarding-drafts").innerHTML = "";
    return;
  }

  const hostSummary = state.onboardingHosts.find((host) => host.targetId === state.selectedOnboardingTargetId) || null;
  document.getElementById("onboarding-title").textContent = hostSummary?.identity?.hostname || hostSummary?.hostId || "Host em onboarding";
  document.getElementById("onboarding-subtitle").textContent = loading
    ? "Executando diagnostico e correlacionando evidencias reais..."
    : hostSummary?.reason || "Revise a recomendacao antes de aplicar.";

  if (!plan) {
    document.getElementById("onboarding-summary").innerHTML = `<p class="empty-state">${loading ? "Carregando analise real do backend..." : "Sem plano de onboarding carregado para este host."}</p>`;
    document.getElementById("onboarding-identity").innerHTML = `<div class="diagnostic-empty">Aguardando analise.</div>`;
    document.getElementById("onboarding-evidence").innerHTML = `<div class="diagnostic-empty">Aguardando analise.</div>`;
    document.getElementById("onboarding-gaps").innerHTML = `<div class="diagnostic-empty">Aguardando analise.</div>`;
    document.getElementById("onboarding-profile").innerHTML = `<div class="diagnostic-empty">Aguardando analise.</div>`;
    document.getElementById("onboarding-drafts-empty").classList.remove("is-hidden");
    document.getElementById("onboarding-drafts").innerHTML = "";
    return;
  }

  const diagnosis = plan.diagnosis || {};
  const primaryRole = diagnosis.detectedRoles?.[0] || null;
  const recommendation = plan.recommendation || {};
  const drafts = getSelectedOnboardingDrafts();

  document.getElementById("onboarding-summary").innerHTML = `
    <article class="metric-card">
      <span class="metric-card-label">Status</span>
      <strong class="metric-card-value">${escapeHtml(plan.onboarding?.status || "-")}</strong>
      <span class="metric-card-note">${escapeHtml(plan.onboarding?.reason || "-")}</span>
    </article>
    <article class="metric-card">
      <span class="metric-card-label">Papel provavel</span>
      <strong class="metric-card-value">${escapeHtml(primaryRole?.label || "Sem papel fechado")}</strong>
      <span class="metric-card-note">Confianca ${escapeHtml(formatMetric(primaryRole?.confidence, "%"))}</span>
    </article>
      <article class="metric-card">
        <span class="metric-card-label">Perfil sugerido</span>
      <strong class="metric-card-value">${escapeHtml(recommendation.profiles?.length ? recommendation.profiles.map((profile) => profile.name).join(" + ") : recommendation.profile?.name || "-")}</strong>
      <span class="metric-card-note">${escapeHtml(recommendation.applyReady ? "Pronto para aplicar" : "Requer revisao manual")}</span>
      </article>
    <article class="metric-card">
      <span class="metric-card-label">Targets novos</span>
      <strong class="metric-card-value">${escapeHtml(String(drafts.length))}</strong>
      <span class="metric-card-note">${escapeHtml(String(recommendation.skippedExisting?.length || 0))} checks ja estavam cobertos</span>
    </article>
  `;

  document.getElementById("onboarding-identity").innerHTML = `
    <div class="diagnostic-kv">
      <div class="diagnostic-kv-row"><span>Hostname</span><strong>${escapeHtml(plan.identity?.hostname || "-")}</strong></div>
      <div class="diagnostic-kv-row"><span>FQDN</span><strong>${escapeHtml(plan.identity?.fqdn || "-")}</strong></div>
      <div class="diagnostic-kv-row"><span>Sistema</span><strong>${escapeHtml(plan.identity?.os || "-")}</strong></div>
      <div class="diagnostic-kv-row"><span>Uptime</span><strong>${escapeHtml(formatDuration(plan.identity?.uptime))}</strong></div>
      <div class="diagnostic-kv-row"><span>Target origem</span><strong>${escapeHtml(state.selectedOnboardingTargetId)}</strong></div>
      <div class="diagnostic-kv-row"><span>Relacionados</span><strong>${escapeHtml(String((plan.relatedTargets || []).length))}</strong></div>
    </div>
  `;

  document.getElementById("onboarding-evidence").innerHTML = primaryRole
    ? `
      <div class="diagnostic-meta">
        <span class="badge badge-muted">${escapeHtml(primaryRole.category)}</span>
        <span class="badge badge-muted">Confianca ${escapeHtml(String(primaryRole.confidence))}%</span>
      </div>
      <div class="diagnostic-evidence">
        ${(primaryRole.evidence || []).map((item) => `
          <div class="diagnostic-evidence-item">
            <strong>${escapeHtml(item.explanation)}</strong>
            <span>${escapeHtml(item.value || item.source)}</span>
          </div>
        `).join("")}
      </div>
      <ul class="diagnostic-list">
        ${(diagnosis.risks || []).slice(0, 5).map((risk) => `<li><strong>${escapeHtml(risk.severity)}:</strong> ${escapeHtml(risk.title)}</li>`).join("") || "<li>Nenhum risco adicional identificado.</li>"}
      </ul>
    `
    : `<div class="diagnostic-empty">Sem evidencia suficiente para fechar um papel provavel com confianca minima.</div>`;

  document.getElementById("onboarding-gaps").innerHTML = (diagnosis.monitoringGaps || []).length
    ? (diagnosis.monitoringGaps || []).map((gap) => `
      <article class="diagnostic-card diagnostic-card-nested">
        <div class="diagnostic-meta">
          <span class="pill status-${gap.severity === "warning" ? "degraded" : gap.severity === "critical" ? "down" : "unknown"}">${escapeHtml(gap.severity)}</span>
          ${gap.suggestedProfileId ? `<span class="badge badge-muted">${escapeHtml(gap.suggestedProfileId)}</span>` : ""}
        </div>
        <ul class="diagnostic-list">
          <li>${escapeHtml(gap.message)}</li>
          ${(gap.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
        </ul>
      </article>
    `).join("")
    : `<div class="diagnostic-empty">Nenhuma lacuna objetiva de monitoramento foi encontrada com os dados atuais.</div>`;

  document.getElementById("onboarding-profile").innerHTML = recommendation.profiles?.length
    ? `
      <div class="diagnostic-meta">
        <span class="badge badge-muted">${escapeHtml(recommendation.profiles.map((profile) => profile.category).filter((value, index, items) => items.indexOf(value) === index).join(" + "))}</span>
        <span class="pill status-${recommendation.applyReady ? "up" : "degraded"}">${recommendation.applyReady ? "Pronto" : "Revisao"}</span>
      </div>
      <h3>${escapeHtml(recommendation.profiles.map((profile) => profile.name).join(" + "))}</h3>
      <div class="diagnostic-evidence">
        ${(recommendation.profiles || []).map((profile) => `
          <div class="diagnostic-evidence-item">
            <strong>${escapeHtml(profile.name)}</strong>
            <span>${escapeHtml(profile.description || "Sem descricao adicional.")}</span>
          </div>
        `).join("")}
      </div>
      <ul class="diagnostic-list">
        ${(recommendation.requirements || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Nenhum requisito extra para aplicar.</li>"}
      </ul>
      ${(recommendation.skippedExisting || []).length ? `
        <div class="diagnostic-evidence">
          ${(recommendation.skippedExisting || []).map((item) => `
            <div class="diagnostic-evidence-item">
              <strong>${escapeHtml(item.type.toUpperCase())}</strong>
              <span>${escapeHtml(item.reason)}</span>
            </div>
          `).join("")}
        </div>
      ` : ""}
    `
    : `<div class="diagnostic-empty">Nao ha perfil recomendado suficiente para este host com os dados atuais.</div>`;

  renderOnboardingDrafts(drafts);
}

function renderOnboardingDrafts(drafts) {
  const empty = document.getElementById("onboarding-drafts-empty");
  const container = document.getElementById("onboarding-drafts");
  empty.classList.toggle("is-hidden", drafts.length > 0);
  container.innerHTML = drafts.map((draft, index) => `
    <article class="profile-draft-card" data-onboarding-draft-index="${index}">
      <div class="profile-draft-header">
        <div>
          <strong>${escapeHtml(draft.name)}</strong>
          <div class="profile-draft-meta">${escapeHtml(draft.type.toUpperCase())}${draft.sourceProfiles?.length ? ` | ${escapeHtml(draft.sourceProfiles.join(" + "))}` : ""}</div>
        </div>
        <span class="pill status-${draft.validation?.valid ? "up" : "degraded"}">${draft.validation?.valid ? "Valido" : "Revisar"}</span>
      </div>
      <div class="form-grid">
        <label><span>Nome</span><input data-field="name" value="${escapeHtml(draft.name)}"></label>
        <label><span>Tipo</span><input value="${escapeHtml(draft.type)}" disabled></label>
        <label class="${draft.type === "http" || draft.type === "agent" ? "" : "is-hidden"}"><span>URL</span><input data-field="url" value="${escapeHtml(draft.url || "")}"></label>
        <label class="${draft.type === "http" || draft.type === "agent" ? "is-hidden" : ""}"><span>Host</span><input data-field="host" value="${escapeHtml(draft.host || "")}"></label>
        <label class="${draft.type === "tcp" ? "" : "is-hidden"}"><span>Porta</span><input data-field="port" type="number" min="1" max="65535" value="${escapeHtml(String(draft.port || ""))}"></label>
        <label><span>Timeout (ms)</span><input data-field="timeout" type="number" min="500" value="${escapeHtml(String(draft.timeout))}"></label>
        <label><span>Intervalo (s)</span><input data-field="intervalSeconds" type="number" min="5" value="${escapeHtml(String(draft.intervalSeconds))}"></label>
        <label><span>Ativo</span><select data-field="enabled"><option value="true" ${draft.enabled ? "selected" : ""}>Sim</option><option value="false" ${draft.enabled ? "" : "selected"}>Nao</option></select></label>
        <label class="${draft.type === "agent" ? "" : "is-hidden"}"><span>Secret</span><input data-field="secret" value="${escapeHtml(draft.secret || "")}"></label>
        <label class="${draft.type === "dns" ? "" : "is-hidden"}"><span>Lookup DNS</span><input data-field="lookupHostname" value="${escapeHtml(draft.metadata?.lookupHostname || "")}" placeholder="Informe um hostname real resolvivel"></label>
      </div>
      <div class="form-grid">
        <label><span>Latencia warning</span><input data-threshold="warningLatencyMs" type="number" value="${escapeHtml(String(draft.thresholds.warningLatencyMs))}"></label>
        <label><span>Latencia critical</span><input data-threshold="criticalLatencyMs" type="number" value="${escapeHtml(String(draft.thresholds.criticalLatencyMs))}"></label>
        <label><span>Packet loss warning</span><input data-threshold="warningPacketLoss" type="number" value="${escapeHtml(String(draft.thresholds.warningPacketLoss))}"></label>
        <label><span>Packet loss critical</span><input data-threshold="criticalPacketLoss" type="number" value="${escapeHtml(String(draft.thresholds.criticalPacketLoss))}"></label>
        <label><span>CPU warning</span><input data-threshold="cpuUsageWarning" type="number" value="${escapeHtml(String(draft.thresholds.cpuUsageWarning))}"></label>
        <label><span>CPU critical</span><input data-threshold="cpuUsageCritical" type="number" value="${escapeHtml(String(draft.thresholds.cpuUsageCritical))}"></label>
        <label><span>RAM warning</span><input data-threshold="memoryUsageWarning" type="number" value="${escapeHtml(String(draft.thresholds.memoryUsageWarning))}"></label>
        <label><span>RAM critical</span><input data-threshold="memoryUsageCritical" type="number" value="${escapeHtml(String(draft.thresholds.memoryUsageCritical))}"></label>
        <label><span>Disco warning</span><input data-threshold="diskUsageWarning" type="number" value="${escapeHtml(String(draft.thresholds.diskUsageWarning))}"></label>
        <label><span>Disco critical</span><input data-threshold="diskUsageCritical" type="number" value="${escapeHtml(String(draft.thresholds.diskUsageCritical))}"></label>
        <label><span>Jitter warning</span><input data-threshold="jitterWarningMs" type="number" value="${escapeHtml(String(draft.thresholds.jitterWarningMs))}"></label>
        <label><span>Jitter critical</span><input data-threshold="jitterCriticalMs" type="number" value="${escapeHtml(String(draft.thresholds.jitterCriticalMs))}"></label>
      </div>
      <div class="diagnostic-list onboarding-draft-validation">
        ${(draft.requirements || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        ${draft.validation?.valid ? `<li>Pronto para validacao final do backend.</li>` : `<li>${escapeHtml(draft.validation?.message || "Revisao necessaria antes da aplicacao.")}</li>`}
      </div>
    </article>
  `).join("");
}

function collectOnboardingDraftsFromDom() {
  return [...document.querySelectorAll("[data-onboarding-draft-index]")].map((card) => ({
    name: card.querySelector("[data-field='name']").value.trim(),
    type: getSelectedOnboardingDrafts()[Number(card.dataset.onboardingDraftIndex)].type,
    host: card.querySelector("[data-field='host']")?.value.trim() || undefined,
    url: card.querySelector("[data-field='url']")?.value.trim() || undefined,
    port: card.querySelector("[data-field='port']")?.value ? Number(card.querySelector("[data-field='port']").value) : undefined,
    timeout: Number(card.querySelector("[data-field='timeout']").value),
    intervalSeconds: Number(card.querySelector("[data-field='intervalSeconds']").value),
    enabled: card.querySelector("[data-field='enabled']").value === "true",
    secret: card.querySelector("[data-field='secret']")?.value.trim() || undefined,
    metadata: {
      ...(getSelectedOnboardingDrafts()[Number(card.dataset.onboardingDraftIndex)].metadata || {}),
      ...(card.querySelector("[data-field='lookupHostname']") ? { lookupHostname: card.querySelector("[data-field='lookupHostname']").value.trim() || "" } : {})
    },
    thresholds: Object.fromEntries([...card.querySelectorAll("[data-threshold]")].map((input) => [input.dataset.threshold, Number(input.value)]))
  }));
}

async function applyOnboardingRecommendation() {
  if (!isAdmin() || !state.selectedOnboardingTargetId) {
    return;
  }

  const plan = getSelectedOnboardingPlan();
  if (!plan?.recommendation?.profile) {
    showFeedback("onboarding-feedback", "Nao existe perfil recomendado suficiente para aplicar neste host.", true);
    return;
  }

  const profileLabel = plan.recommendation.profiles?.length
    ? plan.recommendation.profiles.map((profile) => profile.name).join(" + ")
    : plan.recommendation.profile.name;
  if (!window.confirm(`Aplicar a configuracao recomendada (${profileLabel}) e criar os targets revisados para ${plan.identity?.hostname || plan.hostId}?`)) {
    return;
  }

  try {
    const targets = collectOnboardingDraftsFromDom();
    const result = await requestJson(`/api/onboarding/apply/${encodeURIComponent(state.selectedOnboardingTargetId)}`, {
      method: "POST",
      body: JSON.stringify({
        profileId: plan.recommendation.profile.id,
        profileIds: (plan.recommendation.profiles || []).map((profile) => profile.id),
        targets
      })
    });
    showFeedback("onboarding-feedback", `Onboarding aplicado com ${result.createdTargets?.length || 0} targets criados.`);
    await bootstrap();
    await loadOnboardingEligible();
  } catch (error) {
    if (error.message !== "unauthorized") {
      showFeedback("onboarding-feedback", error.payload?.message || error.message, true);
    }
  }
}

function renderTargetsAdmin() {
  const body = document.getElementById("targets-admin-body");
  if (!body) {
    return;
  }
  body.innerHTML = getTargetBundles().map((bundle) => `
    <tr>
      <td>${escapeHtml(bundle.target.name)}</td>
      <td>${escapeHtml(bundle.target.type)}</td>
      <td><span class="pill status-${bundle.current?.status || "unknown"}">${statusLabel(bundle.current?.status)}</span></td>
      <td>${escapeHtml(bundle.target.host || bundle.target.url || "-")}</td>
      <td>${bundle.target.intervalSeconds}s</td>
      <td>${bundle.target.secretConfigured ? "Configurado" : "Nao"}</td>
      <td class="actions-cell">
        <button class="btn btn-secondary-dark small-btn" data-edit-target="${bundle.target.id}">Editar</button>
        <button class="btn btn-secondary-dark small-btn" data-toggle-target="${bundle.target.id}">${bundle.target.enabled ? "Desativar" : "Ativar"}</button>
        <button class="btn btn-secondary-dark small-btn" data-delete-target="${bundle.target.id}">Remover</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7">Nenhum target cadastrado.</td></tr>`;

  body.querySelectorAll("[data-edit-target]").forEach((button) => {
    button.addEventListener("click", () => {
      openTargetDialog(button.dataset.editTarget).catch((error) => {
        showFeedback("targets-feedback", error.payload?.message || error.message, true);
      });
    });
  });
  body.querySelectorAll("[data-toggle-target]").forEach((button) => {
    button.addEventListener("click", () => toggleTarget(button.dataset.toggleTarget));
  });
  body.querySelectorAll("[data-delete-target]").forEach((button) => {
    button.addEventListener("click", () => removeTarget(button.dataset.deleteTarget));
  });
}

function renderUsers() {
  const body = document.getElementById("users-body");
  if (!body) {
    return;
  }
  body.innerHTML = state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${user.enabled ? "Ativo" : "Inativo"}</td>
      <td>${new Date(user.createdAt).toLocaleString("pt-BR")}</td>
      <td>${new Date(user.updatedAt).toLocaleString("pt-BR")}</td>
      <td class="actions-cell">
        <button class="btn btn-secondary-dark small-btn" data-edit-user="${user.username}">Editar</button>
        <button class="btn btn-secondary-dark small-btn" data-reset-password="${user.username}">Senha</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6">Nenhum usuario encontrado.</td></tr>`;

  body.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.addEventListener("click", () => openUserDialog(button.dataset.editUser));
  });
  body.querySelectorAll("[data-reset-password]").forEach((button) => {
    button.addEventListener("click", () => openPasswordResetDialog(button.dataset.resetPassword));
  });
}

function renderAudit() {
  const body = document.getElementById("audit-body");
  if (!body) {
    return;
  }
  body.innerHTML = state.auditEvents.map((event) => `
    <tr>
      <td>${new Date(event.createdAt).toLocaleString("pt-BR")}</td>
      <td>${escapeHtml(event.actionType)}</td>
      <td>${escapeHtml(event.actorUsername || "sistema")}</td>
      <td>${escapeHtml(event.targetId || "-")}</td>
      <td>${escapeHtml(event.summary)}</td>
      <td>${escapeHtml(event.ipAddress || "-")}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">Nenhum evento de auditoria encontrado.</td></tr>`;
}

async function loadUsers() {
  const data = await requestJson("/api/admin/users");
  state.users = data.users;
  renderUsers();
}

async function loadAudit() {
  const formData = new FormData(document.getElementById("audit-filter-form"));
  const query = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (value) {
      query.set(key, key === "from" || key === "to" ? new Date(value).toISOString() : value);
    }
  }
  const data = await requestJson(`/api/admin/audit?${query.toString()}`);
  state.auditEvents = data.events;
  renderAudit();
}

async function executeCheck(targetId) {
  if (!isAdmin()) {
    return;
  }
  try {
    await requestJson(`/api/targets/${targetId}/check`, { method: "POST" });
    showFeedback("targets-feedback", "Check manual executado com sucesso.");
  } catch (error) {
    if (error.message !== "unauthorized") {
      showFeedback("targets-feedback", error.payload?.message || error.message, true);
    }
  }
}

function makeChart(canvasId, key, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    return;
  }
  setChartShellState(canvasId, "ready", "");
  if (state.charts.has(key)) {
    state.charts.get(key).destroy();
  }
  state.charts.set(key, new Chart(canvas, config));
}

function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: chartPalette.text,
          boxWidth: 12,
          usePointStyle: true
        }
      }
    },
    scales: {
      x: {
        ticks: { color: chartPalette.muted, maxRotation: 0, autoSkip: true },
        grid: { color: chartPalette.grid }
      },
      y: {
        ticks: { color: chartPalette.muted },
        grid: { color: chartPalette.grid }
      }
    }
  };
}

function percentageChartOptions() {
  const options = baseChartOptions();
  options.scales.y.min = 0;
  options.scales.y.max = 100;
  options.scales.y.ticks.callback = (value) => `${value}%`;
  return options;
}

function rateChartOptions() {
  const options = baseChartOptions();
  options.scales.y.ticks.callback = (value) => formatBytes(value);
  return options;
}

function metricChartOptions(suffix) {
  const options = baseChartOptions();
  options.scales.y.ticks.callback = (value) => `${value}${suffix}`;
  return options;
}

function stackedChartOptions() {
  const options = baseChartOptions();
  options.scales.x.stacked = true;
  options.scales.y.stacked = true;
  return options;
}

function latencyBarColor(status) {
  if (status === "down") {
    return "rgba(255, 92, 112, 0.76)";
  }
  if (status === "degraded") {
    return "rgba(255, 184, 77, 0.72)";
  }
  return "rgba(77, 163, 255, 0.72)";
}

function formatMetric(value, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) {
    return "-";
  }
  const numericValue = Number(value);
  return `${numericValue.toFixed(numericValue % 1 === 0 ? 0 : 2)}${suffix}`;
}

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) {
    return "-";
  }
  const whole = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatBytes(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(value);
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[index]}`;
}

function statusLabel(status) {
  return {
    up: "Online",
    down: "Critical",
    degraded: "Warning",
    unknown: "Aguardando"
  }[status || "unknown"];
}

function mapOperstateToStatus(operstate) {
  const value = String(operstate || "").toLowerCase();
  if (value === "up") {
    return "up";
  }
  if (value === "down") {
    return "down";
  }
  return "unknown";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function extractHostnameFromUrl(value) {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).hostname;
  } catch (_) {
    return "";
  }
}

async function loadMonitoringProfiles() {
  if (state.monitoringProfiles.length) {
    return state.monitoringProfiles;
  }
  const data = await requestJson("/api/monitoring-profiles");
  state.monitoringProfiles = data.profiles || [];
  return state.monitoringProfiles;
}

async function ensureMonitoringProfilesLoaded() {
  try {
    await loadMonitoringProfiles();
    renderMonitoringProfileOptions();
    return true;
  } catch (error) {
    showError("target-form-error", error.payload?.message || error.message);
    document.getElementById("profile-description").innerHTML = "";
    document.getElementById("profile-selector").innerHTML = "";
    return false;
  }
}

function updateTargetCreationModeVisibility() {
  const mode = document.getElementById("target-creation-mode")?.value || "manual";
  const isEditing = Boolean(state.editingTargetId);
  document.getElementById("target-creation-mode-wrap").classList.toggle("is-hidden", isEditing);
  document.getElementById("manual-target-fields").classList.toggle("is-hidden", !isEditing && mode !== "manual");
  document.getElementById("profile-builder").classList.toggle("is-hidden", isEditing || mode !== "profile");
  document.getElementById("save-target-button").textContent = !isEditing && mode === "profile" ? "Salvar perfil" : "Salvar target";

  if (!isEditing && mode === "profile" && !state.monitoringProfiles.length) {
    ensureMonitoringProfilesLoaded().catch(() => {});
  }
}

function getProfilesByCategory(category) {
  return state.monitoringProfiles.filter((profile) => profile.category === category);
}

function renderMonitoringProfileOptions() {
  const category = document.getElementById("profile-category").value;
  const selector = document.getElementById("profile-selector");
  const profiles = getProfilesByCategory(category);
  selector.innerHTML = profiles.length
    ? profiles.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)}</option>`).join("")
    : `<option value="">Nenhum perfil disponivel</option>`;
  renderMonitoringProfileDescription();
}

function getSelectedMonitoringProfile() {
  const selector = document.getElementById("profile-selector");
  return state.monitoringProfiles.find((profile) => profile.id === selector.value) || null;
}

function renderMonitoringProfileDescription() {
  const profile = getSelectedMonitoringProfile();
  const container = document.getElementById("profile-description");
  if (!profile) {
    container.innerHTML = `<span>Nenhum perfil carregado para esta categoria.</span>`;
    return;
  }
  container.innerHTML = `
    <strong>${escapeHtml(profile.name)}</strong>
    <span>${escapeHtml(profile.description)}</span>
    <ul class="profile-observations">${(profile.observations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
}

function buildProfileContext() {
  const dbPortRaw = document.getElementById("profile-database-port").value.trim();
  const appPortRaw = document.getElementById("profile-application-port").value.trim();
  return {
    assetName: document.getElementById("profile-asset-name").value.trim(),
    host: document.getElementById("profile-host").value.trim(),
    baseUrl: document.getElementById("profile-base-url").value.trim(),
    agentUrl: document.getElementById("profile-agent-url").value.trim(),
    agentSecret: document.getElementById("profile-agent-secret").value.trim(),
    lookupHostname: document.getElementById("profile-lookup-hostname").value.trim() || "",
    databasePort: dbPortRaw ? Number(dbPortRaw) : null,
    applicationPort: appPortRaw ? Number(appPortRaw) : null,
    gatewayHost: document.getElementById("profile-gateway-host").value.trim(),
    externalHost: document.getElementById("profile-external-host").value.trim() || "",
    dnsServerHost: document.getElementById("profile-dns-server-host").value.trim() || ""
  };
}

function buildProfileDrafts(profile, context) {
  return profile.targetTemplates
    .filter((template) => !template.enabledWhenContext || Boolean(context[template.enabledWhenContext]))
    .map((template) => {
      const metadata = { ...(template.metadata || {}) };
    if (metadata.lookupHostnameSource) {
      metadata.lookupHostname = context[metadata.lookupHostnameSource] || "";
      delete metadata.lookupHostnameSource;
    }

    return {
      name: `${context.assetName || profile.name} - ${template.nameSuffix}`,
      type: template.type,
      host: template.hostSource ? context[template.hostSource] || template.defaultHost || "" : template.defaultHost || "",
      url: template.urlSource ? context[template.urlSource] || "" : "",
      port: template.port ?? (template.portSource ? context[template.portSource] || template.defaultPort || "" : template.defaultPort || ""),
      timeout: template.timeout,
      intervalSeconds: template.intervalSeconds,
      enabled: true,
      secret: template.secretSource ? context[template.secretSource] || "" : "",
      metadata,
        thresholds: {
          ...template.thresholds
        }
      };
    });
}

function renderProfileDrafts() {
  const container = document.getElementById("profile-drafts");
  const empty = document.getElementById("profile-drafts-empty");
  empty.classList.toggle("is-hidden", state.profileDrafts.length > 0);
  container.innerHTML = state.profileDrafts.map((draft, index) => `
    <article class="profile-draft-card" data-profile-draft-index="${index}">
      <div class="profile-draft-header">
        <div>
          <strong>${escapeHtml(draft.name)}</strong>
          <div class="profile-draft-meta">${escapeHtml(draft.type.toUpperCase())}</div>
        </div>
        <span class="pill status-unknown">Editavel</span>
      </div>
      <div class="form-grid">
        <label><span>Nome</span><input data-field="name" value="${escapeHtml(draft.name)}"></label>
        <label><span>Tipo</span><input value="${escapeHtml(draft.type)}" disabled></label>
        <label class="${draft.type === "http" || draft.type === "agent" ? "" : "is-hidden"}"><span>URL</span><input data-field="url" value="${escapeHtml(draft.url || "")}"></label>
        <label class="${draft.type === "http" || draft.type === "agent" ? "is-hidden" : ""}"><span>Host</span><input data-field="host" value="${escapeHtml(draft.host || "")}"></label>
        <label class="${draft.type === "tcp" ? "" : "is-hidden"}"><span>Porta</span><input data-field="port" type="number" min="1" max="65535" value="${escapeHtml(String(draft.port || ""))}"></label>
        <label><span>Timeout (ms)</span><input data-field="timeout" type="number" min="500" value="${escapeHtml(String(draft.timeout))}"></label>
        <label><span>Intervalo (s)</span><input data-field="intervalSeconds" type="number" min="5" value="${escapeHtml(String(draft.intervalSeconds))}"></label>
        <label><span>Ativo</span><select data-field="enabled"><option value="true" ${draft.enabled ? "selected" : ""}>Sim</option><option value="false" ${draft.enabled ? "" : "selected"}>Nao</option></select></label>
        <label class="${draft.type === "agent" ? "" : "is-hidden"}"><span>Secret</span><input data-field="secret" value="${escapeHtml(draft.secret || "")}"></label>
        <label class="${draft.type === "dns" ? "" : "is-hidden"}"><span>Lookup DNS</span><input data-field="lookupHostname" value="${escapeHtml(draft.metadata?.lookupHostname || "")}" placeholder="Informe um hostname real resolvivel"></label>
      </div>
      <div class="form-grid">
        <label><span>Latencia warning</span><input data-threshold="warningLatencyMs" type="number" value="${escapeHtml(String(draft.thresholds.warningLatencyMs))}"></label>
        <label><span>Latencia critical</span><input data-threshold="criticalLatencyMs" type="number" value="${escapeHtml(String(draft.thresholds.criticalLatencyMs))}"></label>
        <label><span>Packet loss warning</span><input data-threshold="warningPacketLoss" type="number" value="${escapeHtml(String(draft.thresholds.warningPacketLoss))}"></label>
        <label><span>Packet loss critical</span><input data-threshold="criticalPacketLoss" type="number" value="${escapeHtml(String(draft.thresholds.criticalPacketLoss))}"></label>
        <label><span>CPU warning</span><input data-threshold="cpuUsageWarning" type="number" value="${escapeHtml(String(draft.thresholds.cpuUsageWarning))}"></label>
        <label><span>CPU critical</span><input data-threshold="cpuUsageCritical" type="number" value="${escapeHtml(String(draft.thresholds.cpuUsageCritical))}"></label>
        <label><span>RAM warning</span><input data-threshold="memoryUsageWarning" type="number" value="${escapeHtml(String(draft.thresholds.memoryUsageWarning))}"></label>
        <label><span>RAM critical</span><input data-threshold="memoryUsageCritical" type="number" value="${escapeHtml(String(draft.thresholds.memoryUsageCritical))}"></label>
        <label><span>Disco warning</span><input data-threshold="diskUsageWarning" type="number" value="${escapeHtml(String(draft.thresholds.diskUsageWarning))}"></label>
        <label><span>Disco critical</span><input data-threshold="diskUsageCritical" type="number" value="${escapeHtml(String(draft.thresholds.diskUsageCritical))}"></label>
        <label><span>Jitter warning</span><input data-threshold="jitterWarningMs" type="number" value="${escapeHtml(String(draft.thresholds.jitterWarningMs))}"></label>
        <label><span>Jitter critical</span><input data-threshold="jitterCriticalMs" type="number" value="${escapeHtml(String(draft.thresholds.jitterCriticalMs))}"></label>
      </div>
    </article>
  `).join("");
}

function collectProfileDraftsFromDom() {
  return [...document.querySelectorAll("[data-profile-draft-index]")].map((card) => ({
    name: card.querySelector("[data-field='name']").value.trim(),
    type: state.profileDrafts[Number(card.dataset.profileDraftIndex)].type,
    host: card.querySelector("[data-field='host']")?.value.trim() || undefined,
    url: card.querySelector("[data-field='url']")?.value.trim() || undefined,
    port: card.querySelector("[data-field='port']")?.value ? Number(card.querySelector("[data-field='port']").value) : undefined,
    timeout: Number(card.querySelector("[data-field='timeout']").value),
    intervalSeconds: Number(card.querySelector("[data-field='intervalSeconds']").value),
    enabled: card.querySelector("[data-field='enabled']").value === "true",
    secret: card.querySelector("[data-field='secret']")?.value.trim() || undefined,
    metadata: {
      ...(state.profileDrafts[Number(card.dataset.profileDraftIndex)].metadata || {}),
      ...(card.querySelector("[data-field='lookupHostname']") ? { lookupHostname: card.querySelector("[data-field='lookupHostname']").value.trim() || "" } : {})
    },
    thresholds: Object.fromEntries([...card.querySelectorAll("[data-threshold]")].map((input) => [input.dataset.threshold, Number(input.value)]))
  }));
}

async function applyMonitoringProfile() {
  try {
    await loadMonitoringProfiles();
    const profile = getSelectedMonitoringProfile();
    if (!profile) {
      throw new Error("Selecione um perfil de monitoramento.");
    }
    const context = buildProfileContext();
    if (!context.assetName) {
      throw new Error("Informe o nome base do ativo para aplicar o perfil.");
    }
    state.profileDrafts = buildProfileDrafts(profile, context);
    renderProfileDrafts();
    showError("target-form-error", "");
  } catch (error) {
    showError("target-form-error", error.message);
  }
}

function updateTargetFormVisibility() {
  const type = document.getElementById("target-type").value;
  document.getElementById("host-field").classList.toggle("is-hidden", type === "http" || type === "agent");
  document.getElementById("url-field").classList.toggle("is-hidden", !(type === "http" || type === "agent"));
  document.getElementById("port-field").classList.toggle("is-hidden", type !== "tcp");
  document.getElementById("secret-field").classList.toggle("is-hidden", type !== "agent");
  document.getElementById("lookup-field").classList.toggle("is-hidden", type !== "dns");
}

async function openTargetDialog(targetId = null) {
  state.editingTargetId = targetId;
  state.profileDrafts = [];
  const form = document.getElementById("target-form");
  form.reset();
  renderMonitoringProfileOptions();
  renderProfileDrafts();
  document.getElementById("target-creation-mode").value = "manual";
  updateTargetFormVisibility();
  updateTargetCreationModeVisibility();
  showError("target-form-error", "");
  document.getElementById("target-dialog-title").textContent = targetId ? "Editar target" : "Novo target";

  if (targetId) {
    const target = state.snapshot.targets[targetId].target;
    form.elements.id.value = target.id;
    form.elements.name.value = target.name;
    form.elements.type.value = target.type;
    form.elements.host.value = target.host || "";
    form.elements.url.value = target.url || "";
    form.elements.port.value = target.port || "";
    form.elements.timeout.value = target.timeout;
    form.elements.intervalSeconds.value = target.intervalSeconds;
    form.elements.enabled.value = String(target.enabled);
    form.elements.lookupHostname.value = target.metadata?.lookupHostname || "";
    form.elements.warningLatencyMs.value = target.thresholds.warningLatencyMs;
    form.elements.criticalLatencyMs.value = target.thresholds.criticalLatencyMs;
    form.elements.warningPacketLoss.value = target.thresholds.warningPacketLoss;
    form.elements.criticalPacketLoss.value = target.thresholds.criticalPacketLoss;
    form.elements.secret.value = "";
    updateTargetFormVisibility();
    updateTargetCreationModeVisibility();
  }

  document.getElementById("target-dialog").showModal();
}

async function submitTarget(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const creationMode = form.elements.creationMode?.value || "manual";
  const formData = new FormData(form);
  const type = formData.get("type");

  try {
    if (!state.editingTargetId && creationMode === "profile") {
      const drafts = collectProfileDraftsFromDom();
      if (!drafts.length) {
        throw new Error("Aplique um perfil antes de salvar.");
      }
      for (const draft of drafts) {
        await requestJson("/api/targets", {
          method: "POST",
          body: JSON.stringify(draft)
        });
      }
      showFeedback("targets-feedback", `Perfil aplicado com ${drafts.length} targets criados.`);
    } else {
      const payload = {
        name: formData.get("name"),
        type,
        host: formData.get("host") || undefined,
        url: formData.get("url") || undefined,
        port: formData.get("port") ? Number(formData.get("port")) : undefined,
        timeout: Number(formData.get("timeout")),
        intervalSeconds: Number(formData.get("intervalSeconds")),
        enabled: formData.get("enabled") === "true",
        secret: formData.get("secret") || undefined,
        metadata: type === "dns" ? { lookupHostname: formData.get("lookupHostname") || "" } : {},
        thresholds: {
          warningLatencyMs: Number(formData.get("warningLatencyMs")),
          criticalLatencyMs: Number(formData.get("criticalLatencyMs")),
          warningPacketLoss: Number(formData.get("warningPacketLoss")),
          criticalPacketLoss: Number(formData.get("criticalPacketLoss"))
        }
      };

      if (state.editingTargetId) {
        await requestJson(`/api/targets/${state.editingTargetId}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        showFeedback("targets-feedback", "Target atualizado com sucesso.");
      } else {
        await requestJson("/api/targets", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        showFeedback("targets-feedback", "Target criado com sucesso.");
      }
    }
    document.getElementById("target-dialog").close();
    await bootstrap();
  } catch (error) {
    if (error.message !== "unauthorized") {
      showError("target-form-error", error.payload?.message || error.message);
    }
  }
}

async function toggleTarget(targetId) {
  const target = state.snapshot.targets[targetId].target;
  const actionLabel = target.enabled ? "desativar" : "ativar";
  if (!window.confirm(`Deseja realmente ${actionLabel} o target ${target.name}?`)) {
    return;
  }
  try {
    await requestJson(`/api/targets/${targetId}`, {
      method: "PUT",
      body: JSON.stringify({
        ...target,
        enabled: !target.enabled
      })
    });
    showFeedback("targets-feedback", `Target ${actionLabel === "ativar" ? "ativado" : "desativado"} com sucesso.`);
    await bootstrap();
  } catch (error) {
    if (error.message !== "unauthorized") {
      showFeedback("targets-feedback", error.payload?.message || error.message, true);
    }
  }
}

async function removeTarget(targetId) {
  const target = state.snapshot.targets[targetId].target;
  if (!window.confirm(`Remover o target ${target.name}? Esta acao e irreversivel.`)) {
    return;
  }
  try {
    await requestJson(`/api/targets/${targetId}`, { method: "DELETE" });
    showFeedback("targets-feedback", "Target removido com sucesso.");
    if (state.selectedTargetId === targetId) {
      state.selectedTargetId = null;
    }
    await bootstrap();
  } catch (error) {
    if (error.message !== "unauthorized") {
      showFeedback("targets-feedback", error.payload?.message || error.message, true);
    }
  }
}

function openUserDialog(username = null) {
  state.editingUsername = username;
  const form = document.getElementById("user-form");
  form.reset();
  showError("user-form-error", "");
  document.getElementById("user-dialog-title").textContent = username ? "Editar usuario" : "Novo usuario";
  document.getElementById("user-password-field").classList.toggle("is-hidden", Boolean(username));

  if (username) {
    const user = state.users.find((item) => item.username === username);
    form.elements.originalUsername.value = user.username;
    form.elements.username.value = user.username;
    form.elements.username.disabled = true;
    form.elements.role.value = user.role;
    form.elements.enabled.value = String(user.enabled);
  } else {
    form.elements.originalUsername.value = "";
    form.elements.username.disabled = false;
  }

  document.getElementById("user-dialog").showModal();
}

async function submitUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = {
    username: formData.get("username"),
    role: formData.get("role"),
    enabled: formData.get("enabled") === "true"
  };
  if (!state.editingUsername) {
    payload.password = formData.get("password");
  }

  try {
    if (state.editingUsername) {
      await requestJson(`/api/admin/users/${state.editingUsername}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      showFeedback("users-feedback", "Usuario atualizado com sucesso.");
    } else {
      await requestJson("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      showFeedback("users-feedback", "Usuario criado com sucesso.");
    }
    document.getElementById("user-dialog").close();
    await loadUsers();
    await loadAudit();
  } catch (error) {
    if (error.message !== "unauthorized") {
      showError("user-form-error", error.payload?.message || error.message);
    }
  }
}

function openPasswordResetDialog(username) {
  const form = document.getElementById("password-reset-form");
  form.reset();
  form.elements.username.value = username;
  showError("password-reset-error", "");
  document.getElementById("password-reset-dialog").showModal();
}

async function submitPasswordReset(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const username = formData.get("username");
  const newPassword = formData.get("newPassword");
  try {
    await requestJson(`/api/admin/users/${username}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword })
    });
    document.getElementById("password-reset-dialog").close();
    showFeedback("users-feedback", "Senha redefinida com sucesso.");
    await loadAudit();
  } catch (error) {
    if (error.message !== "unauthorized") {
      showError("password-reset-error", error.payload?.message || error.message);
    }
  }
}

async function submitChangePassword(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    await requestJson("/api/account/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: formData.get("currentPassword"),
        newPassword: formData.get("newPassword")
      })
    });
    event.currentTarget.reset();
    showFeedback("profile-feedback", "Senha alterada com sucesso.");
    if (isAdmin()) {
      await loadAudit();
    }
  } catch (error) {
    if (error.message !== "unauthorized") {
      showFeedback("profile-feedback", error.payload?.message || error.message, true);
    }
  }
}

async function login(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password")
      })
    });
    event.currentTarget.reset();
    showError("login-error", "");
    await loadSession();
  } catch (error) {
    if (error.message !== "unauthorized") {
      showError("login-error", error.payload?.message || error.message);
    }
  }
}

async function logout() {
  try {
    await requestJson("/api/auth/logout", { method: "POST" });
  } catch (_) {
    // noop
  }
  handleUnauthorized();
}

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", async () => {
    const view = button.dataset.view;
    switchView(view);
    if (view === "users" && isAdmin()) {
      await loadUsers();
    }
    if (view === "audit" && isAdmin()) {
      await loadAudit();
    }
  });
});

document.getElementById("open-target-create").addEventListener("click", () => {
  openTargetDialog().catch((error) => {
    showFeedback("targets-feedback", error.payload?.message || error.message, true);
  });
});
document.getElementById("diagnostic-target-selector").addEventListener("change", (event) => {
  state.selectedTargetId = event.currentTarget.value || null;
  render();
  loadDiagnostics(state.selectedTargetId).catch((error) => {
    if (error.message !== "unauthorized") {
      showFeedback("diagnostic-feedback", error.payload?.message || error.message, true);
    }
  });
});
document.getElementById("refresh-diagnostic").addEventListener("click", () => {
  loadDiagnostics(state.selectedTargetId, true).catch((error) => {
    if (error.message !== "unauthorized") {
      showFeedback("diagnostic-feedback", error.payload?.message || error.message, true);
    }
  });
});
document.getElementById("open-recommended-profile").addEventListener("click", () => {
  openRecommendedProfileFromDiagnosis().catch((error) => {
    showFeedback("diagnostic-feedback", error.payload?.message || error.message, true);
  });
});
document.getElementById("refresh-onboarding").addEventListener("click", () => {
  loadOnboardingEligible().catch((error) => {
    if (error.message !== "unauthorized") {
      showFeedback("onboarding-feedback", error.payload?.message || error.message, true);
    }
  });
});
document.getElementById("run-onboarding-analysis").addEventListener("click", () => {
  loadOnboardingPlan(state.selectedOnboardingTargetId, true).catch((error) => {
    if (error.message !== "unauthorized") {
      showFeedback("onboarding-feedback", error.payload?.message || error.message, true);
    }
  });
});
document.getElementById("apply-onboarding").addEventListener("click", () => {
  applyOnboardingRecommendation().catch((error) => {
    showFeedback("onboarding-feedback", error.payload?.message || error.message, true);
  });
});
document.getElementById("open-user-create").addEventListener("click", () => openUserDialog());
document.getElementById("cancel-target").addEventListener("click", () => document.getElementById("target-dialog").close());
document.getElementById("cancel-user").addEventListener("click", () => document.getElementById("user-dialog").close());
document.getElementById("cancel-password-reset").addEventListener("click", () => document.getElementById("password-reset-dialog").close());
document.getElementById("target-type").addEventListener("change", updateTargetFormVisibility);
document.getElementById("target-creation-mode").addEventListener("change", updateTargetCreationModeVisibility);
document.getElementById("profile-category").addEventListener("change", renderMonitoringProfileOptions);
document.getElementById("profile-selector").addEventListener("change", renderMonitoringProfileDescription);
document.getElementById("apply-monitoring-profile").addEventListener("click", applyMonitoringProfile);
document.getElementById("target-form").addEventListener("submit", submitTarget);
document.getElementById("user-form").addEventListener("submit", submitUser);
document.getElementById("password-reset-form").addEventListener("submit", submitPasswordReset);
document.getElementById("change-password-form").addEventListener("submit", submitChangePassword);
document.getElementById("login-form").addEventListener("submit", login);
document.getElementById("logout-button").addEventListener("click", logout);
document.getElementById("refresh-audit").addEventListener("click", loadAudit);
document.getElementById("audit-filter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadAudit().catch((error) => {
    if (error.message !== "unauthorized") {
      showFeedback("audit-feedback", error.payload?.message || error.message, true);
    }
  });
});

updateTargetFormVisibility();
updateTargetCreationModeVisibility();
switchView("dashboard");
loadSession();

const http = require("http");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const si = require("systeminformation");

const execFileAsync = promisify(execFile);
const KNOWN_SERVICE_PATTERNS = /dns|named|bind|samba|smb|nfs|apache|httpd|nginx|iis|w3svc|tomcat|jboss|weblogic|wildfly|postgres|postgresql|mysql|mariadb|sql|mssql|oracle|mongod|redis|squid|proxy|cups|spool|print|veeam|bacula|urbackup|vmware|vmtools|qemu|libvirt|hyper-v|vmms|router|firewall/i;
const KNOWN_PROCESS_PATTERNS = /named|dnsmasq|coredns|unbound|smbd|nmbd|ksmbd|apache2|httpd|nginx|w3wp|iis|tomcat|java|jboss|weblogic|wildfly|sqlservr|postgres|postmaster|mysqld|mariadbd|oracle|tnslsnr|mongod|redis-server|squid|spoolsv|cupsd|veeam|bacula|urbackup|qemu|libvirtd|vmware|vmtoolsd|vmacthlp|vmms|vmcompute/i;
const RELEVANT_LINUX_PACKAGES = [
  "bind9",
  "dnsmasq",
  "samba",
  "nfs-kernel-server",
  "nginx",
  "apache2",
  "httpd",
  "postgresql",
  "postgresql-server",
  "mysql-server",
  "mariadb-server",
  "mongodb-org",
  "redis",
  "squid",
  "cups",
  "qemu-guest-agent",
  "open-vm-tools",
  "hyperv-daemons",
  "bacula",
  "urbackup-server"
];
const WINDOWS_FEATURE_SCRIPT = [
  "if (Get-Command Get-WindowsFeature -ErrorAction SilentlyContinue) {",
  "  Get-WindowsFeature | Where-Object {$_.InstallState -eq 'Installed'} | Select-Object Name, DisplayName | ConvertTo-Json -Depth 3",
  "}"
].join(" ");
const WINDOWS_SHARE_SCRIPT = [
  "if (Get-Command Get-SmbShare -ErrorAction SilentlyContinue) {",
  "  Get-SmbShare | Where-Object {$_.Special -eq $false} | Select-Object Name, Path, Description, ScopeName, AvailabilityType, Temporary | ConvertTo-Json -Depth 4",
  "}"
].join(" ");

function parsePort(value = null) {
  return Number(value ?? process.env.PORT ?? process.argv[2] ?? 9090);
}

function parseSecret(value = null) {
  return value ?? process.env.SECRET ?? process.argv[3] ?? "";
}

function createConsoleLogger() {
  return {
    info(message, details = null) {
      if (details) {
        console.log(message, details);
        return;
      }
      console.log(message);
    },
    warn(message, details = null) {
      if (details) {
        console.warn(message, details);
        return;
      }
      console.warn(message);
    },
    error(message, details = null) {
      if (details) {
        console.error(message, details);
        return;
      }
      console.error(message);
    }
  };
}

function authMatches(request, secret) {
  if (!secret) {
    return true;
  }
  const authHeader = request.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  return bearer === secret;
}

function safeCall(factory, fallback, timeoutMs = 5000) {
  return Promise.race([
    Promise.resolve().then(factory),
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]).catch(() => fallback);
}

async function safeExecFile(command, args, { timeoutMs = 4000, fallback = null, parser = (stdout) => stdout } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    });
    return parser(stdout);
  } catch (_) {
    return fallback;
  }
}

function normalizeServiceEntry(service) {
  return {
    name: service.name || service.displayName || "unknown",
    displayName: service.displayName || service.name || "unknown",
    state: service.running ? "running" : service.started ? "started" : service.pstate || "unknown",
    startMode: service.startmode || null,
    pid: service.pid || null
  };
}

function buildListeningPorts(connections) {
  const seen = new Set();
  return connections
    .filter((connection) => ["LISTEN", "LISTENING"].includes(String(connection.state || "").toUpperCase()))
    .map((connection) => ({
      protocol: (connection.protocol || "tcp").toLowerCase(),
      localAddress: connection.localaddress || connection.localAddress || null,
      port: Number(connection.localport || connection.localPort || 0) || null,
      process: connection.process || connection.name || null,
      pid: connection.pid || null,
      state: connection.state || null
    }))
    .filter((entry) => entry.port)
    .filter((entry) => {
      const key = `${entry.protocol}:${entry.localAddress || "*"}:${entry.port}:${entry.process || ""}:${entry.pid || ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.port - right.port);
}

function buildRelevantConnections(connections) {
  return connections
    .filter((connection) => ["ESTABLISHED", "SYN_SENT", "SYN_RECV"].includes(String(connection.state || "").toUpperCase()))
    .slice(0, 25)
    .map((connection) => ({
      protocol: (connection.protocol || "tcp").toLowerCase(),
      localAddress: connection.localaddress || connection.localAddress || null,
      localPort: Number(connection.localport || connection.localPort || 0) || null,
      peerAddress: connection.peeraddress || connection.peerAddress || null,
      peerPort: Number(connection.peerport || connection.peerPort || 0) || null,
      process: connection.process || connection.name || null,
      pid: connection.pid || null,
      state: connection.state || null
    }));
}

function buildRelevantServices(services) {
  const running = services
    .filter((service) => service.running || service.started || KNOWN_SERVICE_PATTERNS.test(`${service.name || ""} ${service.displayName || ""}`))
    .map(normalizeServiceEntry);

  running.sort((left, right) => left.name.localeCompare(right.name));
  return running.slice(0, 80);
}

function buildRelevantProcesses(processInfo) {
  const processes = processInfo.list || [];
  const byPattern = processes
    .filter((processEntry) => KNOWN_PROCESS_PATTERNS.test(`${processEntry.name || ""} ${processEntry.path || ""} ${processEntry.command || ""}`))
    .sort((left, right) => (right.cpu || 0) - (left.cpu || 0))
    .slice(0, 50)
    .map((item) => ({
      pid: item.pid,
      name: item.name,
      path: item.path || null,
      command: item.command || null,
      cpu: Number((item.cpu || 0).toFixed(2)),
      memory: item.memRss || null,
      memoryPercent: Number((item.mem || 0).toFixed(2)),
      user: item.user || null
    }));

  const topProcesses = processes
    .sort((left, right) => (right.cpu || 0) - (left.cpu || 0))
    .slice(0, 5)
    .map((item) => ({
      pid: item.pid,
      name: item.name,
      path: item.path || null,
      cpu: Number((item.cpu || 0).toFixed(2)),
      memory: item.memRss || null,
      memoryPercent: Number((item.mem || 0).toFixed(2)),
      user: item.user || null
    }));

  return {
    topProcesses,
    relevantProcesses: byPattern
  };
}

function parseJsonArray(stdout) {
  if (!stdout || !stdout.trim()) {
    return null;
  }
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return parsed ? [parsed] : null;
}

async function collectWindowsShares() {
  return safeExecFile("powershell", ["-NoProfile", "-Command", WINDOWS_SHARE_SCRIPT], {
    timeoutMs: 5000,
    fallback: null,
    parser: (stdout) => {
      const items = parseJsonArray(stdout) || [];
      return items.map((item) => ({
        name: item.Name,
        path: item.Path || null,
        description: item.Description || null,
        scopeName: item.ScopeName || null,
        availabilityType: item.AvailabilityType || null,
        temporary: Boolean(item.Temporary)
      }));
    }
  });
}

async function collectWindowsFeatures() {
  return safeExecFile("powershell", ["-NoProfile", "-Command", WINDOWS_FEATURE_SCRIPT], {
    timeoutMs: 6000,
    fallback: null,
    parser: (stdout) => {
      const items = parseJsonArray(stdout) || [];
      return items.map((item) => ({
        name: item.Name || item.DisplayName || "unknown",
        displayName: item.DisplayName || item.Name || "unknown"
      }));
    }
  });
}

async function collectLinuxExports() {
  return safeExecFile("sh", ["-lc", "if command -v exportfs >/dev/null 2>&1; then exportfs -v; fi"], {
    timeoutMs: 3000,
    fallback: null,
    parser: (stdout) => {
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) {
        return null;
      }
      return lines.map((line) => ({ type: "nfs", raw: line }));
    }
  });
}

async function collectLinuxRelevantPackages() {
  const packageProbe = RELEVANT_LINUX_PACKAGES.join(" ");
  const dpkgScript = `if command -v dpkg-query >/dev/null 2>&1; then for pkg in ${packageProbe}; do dpkg-query -W -f='\\${Package}\\t\\${Version}\\n' "$pkg" 2>/dev/null; done; fi`;
  const rpmScript = `if command -v rpm >/dev/null 2>&1; then for pkg in ${packageProbe}; do rpm -q --qf '%{NAME}\\t%{VERSION}-%{RELEASE}\\n' "$pkg" 2>/dev/null; done; fi`;

  const parser = (stdout) => {
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      return [];
    }
    return lines.map((line) => {
      const [name, version] = line.split(/\t+/);
      return { name: name || "unknown", version: version || null };
    });
  };

  const dpkgPackages = await safeExecFile("sh", ["-lc", dpkgScript], {
    timeoutMs: 4000,
    fallback: null,
    parser
  });

  if (dpkgPackages) {
    return dpkgPackages;
  }

  return safeExecFile("sh", ["-lc", rpmScript], {
    timeoutMs: 4000,
    fallback: null,
    parser
  });
}

function buildVirtualizationData(systemInfo, versions, relevantProcesses, services, packages) {
  const processNames = new Set((relevantProcesses || []).map((item) => String(item.name || "").toLowerCase()));
  const serviceNames = new Set((services || []).map((item) => `${item.name || ""} ${item.displayName || ""}`.toLowerCase()));
  const packageNames = new Set((packages || []).map((item) => String(item.name || "").toLowerCase()));
  const guestTools = [];

  if (processNames.has("vmtoolsd") || packageNames.has("open-vm-tools") || versions.vmware || [...serviceNames].some((name) => name.includes("vmware"))) {
    guestTools.push("vmware-tools");
  }
  if (processNames.has("qemu-ga") || packageNames.has("qemu-guest-agent")) {
    guestTools.push("qemu-guest-agent");
  }
  if (packageNames.has("hyperv-daemons") || [...serviceNames].some((name) => name.includes("hyper-v"))) {
    guestTools.push("hyper-v-tools");
  }

  return {
    isVirtual: Boolean(systemInfo.virtual),
    manufacturer: systemInfo.manufacturer || null,
    model: systemInfo.model || null,
    guestTools,
    vmwareVersion: versions.vmware || null
  };
}

async function collectDiscoveryData(osInfo, processInfo) {
  const [services, networkConnections, versions, systemInfo] = await Promise.all([
    safeCall(() => si.services("*"), [], 6000),
    safeCall(() => si.networkConnections(), [], 8000),
    safeCall(() => si.versions(), {}, 4000),
    safeCall(() => si.system(), {}, 4000)
  ]);

  const { topProcesses, relevantProcesses } = buildRelevantProcesses(processInfo);
  const relevantServices = buildRelevantServices(services);
  const listeningPorts = buildListeningPorts(networkConnections);
  const relevantConnections = buildRelevantConnections(networkConnections);

  let shares = null;
  let rolesFeatures = null;
  let packages = null;

  if (process.platform === "win32") {
    [shares, rolesFeatures] = await Promise.all([
      collectWindowsShares(),
      collectWindowsFeatures()
    ]);
  } else {
    [shares, packages] = await Promise.all([
      collectLinuxExports(),
      collectLinuxRelevantPackages()
    ]);
  }

  const virtualization = buildVirtualizationData(systemInfo, versions, relevantProcesses, relevantServices, packages);

  return {
    topProcesses,
    relevantProcesses,
    services: relevantServices,
    listeningPorts,
    shares,
    rolesFeatures,
    packages,
    connections: relevantConnections,
    virtualization,
    versions
  };
}

async function collectMetrics(options = {}) {
  const [osInfo, timeInfo, currentLoad, mem, fsSizes, networkStats, networkInterfaces, processInfo] = await Promise.all([
    safeCall(() => si.osInfo(), {}),
    safeCall(() => si.time(), { uptime: 0 }),
    safeCall(() => si.currentLoad(), { currentLoad: 0, cpus: [] }, 8000),
    safeCall(() => si.mem(), { total: 0, used: 0, active: 0 }),
    safeCall(() => si.fsSize(), [], 8000),
    safeCall(() => si.networkStats(), [], 8000),
    safeCall(() => si.networkInterfaces(), [], 8000),
    safeCall(() => si.processes(), { list: [] }, 5000)
  ]);

  const discovery = await collectDiscoveryData(osInfo, processInfo);
  const statsByInterface = new Map(networkStats.map((item) => [item.iface, item]));
  const interfaces = networkInterfaces
    .filter((iface) => !iface.internal)
    .map((iface) => {
      const counters = statsByInterface.get(iface.iface) || {};
      return {
        interface: iface.iface,
        rx_bytes: counters.rx_bytes || 0,
        tx_bytes: counters.tx_bytes || 0,
        rx_rate: counters.rx_sec || 0,
        tx_rate: counters.tx_sec || 0,
        operstate: iface.operstate || counters.operstate || "unknown",
        mac: iface.mac || null,
        ip4: iface.ip4 || null,
        ip6: iface.ip6 || null,
        speed: iface.speed || null,
        type: iface.type || null
      };
    });

  return {
    hostname: options.hostAlias || osInfo.hostname || os.hostname(),
    actualHostname: osInfo.hostname || os.hostname(),
    fqdn: osInfo.fqdn || null,
    platform: osInfo.platform || process.platform,
    os: `${osInfo.distro} ${osInfo.release}`.trim() || osInfo.platform || process.platform,
    osVersion: osInfo.build || osInfo.codename || null,
    kernel: osInfo.kernel || null,
    arch: osInfo.arch || process.arch,
    uptime: timeInfo.uptime,
    cpu: {
      usage: Number((currentLoad.currentLoad || 0).toFixed(2)),
      cores: currentLoad.cpus?.length || osInfo.cores || 0
    },
    memory: {
      total: mem.total,
      used: mem.active || mem.used,
      usedPercent: mem.total ? Number((((mem.active || mem.used) / mem.total) * 100).toFixed(2)) : 0
    },
    disks: fsSizes.map((disk) => ({
      mount: disk.mount,
      fs: disk.fs || null,
      total: disk.size,
      used: disk.used,
      usedPercent: Number((disk.use || 0).toFixed(2))
    })),
    network: interfaces,
    topProcesses: discovery.topProcesses,
    relevantProcesses: discovery.relevantProcesses,
    services: discovery.services,
    listeningPorts: discovery.listeningPorts,
    shares: discovery.shares,
    rolesFeatures: discovery.rolesFeatures,
    packages: discovery.packages,
    virtualization: discovery.virtualization,
    connections: discovery.connections,
    collection: {
      shares: discovery.shares == null ? "unavailable" : "ok",
      rolesFeatures: discovery.rolesFeatures == null ? "unavailable" : "ok",
      packages: discovery.packages == null ? "unavailable" : "ok"
    },
    timestamp: new Date().toISOString()
  };
}

function startAgentServer(options = {}) {
  const port = parsePort(options.port);
  const secret = parseSecret(options.secret);
  const bindHost = options.bindHost || "0.0.0.0";
  const hostAlias = options.hostAlias || null;
  const logger = options.logger || createConsoleLogger();

  const server = http.createServer(async (request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (!authMatches(request, secret)) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const requestUrl = new URL(request.url, `http://localhost:${port}`);

    if (requestUrl.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        hostname: os.hostname(),
        timestamp: new Date().toISOString()
      }));
      return;
    }

    if (requestUrl.pathname !== "/metrics" && requestUrl.pathname !== "/") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    try {
      const metrics = await Promise.race([
        collectMetrics({ hostAlias }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Tempo limite excedido na coleta do agente")), 15000);
        })
      ]);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(metrics));
    } catch (error) {
      logger.error("Falha ao coletar metricas do agente", { message: error.message });
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: "Falha ao coletar metricas",
        details: error.message
      }));
    }
  });

  server.headersTimeout = 10000;
  server.requestTimeout = 10000;

  server.on("error", (error) => {
    logger.error("Falha ao iniciar o agente", {
      code: error.code || "unknown",
      message: error.message,
      port,
      bindHost
    });
  });

  server.listen(port, bindHost, () => {
    logger.info("InfraWatch Agent inicializado", {
      bindHost,
      port,
      endpoint: `http://${bindHost === "0.0.0.0" ? "localhost" : bindHost}:${port}/metrics`,
      authEnabled: Boolean(secret),
      hostAlias: hostAlias || null
    });
  });

  return server;
}

module.exports = {
  startAgentServer
};

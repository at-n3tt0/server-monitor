const crypto = require("crypto");
const {
  normalizeHost,
  normalizeNumber,
  normalizeSecret,
  normalizeString,
  normalizeUrl
} = require("./validation-utils");
const { AppError } = require("../errors/app-error");

const SUPPORTED_TARGET_TYPES = ["ping", "http", "tcp", "dns", "gateway", "agent", "snmp"];

function createDefaultThresholds(type) {
  return {
    warningLatencyMs: type === "http" ? 1500 : 200,
    criticalLatencyMs: type === "http" ? 3000 : 500,
    warningPacketLoss: 15,
    criticalPacketLoss: 50,
    cpuUsageWarning: 80,
    cpuUsageCritical: 90,
    memoryUsageWarning: 80,
    memoryUsageCritical: 90,
    diskUsageWarning: 80,
    diskUsageCritical: 90,
    jitterWarningMs: 30,
    jitterCriticalMs: 60,
    oscillationWindowMinutes: 15,
    oscillationChangesWarning: 3,
    oscillationChangesCritical: 6
  };
}

function normalizeThresholds(type, thresholds = {}) {
  const base = { ...createDefaultThresholds(type), ...thresholds };
  return {
    warningLatencyMs: normalizeNumber(base.warningLatencyMs, "warningLatencyMs", { required: true, min: 1, max: 600000 }),
    criticalLatencyMs: normalizeNumber(base.criticalLatencyMs, "criticalLatencyMs", { required: true, min: 1, max: 600000 }),
    warningPacketLoss: normalizeNumber(base.warningPacketLoss, "warningPacketLoss", { required: true, min: 0, max: 100 }),
    criticalPacketLoss: normalizeNumber(base.criticalPacketLoss, "criticalPacketLoss", { required: true, min: 0, max: 100 }),
    cpuUsageWarning: normalizeNumber(base.cpuUsageWarning, "cpuUsageWarning", { required: true, min: 0, max: 100 }),
    cpuUsageCritical: normalizeNumber(base.cpuUsageCritical, "cpuUsageCritical", { required: true, min: 0, max: 100 }),
    memoryUsageWarning: normalizeNumber(base.memoryUsageWarning, "memoryUsageWarning", { required: true, min: 0, max: 100 }),
    memoryUsageCritical: normalizeNumber(base.memoryUsageCritical, "memoryUsageCritical", { required: true, min: 0, max: 100 }),
    diskUsageWarning: normalizeNumber(base.diskUsageWarning, "diskUsageWarning", { required: true, min: 0, max: 100 }),
    diskUsageCritical: normalizeNumber(base.diskUsageCritical, "diskUsageCritical", { required: true, min: 0, max: 100 }),
    jitterWarningMs: normalizeNumber(base.jitterWarningMs, "jitterWarningMs", { required: true, min: 0, max: 600000 }),
    jitterCriticalMs: normalizeNumber(base.jitterCriticalMs, "jitterCriticalMs", { required: true, min: 0, max: 600000 }),
    oscillationWindowMinutes: normalizeNumber(base.oscillationWindowMinutes, "oscillationWindowMinutes", { required: true, min: 1, max: 10080 }),
    oscillationChangesWarning: normalizeNumber(base.oscillationChangesWarning, "oscillationChangesWarning", { required: true, min: 1, max: 10000, integer: true }),
    oscillationChangesCritical: normalizeNumber(base.oscillationChangesCritical, "oscillationChangesCritical", { required: true, min: 1, max: 10000, integer: true })
  };
}

function normalizeTarget(input = {}) {
  const type = String(input.type || "").trim().toLowerCase();
  if (!SUPPORTED_TARGET_TYPES.includes(type)) {
    throw new AppError(400, "validation_error", `Tipo de target invalido: ${input.type}`);
  }

  const target = {
    id: String(input.id || crypto.randomUUID()),
    name: normalizeString(input.name, "name", { required: true, maxLength: 200 }),
    type,
    host: normalizeHost(input.host, "host"),
    url: normalizeUrl(input.url, "url"),
    port: normalizeNumber(input.port, "port", { min: 1, max: 65535, integer: true }),
    timeout: normalizeNumber(input.timeout || 5000, "timeout", { required: true, min: 500, max: 600000, integer: true }),
    intervalSeconds: normalizeNumber(input.intervalSeconds || input.interval || 30, "intervalSeconds", { required: true, min: 5, max: 86400, integer: true }),
    secret: normalizeSecret(input.secret, "secret"),
    enabled: input.enabled !== false,
    thresholds: normalizeThresholds(type, input.thresholds),
    metadata: {
      lookupHostname: normalizeHost(input.metadata?.lookupHostname || input.lookupHostname || null, "lookupHostname"),
      dnsServers: (input.metadata?.dnsServers || input.dnsServers || []).map((item) => normalizeHost(item, "dnsServer", { required: true })),
      interfaceName: normalizeString(input.metadata?.interfaceName || input.interfaceName, "interfaceName", { maxLength: 128 }),
      notes: normalizeString(input.metadata?.notes || input.notes, "notes", { maxLength: 1000 }),
      snmp: input.metadata?.snmp || {}
    }
  };
  if (["ping", "tcp", "gateway", "dns"].includes(type) && !target.host) {
    throw new AppError(400, "validation_error", `Target ${target.id} exige host`);
  }
  if (type === "http" && !target.url) {
    throw new AppError(400, "validation_error", `Target ${target.id} exige url`);
  }
  if (type === "tcp" && (!Number.isInteger(target.port) || target.port <= 0 || target.port > 65535)) {
    throw new AppError(400, "validation_error", `Target ${target.id} exige porta valida`);
  }
  if (type === "agent" && !target.url) {
    throw new AppError(400, "validation_error", `Target ${target.id} exige url do agente`);
  }
  if (type === "dns" && !target.metadata.lookupHostname) {
    throw new AppError(400, "validation_error", `Target ${target.id} exige lookupHostname`);
  }

  if (type === "snmp") {
    target.metadata.snmp = {
      version: normalizeString(input.metadata?.snmp?.version || "2c", "snmp.version", { required: true, maxLength: 16 }),
      community: normalizeString(input.metadata?.snmp?.community, "snmp.community", { maxLength: 128 }),
      oids: Array.isArray(input.metadata?.snmp?.oids) ? input.metadata.snmp.oids.map((oid) => normalizeString(oid, "snmp.oid", { required: true, maxLength: 128 })) : []
    };
  }

  if (target.thresholds.criticalLatencyMs < target.thresholds.warningLatencyMs) {
    throw new AppError(400, "validation_error", "criticalLatencyMs nao pode ser menor que warningLatencyMs");
  }
  if (target.thresholds.criticalPacketLoss < target.thresholds.warningPacketLoss) {
    throw new AppError(400, "validation_error", "criticalPacketLoss nao pode ser menor que warningPacketLoss");
  }
  if (target.thresholds.cpuUsageCritical < target.thresholds.cpuUsageWarning) {
    throw new AppError(400, "validation_error", "cpuUsageCritical nao pode ser menor que cpuUsageWarning");
  }
  if (target.thresholds.memoryUsageCritical < target.thresholds.memoryUsageWarning) {
    throw new AppError(400, "validation_error", "memoryUsageCritical nao pode ser menor que memoryUsageWarning");
  }
  if (target.thresholds.diskUsageCritical < target.thresholds.diskUsageWarning) {
    throw new AppError(400, "validation_error", "diskUsageCritical nao pode ser menor que diskUsageWarning");
  }
  if (target.thresholds.oscillationChangesCritical < target.thresholds.oscillationChangesWarning) {
    throw new AppError(400, "validation_error", "oscillationChangesCritical nao pode ser menor que oscillationChangesWarning");
  }

  return target;
}

function validateMonitorConfig(rawConfig = {}) {
  return {
    backend: {
      port: normalizeNumber(rawConfig.backend?.port || process.env.PORT || 3000, "backend.port", { required: true, min: 1, max: 65535, integer: true }),
      host: normalizeString(rawConfig.backend?.host || process.env.HOST || "0.0.0.0", "backend.host", { required: true })
    },
    monitoring: {
      defaultIntervalSeconds: normalizeNumber(rawConfig.monitoring?.defaultIntervalSeconds || rawConfig.checkInterval || 30, "monitoring.defaultIntervalSeconds", { required: true, min: 5, max: 86400, integer: true }),
      uiHistoryLimit: normalizeNumber(rawConfig.monitoring?.uiHistoryLimit || 120, "monitoring.uiHistoryLimit", { required: true, min: 10, max: 5000, integer: true }),
      pingSamples: normalizeNumber(rawConfig.monitoring?.pingSamples || 4, "monitoring.pingSamples", { required: true, min: 2, max: 20, integer: true })
    },
    auth: {
      sessionTtlHours: normalizeNumber(rawConfig.auth?.sessionTtlHours || 12, "auth.sessionTtlHours", { required: true, min: 1, max: 720, integer: true }),
      sessionCookieName: normalizeString(rawConfig.auth?.sessionCookieName || "infra_monitor_session", "auth.sessionCookieName", { required: true, maxLength: 100 }),
      secureCookies: Boolean(rawConfig.auth?.secureCookies || process.env.NODE_ENV === "production"),
      bootstrapAdmin: {
        username: normalizeString(rawConfig.auth?.bootstrapAdmin?.username || process.env.SERVER_MONITOR_BOOTSTRAP_ADMIN_USERNAME, "auth.bootstrapAdmin.username", { maxLength: 100 }),
        passwordHash: normalizeString(rawConfig.auth?.bootstrapAdmin?.passwordHash || process.env.SERVER_MONITOR_BOOTSTRAP_ADMIN_PASSWORD_HASH, "auth.bootstrapAdmin.passwordHash", { maxLength: 512 }),
        password: normalizeString(rawConfig.auth?.bootstrapAdmin?.password || process.env.SERVER_MONITOR_BOOTSTRAP_ADMIN_PASSWORD, "auth.bootstrapAdmin.password", { maxLength: 256 })
      }
    },
    retention: {
      checkResultsDays: normalizeNumber(rawConfig.retention?.checkResultsDays || 30, "retention.checkResultsDays", { required: true, min: 1, max: 3650, integer: true }),
      agentMetricsDays: normalizeNumber(rawConfig.retention?.agentMetricsDays || 30, "retention.agentMetricsDays", { required: true, min: 1, max: 3650, integer: true }),
      networkMetricsDays: normalizeNumber(rawConfig.retention?.networkMetricsDays || 30, "retention.networkMetricsDays", { required: true, min: 1, max: 3650, integer: true }),
      eventsDays: normalizeNumber(rawConfig.retention?.eventsDays || 180, "retention.eventsDays", { required: true, min: 1, max: 3650, integer: true }),
      alertsDays: normalizeNumber(rawConfig.retention?.alertsDays || 365, "retention.alertsDays", { required: true, min: 1, max: 3650, integer: true })
    },
    maintenance: {
      cleanupIntervalMinutes: normalizeNumber(rawConfig.maintenance?.cleanupIntervalMinutes || 60, "maintenance.cleanupIntervalMinutes", { required: true, min: 5, max: 10080, integer: true }),
      vacuumIntervalHours: normalizeNumber(rawConfig.maintenance?.vacuumIntervalHours || 24, "maintenance.vacuumIntervalHours", { required: true, min: 1, max: 720, integer: true })
    },
    targets: Array.isArray(rawConfig.targets) ? rawConfig.targets.map(normalizeTarget) : []
  };
}

module.exports = {
  SUPPORTED_TARGET_TYPES,
  createDefaultThresholds,
  normalizeTarget,
  validateMonitorConfig
};

const crypto = require("crypto");

function createAlertEngine(repository, websocketHub) {
  const activeAlerts = new Map(repository.listActiveAlerts().map((alert) => [alert.alertKey, alert]));
  const oscillationTracker = new Map();

  function emitEvent(eventType, severity, targetId, message, payload) {
    const createdAt = new Date().toISOString();
    repository.saveEvent({
      targetId,
      eventType,
      severity,
      message,
      payload,
      createdAt
    });
    websocketHub.broadcast("event", { eventType, severity, targetId, message, payload, createdAt });
  }

  function openOrRefreshAlert({ alertKey, targetId, type, severity, message, payload }) {
    const now = new Date().toISOString();
    const current = activeAlerts.get(alertKey);
    const record = {
      id: current?.id || crypto.randomUUID(),
      targetId,
      alertKey,
      type,
      severity,
      message,
      status: "active",
      firstSeenAt: current?.firstSeenAt || now,
      lastSeenAt: now,
      resolvedAt: null,
      payload
    };
    repository.saveAlert(record);
    activeAlerts.set(alertKey, record);
    websocketHub.broadcast("alert", record);
    return record;
  }

  function resolveAlert(alertKey, payload = {}) {
    const current = activeAlerts.get(alertKey);
    if (!current) {
      return null;
    }
    const resolved = {
      ...current,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      payload: {
        ...current.payload,
        ...payload
      }
    };
    repository.saveAlert(resolved);
    activeAlerts.delete(alertKey);
    websocketHub.broadcast("alert_resolved", resolved);
    return resolved;
  }

  function evaluateThreshold(actual, warning, critical) {
    if (actual == null) {
      return null;
    }
    if (actual >= critical) {
      return "critical";
    }
    if (actual >= warning) {
      return "warning";
    }
    return null;
  }

  function registerOscillation(targetId, status, thresholds) {
    const bucket = oscillationTracker.get(targetId) || [];
    const now = Date.now();
    bucket.push({ status, at: now });
    const maxAge = thresholds.oscillationWindowMinutes * 60 * 1000;
    const recent = bucket.filter((item) => now - item.at <= maxAge);
    oscillationTracker.set(targetId, recent);
    return recent.length;
  }

  function getRecentOscillationCount(targetId, thresholds) {
    const bucket = oscillationTracker.get(targetId) || [];
    const now = Date.now();
    const maxAge = thresholds.oscillationWindowMinutes * 60 * 1000;
    const recent = bucket.filter((item) => now - item.at <= maxAge);
    oscillationTracker.set(targetId, recent);
    return recent.length;
  }

  function processCheck(target, previousState, result) {
    const thresholds = target.thresholds;
    const metrics = result.metrics;

    let changesInWindow = getRecentOscillationCount(target.id, thresholds);
    if (previousState && previousState.status !== result.status) {
      changesInWindow = registerOscillation(target.id, result.status, thresholds);
      emitEvent("status_change", result.status === "down" ? "critical" : "info", target.id, `${target.name} mudou para ${result.status}`, {
        previousStatus: previousState.status,
        currentStatus: result.status,
        changesInWindow
      });
    }

    const oscillationSeverity = changesInWindow >= thresholds.oscillationChangesCritical
      ? "critical"
      : changesInWindow >= thresholds.oscillationChangesWarning
        ? "warning"
        : null;
    const oscillationKey = `${target.id}:link_oscillation`;
    if (oscillationSeverity) {
      openOrRefreshAlert({
        alertKey: oscillationKey,
        targetId: target.id,
        type: "link_oscillation",
        severity: oscillationSeverity,
        message: `${target.name} esta oscilando entre estados`,
        payload: { changesInWindow, windowMinutes: thresholds.oscillationWindowMinutes }
      });
    } else {
      resolveAlert(oscillationKey);
    }

    const availabilityKey = `${target.id}:${target.type}_down`;
    if (result.status === "down") {
      openOrRefreshAlert({
        alertKey: availabilityKey,
        targetId: target.id,
        type: target.type === "agent" ? "host_down" : "service_down",
        severity: "critical",
        message: `${target.name} esta indisponivel`,
        payload: { type: target.type, message: result.message }
      });
    } else {
      resolveAlert(availabilityKey);
    }

    const latencySeverity = evaluateThreshold(result.latencyMs, thresholds.warningLatencyMs, thresholds.criticalLatencyMs);
    const latencyKey = `${target.id}:high_latency`;
    if (latencySeverity) {
      openOrRefreshAlert({
        alertKey: latencyKey,
        targetId: target.id,
        type: "high_latency",
        severity: latencySeverity,
        message: `${target.name} com latencia elevada`,
        payload: { latencyMs: result.latencyMs }
      });
    } else {
      resolveAlert(latencyKey);
    }

    const lossSeverity = evaluateThreshold(result.packetLoss, thresholds.warningPacketLoss, thresholds.criticalPacketLoss);
    const lossKey = `${target.id}:packet_loss`;
    if (lossSeverity) {
      openOrRefreshAlert({
        alertKey: lossKey,
        targetId: target.id,
        type: "packet_loss",
        severity: lossSeverity,
        message: `${target.name} com perda de pacotes elevada`,
        payload: { packetLoss: result.packetLoss }
      });
    } else {
      resolveAlert(lossKey);
    }

    if (target.type === "dns") {
      const dnsKey = `${target.id}:dns_failure`;
      if (result.status === "down") {
        openOrRefreshAlert({
          alertKey: dnsKey,
          targetId: target.id,
          type: "dns_failure",
          severity: "critical",
          message: `${target.name} falhou em responder consultas DNS`,
          payload: result.details
        });
      } else {
        resolveAlert(dnsKey);
      }
    }

    if (metrics) {
      const cpuSeverity = evaluateThreshold(metrics.cpu?.usage, thresholds.cpuUsageWarning, thresholds.cpuUsageCritical);
      const cpuKey = `${target.id}:cpu_high`;
      if (cpuSeverity) {
        openOrRefreshAlert({
          alertKey: cpuKey,
          targetId: target.id,
          type: "cpu_high",
          severity: cpuSeverity,
          message: `${target.name} com CPU alta`,
          payload: { cpuUsage: metrics.cpu?.usage }
        });
      } else {
        resolveAlert(cpuKey);
      }

      const memorySeverity = evaluateThreshold(metrics.memory?.usedPercent, thresholds.memoryUsageWarning, thresholds.memoryUsageCritical);
      const memoryKey = `${target.id}:memory_high`;
      if (memorySeverity) {
        openOrRefreshAlert({
          alertKey: memoryKey,
          targetId: target.id,
          type: "memory_high",
          severity: memorySeverity,
          message: `${target.name} com uso de RAM alto`,
          payload: { memoryUsedPercent: metrics.memory?.usedPercent }
        });
      } else {
        resolveAlert(memoryKey);
      }

      const highestDisk = (metrics.disks || []).reduce((max, disk) => Math.max(max, disk.usedPercent || 0), 0);
      const diskSeverity = evaluateThreshold(highestDisk, thresholds.diskUsageWarning, thresholds.diskUsageCritical);
      const diskKey = `${target.id}:disk_high`;
      if (diskSeverity) {
        openOrRefreshAlert({
          alertKey: diskKey,
          targetId: target.id,
          type: "disk_high",
          severity: diskSeverity,
          message: `${target.name} com uso de disco alto`,
          payload: { highestDiskPercent: highestDisk }
        });
      } else {
        resolveAlert(diskKey);
      }

      for (const networkInterface of metrics.network || []) {
        const ifaceKey = `${target.id}:iface:${networkInterface.interface}:down`;
        if (networkInterface.operstate && networkInterface.operstate !== "up") {
          openOrRefreshAlert({
            alertKey: ifaceKey,
            targetId: target.id,
            type: "interface_down",
            severity: "warning",
            message: `${target.name} possui interface ${networkInterface.interface} em ${networkInterface.operstate}`,
            payload: networkInterface
          });
        } else {
          resolveAlert(ifaceKey);
        }
      }
    }
  }

  return {
    processCheck,
    listActiveAlerts() {
      return [...activeAlerts.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    }
  };
}

module.exports = {
  createAlertEngine
};

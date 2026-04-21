const { extractHostnameFromUrl, normalizeIdentifier } = require("../discovery/host-context-service");

function statusRank(status) {
  if (status === "down") {
    return 4;
  }
  if (status === "degraded") {
    return 3;
  }
  if (status === "up") {
    return 2;
  }
  return 1;
}

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumNetworkRates(interfaces = [], key) {
  return interfaces.reduce((sum, item) => sum + (Number(item?.[key]) || 0), 0);
}

function buildSeries(points = []) {
  return points.filter((point) => point.value != null && !Number.isNaN(Number(point.value)));
}

function getLatestAgentMetrics(history) {
  return history.agentMetrics.at(-1)?.metrics || null;
}

function buildBundleIdentifiers(bundle) {
  const latestAgent = getLatestAgentMetrics(bundle.history);
  return [
    normalizeIdentifier(bundle.target.host),
    normalizeIdentifier(extractHostnameFromUrl(bundle.target.url)),
    normalizeIdentifier(latestAgent?.hostname),
    normalizeIdentifier(latestAgent?.fqdn)
  ].filter(Boolean);
}

function hasIdentifierOverlap(left, right) {
  return left.some((value) => right.includes(value));
}

function resolveHostStatus(bundles) {
  const controlBundles = bundles.filter((bundle) => ["agent", "ping", "gateway"].includes(bundle.target.type));
  const serviceBundles = bundles.filter((bundle) => !["agent", "ping", "gateway"].includes(bundle.target.type));
  const controlStatuses = controlBundles.map((bundle) => bundle.current?.status).filter(Boolean);
  const serviceStatuses = serviceBundles.map((bundle) => bundle.current?.status).filter(Boolean);
  const hasControlUp = controlStatuses.includes("up") || controlStatuses.includes("degraded");
  const allControlsDown = controlStatuses.length > 0 && controlStatuses.every((status) => status === "down");
  const hasServiceDown = serviceStatuses.includes("down");
  const hasAnyUp = [...controlStatuses, ...serviceStatuses].includes("up");
  const hasAnyDegraded = [...controlStatuses, ...serviceStatuses].includes("degraded");
  const hasAnyUnknown = bundles.some((bundle) => !bundle.current?.status || bundle.current.status === "unknown");

  if (allControlsDown) {
    return "down";
  }
  if (hasControlUp && hasServiceDown) {
    return "degraded";
  }
  if (hasControlUp || hasAnyUp) {
    return hasAnyDegraded ? "degraded" : "up";
  }
  if (hasAnyDegraded) {
    return "degraded";
  }
  if (hasAnyUnknown) {
    return "unknown";
  }
  return "down";
}

function buildHostSnapshot(states) {
  const bundles = Object.values(states);
  const groups = [];

  for (const bundle of bundles) {
    const identifiers = buildBundleIdentifiers(bundle);
    const matchingGroups = groups.filter((group) => hasIdentifierOverlap(group.identifiers, identifiers));

    if (!matchingGroups.length) {
      groups.push({
        bundles: [bundle],
        identifiers: identifiers.length ? [...identifiers] : [`target:${bundle.target.id}`]
      });
      continue;
    }

    const primaryGroup = matchingGroups[0];
    primaryGroup.bundles.push(bundle);
    for (const identifier of identifiers) {
      if (!primaryGroup.identifiers.includes(identifier)) {
        primaryGroup.identifiers.push(identifier);
      }
    }

    for (const duplicateGroup of matchingGroups.slice(1)) {
      primaryGroup.bundles.push(...duplicateGroup.bundles);
      for (const identifier of duplicateGroup.identifiers) {
        if (!primaryGroup.identifiers.includes(identifier)) {
          primaryGroup.identifiers.push(identifier);
        }
      }
      groups.splice(groups.indexOf(duplicateGroup), 1);
    }
  }

  return groups.map((group, index) => {
    const agentBundle = group.bundles
      .filter((bundle) => bundle.target.type === "agent" && bundle.history.agentMetrics.length > 0)
      .sort((left, right) => new Date(right.history.agentMetrics.at(-1).collectedAt) - new Date(left.history.agentMetrics.at(-1).collectedAt))[0]
      || group.bundles.find((bundle) => bundle.target.type === "agent")
      || group.bundles[0];

    const latestAgent = agentBundle ? getLatestAgentMetrics(agentBundle.history) : null;
    const worstBundle = [...group.bundles].sort((left, right) => statusRank(right.current?.status) - statusRank(left.current?.status))[0] || null;
    const hostStatus = resolveHostStatus(group.bundles);
    const latencyValues = group.bundles.map((bundle) => bundle.current?.latencyMs).filter((value) => value != null);
    const statusCounts = group.bundles.reduce((acc, bundle) => {
      const key = bundle.current?.status || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const currentDisks = latestAgent?.disks || [];
    const diskUsage = currentDisks.length ? Math.max(...currentDisks.map((disk) => Number(disk.usedPercent) || 0)) : null;
    const hostName = latestAgent?.hostname || latestAgent?.fqdn || agentBundle?.target.host || extractHostnameFromUrl(agentBundle?.target.url) || agentBundle?.target.name || `host-${index + 1}`;
    const agentHistory = agentBundle?.history?.agentMetrics || [];
    const latencyHistorySource = agentBundle?.history?.checks?.length
      ? agentBundle.history.checks
      : group.bundles
        .flatMap((bundle) => bundle.history?.checks || [])
        .sort((left, right) => new Date(left.checkedAt || 0) - new Date(right.checkedAt || 0));
    const series = {
      cpu: buildSeries(agentHistory.map((entry) => ({ timestamp: entry.collectedAt, value: entry.cpuUsage }))),
      memory: buildSeries(agentHistory.map((entry) => ({ timestamp: entry.collectedAt, value: entry.memoryUsedPercent }))),
      disk: buildSeries(agentHistory.map((entry) => ({
        timestamp: entry.collectedAt,
        value: entry.metrics?.disks?.length
          ? Math.max(...entry.metrics.disks.map((disk) => Number(disk.usedPercent) || 0))
          : null
      }))),
      rx: buildSeries(agentHistory.map((entry) => ({ timestamp: entry.collectedAt, value: sumNetworkRates(entry.metrics?.network || [], "rx_rate") }))),
      tx: buildSeries(agentHistory.map((entry) => ({ timestamp: entry.collectedAt, value: sumNetworkRates(entry.metrics?.network || [], "tx_rate") }))),
      latency: buildSeries(latencyHistorySource.map((entry) => ({ timestamp: entry.checkedAt, value: entry.latencyMs })))
    };

    return {
      id: group.identifiers[0] || `host-${index + 1}`,
      hostKey: group.identifiers[0] || `host-${index + 1}`,
      hostname: hostName,
      fqdn: latestAgent?.fqdn || null,
      status: hostStatus,
      statusCounts,
      targetCount: group.bundles.length,
      primaryTargetId: agentBundle?.target.id || group.bundles[0]?.target.id || null,
      primaryTargetName: agentBundle?.target.name || group.bundles[0]?.target.name || null,
      cpuUsage: latestAgent?.cpu?.usage ?? null,
      memoryUsedPercent: latestAgent?.memory?.usedPercent ?? null,
      diskUsedPercent: diskUsage,
      uptime: latestAgent?.uptime ?? null,
      averageLatencyMs: average(latencyValues),
      lastCheckAt: worstBundle?.current?.lastCheckAt || null,
      alertCount: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
      series,
      identifiers: group.identifiers,
      targetIds: group.bundles.map((bundle) => bundle.target.id),
      targets: group.bundles.map((bundle) => ({
        id: bundle.target.id,
        name: bundle.target.name,
        type: bundle.target.type,
        status: bundle.current?.status || "unknown",
        endpoint: bundle.target.url || (bundle.target.port ? `${bundle.target.host}:${bundle.target.port}` : bundle.target.host || null)
      }))
    };
  }).sort((left, right) => left.hostname.localeCompare(right.hostname));
}

function createHistoryService(repository, historyLimit) {
  return {
    getBootstrapForTarget(targetId) {
      return {
        checks: repository.getRecentChecks(targetId, historyLimit).reverse(),
        agentMetrics: repository.getRecentAgentMetrics(targetId, historyLimit).reverse(),
        networkMetrics: repository.getRecentNetworkMetrics(targetId, historyLimit).reverse()
      };
    },
    getDashboardSnapshot(targetsOrOptions, currentStateMap, alertEngine, correlationEngine = null) {
      const options = Array.isArray(targetsOrOptions)
        ? {
            targets: targetsOrOptions,
            currentStateMap,
            alertEngine,
            correlationEngine
          }
        : (targetsOrOptions || {});
      const targets = options.targets || [];
      const resolvedCurrentStateMap = options.currentStateMap || {};
      const resolvedAlertEngine = options.alertEngine || { listActiveAlerts: () => repository.listActiveAlerts() };
      const resolvedCorrelationEngine = options.correlationEngine || correlationEngine || null;
      const states = {};
      for (const target of targets) {
        const current = resolvedCurrentStateMap[target.id] || null;
        const history = this.getBootstrapForTarget(target.id);
        states[target.id] = { target, current, history };
      }
      const activeAlerts = resolvedAlertEngine.listActiveAlerts();
      const hosts = buildHostSnapshot(states).map((host) => {
        const hostAlerts = activeAlerts.filter((alert) => host.targetIds.includes(alert.targetId));
        return {
          ...host,
          alertCount: hostAlerts.length,
          criticalAlertCount: hostAlerts.filter((alert) => alert.severity === "critical").length,
          warningAlertCount: hostAlerts.filter((alert) => alert.severity === "warning").length
        };
      });
      return {
        generatedAt: new Date().toISOString(),
        targets: states,
        hosts,
        alerts: repository.listAlerts(200),
        activeAlerts,
        correlations: repository.listCorrelatedFindings(200),
        activeCorrelations: resolvedCorrelationEngine?.listActiveFindings?.() || repository.listActiveCorrelatedFindings()
      };
    }
  };
}

module.exports = {
  createHistoryService
};

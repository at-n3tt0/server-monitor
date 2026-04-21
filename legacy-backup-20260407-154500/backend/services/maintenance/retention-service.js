function subtractDays(days) {
  const now = Date.now();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function createRetentionService({ repository, websocketHub, retentionConfig, maintenanceConfig }) {
  let cleanupTimer = null;
  let vacuumTimer = null;

  function runCleanup() {
    const summary = repository.pruneHistoricalData({
      checkResultsBefore: subtractDays(retentionConfig.checkResultsDays),
      agentMetricsBefore: subtractDays(retentionConfig.agentMetricsDays),
      networkMetricsBefore: subtractDays(retentionConfig.networkMetricsDays),
      eventsBefore: subtractDays(retentionConfig.eventsDays),
      alertsBefore: subtractDays(retentionConfig.alertsDays),
      nowIso: new Date().toISOString()
    });

    console.log("[maintenance] limpeza concluida", summary);
    websocketHub.broadcast("maintenance", {
      type: "cleanup",
      timestamp: new Date().toISOString(),
      summary
    });
    return summary;
  }

  function runVacuum() {
    repository.runMaintenance();
    const payload = {
      type: "vacuum",
      timestamp: new Date().toISOString()
    };
    console.log("[maintenance] vacuum/checkpoint concluido");
    websocketHub.broadcast("maintenance", payload);
    return payload;
  }

  function start() {
    runCleanup();
    cleanupTimer = setInterval(runCleanup, maintenanceConfig.cleanupIntervalMinutes * 60 * 1000);
    vacuumTimer = setInterval(runVacuum, maintenanceConfig.vacuumIntervalHours * 60 * 60 * 1000);
  }

  function stop() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }
    if (vacuumTimer) {
      clearInterval(vacuumTimer);
    }
  }

  return {
    start,
    stop,
    runCleanup,
    runVacuum
  };
}

module.exports = {
  createRetentionService
};

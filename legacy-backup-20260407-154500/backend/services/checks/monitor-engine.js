const { runCheck } = require("./check-runners");
const { sanitizeTarget } = require("../../utils/http");

function buildStateFromResult(target, previousState, result, checkedAt) {
  return {
    targetId: target.id,
    status: result.status,
    availability: result.availability ?? null,
    latencyMs: result.latencyMs ?? null,
    packetLoss: result.packetLoss ?? null,
    jitterMs: result.jitterMs ?? null,
    lastCheckAt: checkedAt,
    lastChangeAt: !previousState || previousState.status !== result.status ? checkedAt : previousState.lastChangeAt,
    message: result.message || null,
    details: result.details || {}
  };
}

function createMonitorEngine({ repository, websocketHub, alertEngine, historyService, pingSamples, historyLimit }) {
  const timers = new Map();
  const running = new Map();
  const currentStateMap = repository.loadCurrentState();
  let targets = [];
  let correlationEngine = null;

  function getTarget(targetId) {
    return targets.find((target) => target.id === targetId);
  }

  function buildAgentMetricEntry(target, metrics, checkedAt) {
    return {
      targetId: target.id,
      hostname: metrics.hostname,
      os: metrics.os,
      uptimeSeconds: metrics.uptime,
      cpuUsage: metrics.cpu?.usage ?? null,
      cpuCores: metrics.cpu?.cores ?? null,
      memoryTotal: metrics.memory?.total ?? null,
      memoryUsed: metrics.memory?.used ?? null,
      memoryUsedPercent: metrics.memory?.usedPercent ?? null,
      metrics,
      collectedAt: checkedAt
    };
  }

  function buildNetworkEntries(target, result, checkedAt) {
    const entries = [{
      targetId: target.id,
      interfaceName: null,
      latencyMs: result.latencyMs ?? null,
      packetLoss: result.packetLoss ?? null,
      jitterMs: result.jitterMs ?? null,
      gatewayStatus: target.type === "gateway" ? result.status : null,
      dnsStatus: target.type === "dns" ? result.status : null,
      collectedAt: checkedAt,
      details: {
        type: target.type,
        message: result.message,
        ...result.details
      }
    }];

    if (result.metrics?.network?.length) {
      for (const networkInterface of result.metrics.network) {
        entries.push({
          targetId: target.id,
          interfaceName: networkInterface.interface,
          rxBytes: networkInterface.rx_bytes ?? null,
          txBytes: networkInterface.tx_bytes ?? null,
          rxRate: networkInterface.rx_rate ?? null,
          txRate: networkInterface.tx_rate ?? null,
          operstate: networkInterface.operstate ?? null,
          collectedAt: checkedAt,
          details: networkInterface
        });
      }
    }

    return entries;
  }

  async function executeCheck(target) {
    if (!target.enabled) {
      return null;
    }
    if (running.get(target.id)) {
      return running.get(target.id);
    }

    const job = (async () => {
      const checkedAt = new Date().toISOString();
      const previousState = currentStateMap[target.id] || null;
      console.log(`[monitor] check start target=${target.name} type=${target.type} id=${target.id}`);
      const result = await runCheck(target, { pingSamples });
      const nextState = buildStateFromResult(target, previousState, result, checkedAt);

      repository.saveCurrentState(nextState);
      repository.saveCheckResult({
        targetId: target.id,
        status: nextState.status,
        availability: nextState.availability,
        latencyMs: nextState.latencyMs,
        packetLoss: nextState.packetLoss,
        jitterMs: nextState.jitterMs,
        httpStatus: result.httpStatus || null,
        message: nextState.message,
        checkedAt,
        details: {
          ...result.details,
          targetType: target.type
        }
      });

      if (result.metrics) {
        repository.saveAgentMetrics(buildAgentMetricEntry(target, result.metrics, checkedAt));
      }

      repository.saveNetworkMetrics(buildNetworkEntries(target, result, checkedAt));

      currentStateMap[target.id] = nextState;
      alertEngine.processCheck(target, previousState, result);
      correlationEngine?.evaluateHost(target.id);
      console.log(
        `[monitor] check done target=${target.name} status=${nextState.status} latency=${nextState.latencyMs ?? "-"} message=${nextState.message || "-"}`
      );

      const history = historyService.getBootstrapForTarget(target.id);
      websocketHub.broadcast("target_update", (client) => ({
        target: sanitizeTarget(target, client.auth?.role || "viewer"),
        current: nextState,
        history
      }));

      return { target, current: nextState, history };
    })().catch((error) => {
      console.error(`[monitor] check failure target=${target.name} id=${target.id}`, error);
      throw error;
    }).finally(() => {
      running.delete(target.id);
    });

    running.set(target.id, job);
    return job;
  }

  function clearSchedules() {
    for (const timer of timers.values()) {
      clearInterval(timer);
    }
    timers.clear();
  }

  function scheduleTargets(nextTargets) {
    clearSchedules();
    targets = nextTargets;
    for (const target of targets) {
      executeCheck(target).catch(() => {});
      timers.set(target.id, setInterval(() => {
        executeCheck(target).catch(() => {});
      }, target.intervalSeconds * 1000));
    }
  }

  return {
    scheduleTargets,
    executeCheck,
    getTarget,
    getCurrentStateMap() {
      return currentStateMap;
    },
    getBootstrap() {
      return {
        currentStateMap,
        historyLimit
      };
    },
    setCorrelationEngine(engine) {
      correlationEngine = engine;
    }
  };
}

module.exports = {
  createMonitorEngine
};

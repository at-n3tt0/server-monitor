const { findMonitoringProfile } = require("../../../shared/templates/monitoring-profiles");
const { AppError } = require("../../../shared/errors/app-error");
const { createHostContextService, extractHostnameFromUrl } = require("../discovery/host-context-service");
const { inferRoles, summarizeAvailableSignals } = require("../fingerprints/fingerprint-engine");

function statusWeight(status) {
  if (status === "down") {
    return 3;
  }
  if (status === "degraded") {
    return 2;
  }
  if (status === "up") {
    return 1;
  }
  return 0;
}

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueBy(items, keyFactory) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFactory(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatTargetEndpoint(target) {
  if (target.url) {
    return target.url;
  }
  if (target.host && target.port) {
    return `${target.host}:${target.port}`;
  }
  return target.host || target.name;
}

function buildIdentity(context) {
  const primaryMetrics = context.primaryAgentMetrics;
  return {
    hostId: primaryMetrics?.hostname || context.identifiers[0] || context.primaryTarget.id,
    hostname: primaryMetrics?.hostname || context.primaryTarget.host || extractHostnameFromUrl(context.primaryTarget.url) || context.primaryTarget.name,
    fqdn: primaryMetrics?.fqdn || null,
    os: primaryMetrics?.os || null,
    osVersion: primaryMetrics?.osVersion || null,
    kernel: primaryMetrics?.kernel || null,
    platform: primaryMetrics?.platform || null,
    arch: primaryMetrics?.arch || null,
    uptime: primaryMetrics?.uptime || null,
    virtualization: primaryMetrics?.virtualization || null,
    identifiers: context.identifiers
  };
}

function buildHealthSummary(context) {
  const worstBundle = [...context.relatedBundles].sort((left, right) => statusWeight(right.current?.status) - statusWeight(left.current?.status))[0];
  const activeAlerts = context.activeAlerts.map((alert) => ({
    severity: alert.severity,
    type: alert.type,
    message: alert.message,
    targetId: alert.targetId,
    lastSeenAt: alert.lastSeenAt
  }));
  const checkLatencies = context.relatedBundles.flatMap((bundle) => bundle.history.checks.map((check) => check.latencyMs).filter((value) => value != null));
  const losses = context.relatedBundles.flatMap((bundle) => bundle.history.checks.map((check) => check.packetLoss).filter((value) => value != null));
  const jitters = context.relatedBundles.flatMap((bundle) => bundle.history.checks.map((check) => check.jitterMs).filter((value) => value != null));

  return {
    status: worstBundle?.current?.status || "unknown",
    message: worstBundle?.current?.message || "Sem estado consolidado",
    worstTargetId: worstBundle?.target?.id || null,
    averageLatencyMs: average(checkLatencies),
    averagePacketLoss: average(losses),
    averageJitterMs: average(jitters),
    activeAlerts,
    relatedTargets: context.relatedBundles.length
  };
}

function detectRisks(context) {
  const risks = [];
  const primaryMetrics = context.primaryAgentMetrics;
  const thresholds = context.primaryBundle.target.thresholds || {};
  const activeAlerts = context.activeAlerts;

  if (context.relatedBundles.some((bundle) => bundle.current?.status === "down")) {
    risks.push({
      severity: "critical",
      category: "availability",
      title: "Ha targets relacionados indisponiveis",
      details: context.relatedBundles
        .filter((bundle) => bundle.current?.status === "down")
        .map((bundle) => `${bundle.target.name}: ${bundle.current?.message || "indisponivel"}`),
      evidence: ["current_state.status=down"]
    });
  }

  if (primaryMetrics?.cpu?.usage >= thresholds.cpuUsageCritical) {
    risks.push({
      severity: "critical",
      category: "resource",
      title: "Uso de CPU acima do threshold critico",
      details: [`CPU atual em ${primaryMetrics.cpu.usage}%`],
      evidence: ["agent.cpu.usage"]
    });
  } else if (primaryMetrics?.cpu?.usage >= thresholds.cpuUsageWarning) {
    risks.push({
      severity: "warning",
      category: "resource",
      title: "Uso de CPU acima do threshold de alerta",
      details: [`CPU atual em ${primaryMetrics.cpu.usage}%`],
      evidence: ["agent.cpu.usage"]
    });
  }

  if (primaryMetrics?.memory?.usedPercent >= thresholds.memoryUsageCritical) {
    risks.push({
      severity: "critical",
      category: "resource",
      title: "Uso de memoria acima do threshold critico",
      details: [`RAM atual em ${primaryMetrics.memory.usedPercent}%`],
      evidence: ["agent.memory.usedPercent"]
    });
  } else if (primaryMetrics?.memory?.usedPercent >= thresholds.memoryUsageWarning) {
    risks.push({
      severity: "warning",
      category: "resource",
      title: "Uso de memoria acima do threshold de alerta",
      details: [`RAM atual em ${primaryMetrics.memory.usedPercent}%`],
      evidence: ["agent.memory.usedPercent"]
    });
  }

  for (const disk of primaryMetrics?.disks || []) {
    if (disk.usedPercent >= thresholds.diskUsageCritical) {
      risks.push({
        severity: "critical",
        category: "storage",
        title: `Particao ${disk.mount} com uso critico`,
        details: [`Uso atual em ${disk.usedPercent}%`],
        evidence: ["agent.disks.usedPercent"]
      });
    } else if (disk.usedPercent >= thresholds.diskUsageWarning) {
      risks.push({
        severity: "warning",
        category: "storage",
        title: `Particao ${disk.mount} com uso elevado`,
        details: [`Uso atual em ${disk.usedPercent}%`],
        evidence: ["agent.disks.usedPercent"]
      });
    }
  }

  for (const iface of primaryMetrics?.network || []) {
    if (String(iface.operstate || "").toLowerCase() === "down") {
      risks.push({
        severity: "warning",
        category: "network",
        title: `Interface ${iface.interface} reportada como down`,
        details: ["O agente reportou operstate=down"],
        evidence: ["agent.network.operstate"]
      });
    }
  }

  const recentChecks = context.relatedBundles.flatMap((bundle) => bundle.history.checks.slice(0, 12));
  const averageLoss = average(recentChecks.map((item) => item.packetLoss).filter((value) => value != null));
  const averageLatency = average(recentChecks.map((item) => item.latencyMs).filter((value) => value != null));
  if (averageLoss != null && averageLoss >= thresholds.warningPacketLoss) {
    risks.push({
      severity: averageLoss >= thresholds.criticalPacketLoss ? "critical" : "warning",
      category: "network",
      title: "Perda media de pacotes acima do esperado",
      details: [`Media recente em ${averageLoss.toFixed(2)}%`],
      evidence: ["check_results.packetLoss"]
    });
  }
  if (averageLatency != null && averageLatency >= thresholds.warningLatencyMs) {
    risks.push({
      severity: averageLatency >= thresholds.criticalLatencyMs ? "critical" : "warning",
      category: "network",
      title: "Latencia media acima do esperado",
      details: [`Media recente em ${averageLatency.toFixed(2)} ms`],
      evidence: ["check_results.latencyMs"]
    });
  }

  for (const alert of activeAlerts) {
    risks.push({
      severity: alert.severity,
      category: "alert",
      title: `Alerta ativo: ${alert.type}`,
      details: [alert.message],
      evidence: ["alerts.active"]
    });
  }

  return uniqueBy(risks, (item) => `${item.severity}:${item.title}`);
}

function buildCoverageMap(context) {
  return {
    hasAgent: context.relatedBundles.some((bundle) => bundle.target.type === "agent"),
    hasDns: context.relatedBundles.some((bundle) => bundle.target.type === "dns"),
    hasHttp: context.relatedBundles.some((bundle) => bundle.target.type === "http"),
    hasGateway: context.relatedBundles.some((bundle) => bundle.target.type === "gateway"),
    tcpPorts: new Set(context.relatedBundles.filter((bundle) => bundle.target.type === "tcp").map((bundle) => Number(bundle.target.port))),
    targetTypes: new Set(context.relatedBundles.map((bundle) => bundle.target.type))
  };
}

function buildMonitoringGap(message, severity, reasons, profileId = null) {
  return {
    severity,
    message,
    reasons,
    suggestedProfileId: profileId
  };
}

function detectMonitoringGaps(context, detectedRoles) {
  const coverage = buildCoverageMap(context);
  const gaps = [];

  if (context.primaryAgentMetrics && !coverage.hasAgent) {
    gaps.push(buildMonitoringGap(
      "O host possui sinais suficientes para analise profunda, mas nao existe target agent associado na mesma identidade.",
      "warning",
      ["Sem target agent, a coleta detalhada futura pode ficar limitada."],
      detectedRoles[0]?.recommendedProfileId || null
    ));
  }

  for (const role of detectedRoles) {
    switch (role.role) {
      case "dns_server":
        if (!coverage.hasDns) {
          gaps.push(buildMonitoringGap("Host aparenta fornecer DNS, mas nao ha check DNS configurado.", "warning", ["Falta validar resolucao de forma explicita."], "dns-server"));
        }
        if (!coverage.tcpPorts.has(53)) {
          gaps.push(buildMonitoringGap("Host aparenta fornecer DNS, mas nao ha check TCP 53 configurado.", "info", ["Falta confirmar acessibilidade da porta DNS."], "dns-server"));
        }
        break;
      case "file_server":
        if (!coverage.tcpPorts.has(445)) {
          gaps.push(buildMonitoringGap("Host aparenta ser servidor de arquivos, mas nao ha check TCP 445 configurado.", "warning", ["Falta monitorar disponibilidade SMB."], "file-server"));
        }
        if (!coverage.tcpPorts.has(139)) {
          gaps.push(buildMonitoringGap("Host aparenta ser servidor de arquivos, mas nao ha check TCP 139 configurado.", "info", ["Falta monitorar disponibilidade NetBIOS/SMB legada quando aplicavel."], "file-server"));
        }
        break;
      case "active_directory":
        for (const port of [53, 88, 389, 445, 636, 3268]) {
          if (!coverage.tcpPorts.has(port)) {
            gaps.push(buildMonitoringGap(`Controlador de dominio provável sem monitoramento TCP ${port}.`, "warning", ["O conjunto AD esta incompleto no monitoramento."], "domain-controller"));
          }
        }
        if (!coverage.hasDns) {
          gaps.push(buildMonitoringGap("Controlador de dominio provável sem check DNS associado.", "warning", ["AD depende de DNS funcional."], "domain-controller"));
        }
        break;
      case "web_server":
        if (!coverage.hasHttp) {
          gaps.push(buildMonitoringGap("Host aparenta ser servidor web, mas nao ha check HTTP/HTTPS configurado.", "warning", ["Falta validar resposta de aplicacao."], "web-server"));
        }
        break;
      case "database_server":
        if (![1433, 1521, 3306, 5432, 27017, 6379].some((port) => coverage.tcpPorts.has(port))) {
          gaps.push(buildMonitoringGap("Host aparenta ser banco de dados, mas nao ha check TCP do servico configurado.", "warning", ["A porta principal do banco nao esta sendo monitorada."], "database-server"));
        }
        break;
      case "gateway":
      case "router":
        if (!coverage.hasGateway) {
          gaps.push(buildMonitoringGap("Ativo de borda sem check dedicado de gateway.", "warning", ["Falta medir perda, jitter e latencia da borda local."], "gateway"));
        }
        break;
      default:
        break;
    }
  }

  return uniqueBy(gaps, (item) => item.message);
}

function buildRecommendedProfiles(detectedRoles) {
  const profiles = uniqueBy(detectedRoles
    .map((role) => {
      const profile = role.recommendedProfileId ? findMonitoringProfile(role.recommendedProfileId) : null;
      if (!profile) {
        return null;
      }
      return {
        id: profile.id,
        name: profile.name,
        category: profile.category,
        confidence: role.confidence,
        reason: `Perfil alinhado ao papel detectado: ${role.label}`
      };
    })
    .filter(Boolean), (item) => item.id);

  const hasSpecificServerProfile = profiles.some((profile) => !["linux-server", "windows-server"].includes(profile.id));
  return profiles.filter((profile) => !["linux-server", "windows-server"].includes(profile.id) || !hasSpecificServerProfile);
}

function buildRecommendedChecks(context, detectedRoles, monitoringGaps) {
  const hostHint = context.primaryTarget.host || extractHostnameFromUrl(context.primaryTarget.url) || context.primaryAgentMetrics?.hostname || null;
  const lookupHostname = context.relatedBundles.find((bundle) => bundle.target.type === "dns")?.target?.metadata?.lookupHostname || context.primaryTarget.metadata?.lookupHostname || null;
  const checks = [];

  for (const gap of monitoringGaps) {
    if (gap.message.includes("check DNS")) {
      checks.push({
        type: "dns",
        priority: gap.severity,
        reason: gap.message,
        proposedTarget: hostHint ? { host: hostHint, metadata: lookupHostname ? { lookupHostname } : {} } : null,
        requirements: lookupHostname ? [] : ["Informar hostname de lookup real para validar resolucao."]
      });
    }
    if (gap.message.includes("TCP 53")) {
      checks.push({
        type: "tcp",
        priority: gap.severity,
        reason: gap.message,
        proposedTarget: hostHint ? { host: hostHint, port: 53 } : null
      });
    }
    if (gap.message.includes("TCP 445")) {
      checks.push({
        type: "tcp",
        priority: gap.severity,
        reason: gap.message,
        proposedTarget: hostHint ? { host: hostHint, port: 445 } : null
      });
    }
    if (gap.message.includes("HTTP/HTTPS")) {
      checks.push({
        type: "http",
        priority: gap.severity,
        reason: gap.message,
        proposedTarget: context.primaryTarget.url ? { url: context.primaryTarget.url } : null
      });
    }
    if (gap.message.includes("gateway")) {
      checks.push({
        type: "gateway",
        priority: gap.severity,
        reason: gap.message,
        proposedTarget: hostHint ? { host: hostHint } : null
      });
    }
  }

  if (context.primaryAgentMetrics && !context.relatedBundles.some((bundle) => bundle.target.type === "agent")) {
    checks.push({
      type: "agent",
      priority: "warning",
      reason: "Coleta profunda existente sugere manter ou formalizar um target agent dedicado para este host.",
      proposedTarget: null,
      requirements: ["Informar URL real do agente antes de cadastrar o target."]
    });
  }

  return uniqueBy(checks, (item) => `${item.type}:${JSON.stringify(item.proposedTarget || {})}`);
}

function buildSuggestedActions(detectedRoles, risks, monitoringGaps) {
  const actions = [];

  if (detectedRoles.length) {
    actions.push(`Revisar e aprovar o perfil recomendado mais forte: ${detectedRoles[0].label}.`);
  }
  for (const risk of risks) {
    actions.push(`${risk.severity.toUpperCase()}: ${risk.title}.`);
  }
  for (const gap of monitoringGaps) {
    actions.push(`Cobrir lacuna de monitoramento: ${gap.message}`);
  }

  return uniqueBy(actions, (item) => item);
}

function buildLimitations(context, detectedRoles) {
  const availability = summarizeAvailableSignals(context);
  const limitations = [];
  if (!availability.hasAgentMetrics) {
    limitations.push("Nao ha dados recentes de agente para o host; a classificacao usa apenas checks e configuracao existente.");
  }
  if (availability.hasAgentMetrics && !availability.hasListeningPorts) {
    limitations.push("O agente nao trouxe portas em escuta; algumas inferencias de papel ficaram menos confiaveis.");
  }
  if (availability.hasAgentMetrics && !availability.hasServices) {
    limitations.push("O agente nao trouxe servicos ativos; a correlacao de papeis ficou dependente de processos e portas.");
  }
  if (!detectedRoles.some((role) => role.category === "network")) {
    limitations.push("Papéis de rede avancados ainda dependem de SNMP para ganhar profundidade maior; nesta fase a inferencia de rede usa apenas checks e metadados ja existentes.");
  }
  return limitations;
}

function createDiagnosticService({ repository, getTargets, getCurrentStateMap, auditService }) {
  const hostContextService = createHostContextService({ repository, getTargets, getCurrentStateMap });

  function generateDiagnosis(targetId) {
    const context = hostContextService.resolveRelatedBundles(targetId);
    if (!context) {
      throw new AppError(404, "not_found", "Target nao encontrado");
    }

    context.activeAlerts = repository.listActiveAlerts().filter((alert) => context.relatedBundles.some((bundle) => bundle.target.id === alert.targetId));

    const identity = buildIdentity(context);
    const detectedRoles = inferRoles(context);
    const healthSummary = buildHealthSummary(context);
    const risks = detectRisks(context);
    const monitoringGaps = detectMonitoringGaps(context, detectedRoles);
    const recommendedProfiles = buildRecommendedProfiles(detectedRoles);
    const recommendedChecks = buildRecommendedChecks(context, detectedRoles, monitoringGaps);
    const suggestedActions = buildSuggestedActions(detectedRoles, risks, monitoringGaps);
    const limitations = buildLimitations(context, detectedRoles);

    return {
      hostId: identity.hostId,
      targetId: context.primaryTarget.id,
      generatedAt: new Date().toISOString(),
      identity,
      relatedTargets: context.relatedBundles.map((bundle) => ({
        id: bundle.target.id,
        name: bundle.target.name,
        type: bundle.target.type,
        endpoint: formatTargetEndpoint(bundle.target),
        status: bundle.current?.status || "unknown",
        lastCheckAt: bundle.current?.lastCheckAt || null
      })),
      detectedRoles,
      healthSummary,
      risks,
      monitoringGaps,
      recommendedProfiles,
      recommendedChecks,
      suggestedActions,
      notes: [
        "O diagnostico e baseado em evidencias reais coletadas pelo agente, checks ativos ja existentes e historico persistido.",
        "Nenhum papel e inferido sem trilha de evidencia; quando faltam sinais, o sistema registra a limitacao."
      ],
      limitations,
      explainability: {
        signalAvailability: summarizeAvailableSignals(context),
        correlationMethod: "rule_weighted_fingerprint"
      }
    };
  }

  function persistDiagnosis(targetId, diagnosis) {
    repository.saveDiagnosticSnapshot({
      targetId,
      hostKey: diagnosis.hostId,
      diagnosis,
      createdAt: diagnosis.generatedAt
    });
  }

  function getLatestDiagnosis(targetId) {
    const latest = repository.getLatestDiagnosticSnapshot(targetId);
    return latest?.diagnosis || null;
  }

  function runDiagnosis(targetId, request = null, auth = null) {
    const diagnosis = generateDiagnosis(targetId);
    persistDiagnosis(targetId, diagnosis);
    if (auditService && request) {
      auditService.log({
        actionType: "diagnostics.run",
        targetType: "target",
        targetId,
        summary: `Diagnostico executado para ${diagnosis.identity.hostname}`,
        details: {
          hostId: diagnosis.hostId,
          detectedRoles: diagnosis.detectedRoles.map((role) => ({
            role: role.role,
            confidence: role.confidence
          }))
        },
        context: auditService.createContext(request, auth)
      });
    }
    return diagnosis;
  }

  return {
    getLatestDiagnosis,
    generateDiagnosis,
    runDiagnosis
  };
}

module.exports = {
  createDiagnosticService
};

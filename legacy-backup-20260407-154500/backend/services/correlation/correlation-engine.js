const crypto = require("crypto");
const { createHostContextService } = require("../discovery/host-context-service");

function createCorrelationEngine({ repository, websocketHub, diagnosticService, getTargets, getCurrentStateMap }) {
  const hostContextService = createHostContextService({ repository, getTargets, getCurrentStateMap });
  const activeFindings = new Map(repository.listActiveCorrelatedFindings().map((finding) => [finding.correlationKey, finding]));
  const backupPorts = [6160, 6162, 9392, 2500, 2501, 10001];

  function severityRank(severity) {
    if (severity === "critical") {
      return 3;
    }
    if (severity === "warning") {
      return 2;
    }
    return 1;
  }

  function normalizeStatus(status) {
    return status || "unknown";
  }

  function isReachableStatus(status) {
    return ["up", "degraded"].includes(normalizeStatus(status));
  }

  function isDownStatus(status) {
    return normalizeStatus(status) === "down";
  }

  function buildHostKey(context, diagnosis) {
    return diagnosis?.hostId || context.identifiers[0] || context.primaryTarget.id;
  }

  function createEvidence(source, targetId, targetName, explanation, details = {}) {
    return {
      source,
      targetId: targetId || null,
      targetName: targetName || null,
      explanation,
      details
    };
  }

  function emitEvent(eventType, severity, targetId, title, finding) {
    const createdAt = new Date().toISOString();
    repository.saveEvent({
      targetId,
      eventType,
      severity,
      message: title,
      payload: {
        correlationKey: finding.correlationKey,
        type: finding.type,
        hostKey: finding.hostKey,
        evidence: finding.evidence
      },
      createdAt
    });
    websocketHub.broadcast("event", {
      eventType,
      severity,
      targetId,
      message: title,
      payload: {
        correlationKey: finding.correlationKey,
        type: finding.type,
        hostKey: finding.hostKey,
        evidence: finding.evidence
      },
      createdAt
    });
  }

  function openOrRefreshFinding(nextFinding) {
    const now = new Date().toISOString();
    const current = activeFindings.get(nextFinding.correlationKey);
    const finding = {
      id: current?.id || crypto.randomUUID(),
      status: "active",
      firstSeenAt: current?.firstSeenAt || now,
      lastSeenAt: now,
      resolvedAt: null,
      ...nextFinding
    };

    repository.saveCorrelatedFinding(finding);
    activeFindings.set(finding.correlationKey, finding);

    const shouldEmitOpenEvent = !current
      || current.severity !== finding.severity
      || current.title !== finding.title
      || current.explanation !== finding.explanation;

    if (shouldEmitOpenEvent) {
      emitEvent("correlation_opened", finding.severity, finding.targetId, finding.title, finding);
    }

    websocketHub.broadcast("correlation_update", finding);
    return finding;
  }

  function resolveFinding(correlationKey, payload = {}) {
    const current = activeFindings.get(correlationKey);
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
    repository.saveCorrelatedFinding(resolved);
    activeFindings.delete(correlationKey);
    emitEvent("correlation_resolved", resolved.severity, resolved.targetId, resolved.title, resolved);
    websocketHub.broadcast("correlation_resolved", resolved);
    return resolved;
  }

  function evaluateThreshold(value, warning, critical) {
    if (value == null) {
      return null;
    }
    if (critical != null && value >= critical) {
      return "critical";
    }
    if (warning != null && value >= warning) {
      return "warning";
    }
    return null;
  }

  function collectCoverage(context) {
    return {
      hasDns: context.relatedBundles.some((bundle) => bundle.target.type === "dns"),
      tcpPorts: new Set(context.relatedBundles
        .filter((bundle) => bundle.target.type === "tcp")
        .map((bundle) => Number(bundle.target.port)))
    };
  }

  function evaluateHostOnlineServiceDown(context, diagnosis, findings) {
    const hostAliveBundle = context.relatedBundles.find((bundle) => ["ping", "agent"].includes(bundle.target.type) && isReachableStatus(bundle.current?.status));
    if (!hostAliveBundle) {
      return;
    }

    for (const bundle of context.relatedBundles.filter((item) => ["tcp", "http"].includes(item.target.type) && isDownStatus(item.current?.status))) {
      findings.push({
        hostKey: buildHostKey(context, diagnosis),
        targetId: bundle.target.id,
        correlationKey: `${buildHostKey(context, diagnosis)}:host_online_service_down:${bundle.target.id}`,
        type: "host_online_service_down",
        severity: "critical",
        title: `Host online, mas servico ${bundle.target.name} indisponivel`,
        explanation: `${hostAliveBundle.target.name} confirma que o host segue acessivel, mas ${bundle.target.name} retornou status down.`,
        suggestedAction: `Validar o servico relacionado ao target ${bundle.target.name} e a disponibilidade do endpoint ${bundle.target.host || bundle.target.url || "-"}.`,
        evidence: [
          createEvidence("current_state", hostAliveBundle.target.id, hostAliveBundle.target.name, "Target de disponibilidade do host permanece acessivel.", {
            status: hostAliveBundle.current?.status,
            latencyMs: hostAliveBundle.current?.latencyMs ?? null
          }),
          createEvidence("current_state", bundle.target.id, bundle.target.name, "Target de servico retornou indisponivel.", {
            status: bundle.current?.status,
            message: bundle.current?.message || null,
            endpoint: bundle.target.url || `${bundle.target.host || "-"}:${bundle.target.port || "-"}`
          })
        ],
        payload: {
          aliveTargetId: hostAliveBundle.target.id,
          serviceTargetId: bundle.target.id,
          serviceType: bundle.target.type
        }
      });
    }
  }

  function evaluateDnsFailureHostAlive(context, diagnosis, findings) {
    const hostAliveBundle = context.relatedBundles.find((bundle) => ["ping", "agent"].includes(bundle.target.type) && isReachableStatus(bundle.current?.status));
    if (!hostAliveBundle) {
      return;
    }

    for (const bundle of context.relatedBundles.filter((item) => item.target.type === "dns" && isDownStatus(item.current?.status))) {
      findings.push({
        hostKey: buildHostKey(context, diagnosis),
        targetId: bundle.target.id,
        correlationKey: `${buildHostKey(context, diagnosis)}:dns_failure_host_alive:${bundle.target.id}`,
        type: "dns_failure_host_alive",
        severity: "critical",
        title: "Servidor acessivel, mas resolucao DNS falhando",
        explanation: `${hostAliveBundle.target.name} mostra o host acessivel, enquanto ${bundle.target.name} falhou na consulta DNS configurada.`,
        suggestedAction: "Validar o servico DNS local, a porta 53 e o hostname real configurado para lookup.",
        evidence: [
          createEvidence("current_state", hostAliveBundle.target.id, hostAliveBundle.target.name, "Target de disponibilidade confirma o host ativo.", {
            status: hostAliveBundle.current?.status
          }),
          createEvidence("current_state", bundle.target.id, bundle.target.name, "Check DNS retornou falha real.", {
            status: bundle.current?.status,
            lookupHostname: bundle.target.metadata?.lookupHostname || null,
            message: bundle.current?.message || null
          })
        ],
        payload: {
          aliveTargetId: hostAliveBundle.target.id,
          dnsTargetId: bundle.target.id
        }
      });
    }
  }

  function evaluateHostUnreachable(context, diagnosis, findings) {
    const pingBundle = context.relatedBundles.find((bundle) => bundle.target.type === "ping" && isDownStatus(bundle.current?.status));
    const agentBundle = context.relatedBundles.find((bundle) => bundle.target.type === "agent" && isDownStatus(bundle.current?.status));
    if (!pingBundle || !agentBundle) {
      return;
    }

    findings.push({
      hostKey: buildHostKey(context, diagnosis),
      targetId: pingBundle.target.id,
      correlationKey: `${buildHostKey(context, diagnosis)}:host_unreachable`,
      type: "host_unreachable",
      severity: "critical",
      title: "Host indisponivel",
      explanation: `O host falhou tanto no ping (${pingBundle.target.name}) quanto no agent (${agentBundle.target.name}), indicando indisponibilidade geral ou perda de conectividade.`,
      suggestedAction: "Validar energia, rede, firewall local e disponibilidade do sistema operacional no host.",
      evidence: [
        createEvidence("current_state", pingBundle.target.id, pingBundle.target.name, "Ping retornou down.", {
          status: pingBundle.current?.status,
          message: pingBundle.current?.message || null
        }),
        createEvidence("current_state", agentBundle.target.id, agentBundle.target.name, "Agent retornou down.", {
          status: agentBundle.current?.status,
          message: agentBundle.current?.message || null
        })
      ],
      payload: {
        pingTargetId: pingBundle.target.id,
        agentTargetId: agentBundle.target.id
      }
    });
  }

  function evaluateCapacityRisk(context, diagnosis, findings) {
    const agentBundle = context.primaryAgentBundle;
    const metrics = context.primaryAgentMetrics;
    if (!agentBundle || !metrics || !isReachableStatus(agentBundle.current?.status)) {
      return;
    }

    const thresholds = agentBundle.target.thresholds || {};
    const evidence = [];
    let severity = null;

    const cpuSeverity = evaluateThreshold(metrics.cpu?.usage, thresholds.cpuUsageWarning, thresholds.cpuUsageCritical);
    if (cpuSeverity) {
      severity = severityRank(cpuSeverity) > severityRank(severity) ? cpuSeverity : severity;
      evidence.push(createEvidence("agent_metrics", agentBundle.target.id, agentBundle.target.name, "Uso de CPU acima do threshold configurado.", {
        metric: "cpuUsage",
        value: metrics.cpu?.usage,
        warning: thresholds.cpuUsageWarning,
        critical: thresholds.cpuUsageCritical
      }));
    }

    const memorySeverity = evaluateThreshold(metrics.memory?.usedPercent, thresholds.memoryUsageWarning, thresholds.memoryUsageCritical);
    if (memorySeverity) {
      severity = severityRank(memorySeverity) > severityRank(severity) ? memorySeverity : severity;
      evidence.push(createEvidence("agent_metrics", agentBundle.target.id, agentBundle.target.name, "Uso de memoria acima do threshold configurado.", {
        metric: "memoryUsedPercent",
        value: metrics.memory?.usedPercent,
        warning: thresholds.memoryUsageWarning,
        critical: thresholds.memoryUsageCritical
      }));
    }

    for (const disk of metrics.disks || []) {
      const diskSeverity = evaluateThreshold(disk.usedPercent, thresholds.diskUsageWarning, thresholds.diskUsageCritical);
      if (diskSeverity) {
        severity = severityRank(diskSeverity) > severityRank(severity) ? diskSeverity : severity;
        evidence.push(createEvidence("agent_metrics", agentBundle.target.id, agentBundle.target.name, `Particao ${disk.mount || "-"} acima do threshold configurado.`, {
          metric: "diskUsedPercent",
          mount: disk.mount || null,
          value: disk.usedPercent,
          warning: thresholds.diskUsageWarning,
          critical: thresholds.diskUsageCritical
        }));
      }
    }

    if (!evidence.length) {
      return;
    }

    findings.push({
      hostKey: buildHostKey(context, diagnosis),
      targetId: agentBundle.target.id,
      correlationKey: `${buildHostKey(context, diagnosis)}:capacity_risk`,
      type: "capacity_risk",
      severity,
      title: "Risco de capacidade no host",
      explanation: "O host segue acessivel pelo agent, mas CPU, memoria ou disco ultrapassaram thresholds reais de capacidade.",
      suggestedAction: "Revisar consumo de recursos, crescimento de volume e processos mais pesados antes que a capacidade vire indisponibilidade.",
      evidence,
      payload: {
        agentTargetId: agentBundle.target.id
      }
    });
  }

  function evaluateNetworkDegradation(context, diagnosis, findings) {
    for (const bundle of context.relatedBundles.filter((item) => ["ping", "gateway"].includes(item.target.type) && isReachableStatus(item.current?.status))) {
      const thresholds = bundle.target.thresholds || {};
      const evidence = [];
      let severity = null;

      const latencySeverity = evaluateThreshold(bundle.current?.latencyMs, thresholds.warningLatencyMs, thresholds.criticalLatencyMs);
      if (latencySeverity) {
        severity = severityRank(latencySeverity) > severityRank(severity) ? latencySeverity : severity;
        evidence.push(createEvidence("current_state", bundle.target.id, bundle.target.name, "Latencia acima do threshold configurado.", {
          metric: "latencyMs",
          value: bundle.current?.latencyMs,
          warning: thresholds.warningLatencyMs,
          critical: thresholds.criticalLatencyMs
        }));
      }

      const lossSeverity = evaluateThreshold(bundle.current?.packetLoss, thresholds.warningPacketLoss, thresholds.criticalPacketLoss);
      if (lossSeverity) {
        severity = severityRank(lossSeverity) > severityRank(severity) ? lossSeverity : severity;
        evidence.push(createEvidence("current_state", bundle.target.id, bundle.target.name, "Perda de pacotes acima do threshold configurado.", {
          metric: "packetLoss",
          value: bundle.current?.packetLoss,
          warning: thresholds.warningPacketLoss,
          critical: thresholds.criticalPacketLoss
        }));
      }

      const jitterSeverity = evaluateThreshold(bundle.current?.jitterMs, thresholds.jitterWarningMs, thresholds.jitterCriticalMs);
      if (jitterSeverity) {
        severity = severityRank(jitterSeverity) > severityRank(severity) ? jitterSeverity : severity;
        evidence.push(createEvidence("current_state", bundle.target.id, bundle.target.name, "Jitter acima do threshold configurado.", {
          metric: "jitterMs",
          value: bundle.current?.jitterMs,
          warning: thresholds.jitterWarningMs,
          critical: thresholds.jitterCriticalMs
        }));
      }

      if (!evidence.length) {
        continue;
      }

      findings.push({
        hostKey: buildHostKey(context, diagnosis),
        targetId: bundle.target.id,
        correlationKey: `${buildHostKey(context, diagnosis)}:network_degradation:${bundle.target.id}`,
        type: "network_degradation",
        severity,
        title: `${bundle.target.name} com degradacao de rede`,
        explanation: `O target ${bundle.target.name} permanece acessivel, mas latencia, perda ou jitter indicam degradacao real da rede.`,
        suggestedAction: "Validar qualidade do enlace, saturacao, filas, borda local e historico recente de latencia/perda.",
        evidence,
        payload: {
          targetType: bundle.target.type
        }
      });
    }
  }

  function evaluateBackupServiceDetectedButUnmonitored(context, diagnosis, findings) {
    const backupRole = (diagnosis.detectedRoles || []).find((role) => role.role === "backup_server");
    if (!backupRole) {
      return;
    }

    const coverage = collectCoverage(context);
    const monitoredBackupPorts = backupPorts.filter((port) => coverage.tcpPorts.has(port));
    if (monitoredBackupPorts.length) {
      return;
    }

    const listeningPorts = (context.primaryAgentMetrics?.listeningPorts || [])
      .map((entry) => Number(entry.port))
      .filter((port) => backupPorts.includes(port));

    findings.push({
      hostKey: buildHostKey(context, diagnosis),
      targetId: context.primaryTarget.id,
      correlationKey: `${buildHostKey(context, diagnosis)}:backup_service_detected_but_unmonitored`,
      type: "backup_service_detected_but_unmonitored",
      severity: "warning",
      title: "Servico de backup detectado, mas sem monitoramento dedicado",
      explanation: "O diagnostico detectou sinais reais de software de backup no host, mas nao ha target TCP correspondente para acompanhar a disponibilidade do servico.",
      suggestedAction: "Revisar o onboarding recomendado e cadastrar a porta real do servico de backup detectado para cobrir a disponibilidade operacional.",
      evidence: [
        ...backupRole.evidence.map((item) => createEvidence(item.source, context.primaryTarget.id, context.primaryTarget.name, item.explanation, {
          type: item.type,
          value: item.value,
          weight: item.weight
        })),
        createEvidence("monitoring.coverage", null, null, "Nao ha target TCP de backup configurado para este host.", {
          monitoredBackupPorts,
          detectedBackupPorts: listeningPorts
        })
      ],
      payload: {
        recommendedProfileId: backupRole.recommendedProfileId,
        detectedBackupPorts: listeningPorts
      }
    });
  }

  function evaluateFileServerDetectedButSmbUnmonitored(context, diagnosis, findings) {
    const fileRole = (diagnosis.detectedRoles || []).find((role) => role.role === "file_server");
    if (!fileRole) {
      return;
    }

    const coverage = collectCoverage(context);
    const missingPorts = [445, 139].filter((port) => !coverage.tcpPorts.has(port));
    if (!missingPorts.length) {
      return;
    }

    findings.push({
      hostKey: buildHostKey(context, diagnosis),
      targetId: context.primaryTarget.id,
      correlationKey: `${buildHostKey(context, diagnosis)}:file_server_detected_but_smb_unmonitored`,
      type: "file_server_detected_but_smb_unmonitored",
      severity: missingPorts.includes(445) ? "warning" : "info",
      title: "Servidor de arquivos detectado, mas cobertura SMB esta incompleta",
      explanation: `O host apresenta evidencias reais de servidor de arquivos, mas faltam checks TCP para as portas ${missingPorts.join(", ")}.`,
      suggestedAction: "Completar a cobertura de SMB/NetBIOS no onboarding para distinguir indisponibilidade do host de indisponibilidade do servico de arquivos.",
      evidence: [
        ...fileRole.evidence.map((item) => createEvidence(item.source, context.primaryTarget.id, context.primaryTarget.name, item.explanation, {
          type: item.type,
          value: item.value,
          weight: item.weight
        })),
        createEvidence("monitoring.coverage", null, null, "Cobertura TCP SMB/NetBIOS incompleta.", {
          missingPorts
        })
      ],
      payload: {
        recommendedProfileId: fileRole.recommendedProfileId,
        missingPorts
      }
    });
  }

  function evaluateHost(targetId) {
    const context = hostContextService.resolveRelatedBundles(targetId);
    if (!context) {
      return [];
    }

    const diagnosis = diagnosticService.getLatestDiagnosis(targetId) || diagnosticService.generateDiagnosis(targetId);
    const nextFindings = [];

    evaluateHostOnlineServiceDown(context, diagnosis, nextFindings);
    evaluateDnsFailureHostAlive(context, diagnosis, nextFindings);
    evaluateHostUnreachable(context, diagnosis, nextFindings);
    evaluateCapacityRisk(context, diagnosis, nextFindings);
    evaluateNetworkDegradation(context, diagnosis, nextFindings);
    evaluateBackupServiceDetectedButUnmonitored(context, diagnosis, nextFindings);
    evaluateFileServerDetectedButSmbUnmonitored(context, diagnosis, nextFindings);

    const hostKey = buildHostKey(context, diagnosis);
    const activeKeysForHost = repository.getCorrelatedFindingsForHost(hostKey)
      .filter((finding) => finding.status === "active")
      .map((finding) => finding.correlationKey);
    const nextKeys = new Set(nextFindings.map((finding) => finding.correlationKey));

    for (const finding of nextFindings) {
      openOrRefreshFinding(finding);
    }

    for (const correlationKey of activeKeysForHost) {
      if (!nextKeys.has(correlationKey)) {
        resolveFinding(correlationKey, { reason: "Condicao correlacionada nao se confirmou mais no estado atual." });
      }
    }

    return nextFindings;
  }

  return {
    evaluateHost,
    listActiveFindings() {
      return [...activeFindings.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
    }
  };
}

module.exports = {
  createCorrelationEngine
};

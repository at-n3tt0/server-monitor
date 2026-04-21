const { ROLE_METADATA } = require("./role-rules");

function matchesPattern(value, pattern) {
  return pattern.test(String(value || ""));
}

function buildSet(items, mapper) {
  return new Set((items || []).map((item) => mapper(item)).filter(Boolean));
}

function collectPortEvidence(context, ports, description, weight, evidence) {
  const listeningPorts = context.primaryAgentMetrics?.listeningPorts || [];
  const matches = listeningPorts.filter((item) => ports.includes(Number(item.port)));
  if (!matches.length) {
    return 0;
  }
  evidence.push({
    source: "agent.listeningPorts",
    type: "listening_port",
    value: matches.map((item) => `${item.port}/${item.protocol}`).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectProcessEvidence(context, pattern, description, weight, evidence) {
  const processes = context.primaryAgentMetrics?.relevantProcesses || context.primaryAgentMetrics?.topProcesses || [];
  const matches = processes.filter((item) => matchesPattern(`${item.name} ${item.path || ""} ${item.command || ""}`, pattern));
  if (!matches.length) {
    return 0;
  }
  evidence.push({
    source: "agent.processes",
    type: "process",
    value: matches.map((item) => item.name).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectServiceEvidence(context, pattern, description, weight, evidence) {
  const services = context.primaryAgentMetrics?.services || [];
  const matches = services.filter((item) => matchesPattern(`${item.name} ${item.displayName || ""}`, pattern));
  if (!matches.length) {
    return 0;
  }
  evidence.push({
    source: "agent.services",
    type: "service",
    value: matches.map((item) => item.displayName || item.name).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectFeatureEvidence(context, pattern, description, weight, evidence) {
  const features = context.primaryAgentMetrics?.rolesFeatures || [];
  const matches = features.filter((item) => matchesPattern(`${item.name} ${item.displayName || ""}`, pattern));
  if (!matches.length) {
    return 0;
  }
  evidence.push({
    source: "agent.rolesFeatures",
    type: "feature",
    value: matches.map((item) => item.displayName || item.name).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectPackageEvidence(context, pattern, description, weight, evidence) {
  const packages = context.primaryAgentMetrics?.packages || [];
  const matches = packages.filter((item) => matchesPattern(`${item.name} ${item.version || ""}`, pattern));
  if (!matches.length) {
    return 0;
  }
  evidence.push({
    source: "agent.packages",
    type: "package",
    value: matches.map((item) => item.name).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectTargetEvidence(context, predicate, description, weight, evidence, valueBuilder = (item) => item.target.name) {
  const matches = context.relatedBundles.filter(predicate);
  if (!matches.length) {
    return 0;
  }
  evidence.push({
    source: "monitoring.targets",
    type: "configured_check",
    value: matches.map(valueBuilder).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectShareEvidence(context, description, weight, evidence) {
  const shares = context.primaryAgentMetrics?.shares || [];
  if (!shares.length) {
    return 0;
  }
  evidence.push({
    source: "agent.shares",
    type: "share",
    value: shares.map((item) => item.name || item.raw).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectDnsResolutionEvidence(context, pattern, description, weight, evidence) {
  const matches = context.relatedBundles
    .filter((bundle) => bundle.target.type === "dns")
    .flatMap((bundle) => bundle.history.checks
      .filter((check) => check.status === "up" && pattern.test(String(check.details?.lookupHostname || "")))
      .map((check) => ({
        lookupHostname: check.details?.lookupHostname,
        targetName: bundle.target.name
      })));

  if (!matches.length) {
    return 0;
  }

  evidence.push({
    source: "check_results.dns",
    type: "dns_resolution",
    value: matches.map((item) => `${item.lookupHostname} via ${item.targetName}`).join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectIdentityEvidence(context, pattern, description, weight, evidence) {
  const fields = [
    context.primaryTarget.name,
    context.primaryTarget.host,
    context.primaryTarget.url,
    context.primaryAgentMetrics?.hostname,
    context.primaryAgentMetrics?.fqdn,
    context.primaryTarget.metadata?.notes
  ].filter(Boolean);
  const matches = fields.filter((item) => matchesPattern(item, pattern));
  if (!matches.length) {
    return 0;
  }
  evidence.push({
    source: "target.identity",
    type: "identity_hint",
    value: matches.join(", "),
    weight,
    explanation: description
  });
  return weight;
}

function collectVirtualizationEvidence(context, description, weight, evidence) {
  const virtualization = context.primaryAgentMetrics?.virtualization;
  if (!virtualization) {
    return 0;
  }
  const hints = [];
  if (virtualization.isVirtual) {
    hints.push("host marcado como virtual");
  }
  if (Array.isArray(virtualization.guestTools) && virtualization.guestTools.length) {
    hints.push(`guest tools: ${virtualization.guestTools.join(", ")}`);
  }
  if (!hints.length) {
    return 0;
  }
  evidence.push({
    source: "agent.virtualization",
    type: "virtualization",
    value: hints.join(" | "),
    weight,
    explanation: description
  });
  return weight;
}

function calculateConfidence(score, maxScore) {
  if (maxScore <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((score / maxScore) * 100));
}

function inferRoles(context) {
  const osString = `${context.primaryAgentMetrics?.platform || ""} ${context.primaryAgentMetrics?.os || ""}`.toLowerCase();
  const detected = [];

  function pushRole(roleKey, builder) {
    const metadata = ROLE_METADATA[roleKey];
    const evidence = [];
    const score = builder(evidence);
    const maxScore = evidence.reduce((sum, item) => sum + item.weight, 0);
    if (score < metadata.minimumScore || !evidence.length) {
      return;
    }
    detected.push({
      role: roleKey,
      label: metadata.label,
      category: metadata.category,
      recommendedProfileId: metadata.recommendedProfileId,
      confidence: calculateConfidence(score, Math.max(score, metadata.minimumScore + 20)),
      score,
      evidence
    });
  }

  pushRole("dns_server", (evidence) => {
    let score = 0;
    score += collectPortEvidence(context, [53], "Porta 53/TCP em escuta no host analisado", 35, evidence);
    score += collectProcessEvidence(context, /dns\.exe|named|dnsmasq|coredns|unbound|microsoft\.dns/i, "Processo compatível com serviço DNS detectado", 35, evidence);
    score += collectServiceEvidence(context, /dns|named|bind|dnsmasq|systemd-resolved/i, "Serviço DNS ativo identificado", 25, evidence);
    score += collectFeatureEvidence(context, /dns/i, "Role/feature DNS instalada", 35, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "dns", "Já existe check DNS configurado para o host", 35, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "tcp" && Number(bundle.target.port) === 53, "Já existe check TCP 53 configurado para o host", 15, evidence);
    return score;
  });

  pushRole("file_server", (evidence) => {
    let score = 0;
    score += collectPortEvidence(context, [445, 139], "Porta SMB ou NetBIOS em escuta", 30, evidence);
    score += collectProcessEvidence(context, /smbd|ksmbd|nmbd|system|fileserver/i, "Processo compatível com compartilhamento de arquivos", 20, evidence);
    score += collectServiceEvidence(context, /lanmanserver|server|smb|samba/i, "Serviço de compartilhamento ativo detectado", 20, evidence);
    score += collectShareEvidence(context, "Compartilhamentos exportados detectados pelo agente", 35, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "tcp" && [139, 445].includes(Number(bundle.target.port)), "Checks SMB/NetBIOS já configurados para o host", 15, evidence);
    return score;
  });

  pushRole("active_directory", (evidence) => {
    let score = 0;
    score += collectFeatureEvidence(context, /active directory|ad-domain-services|domain services|domain-controller|adws|netlogon/i, "Role ou feature compatível com Active Directory detectada", 40, evidence);
    score += collectServiceEvidence(context, /adws|ntds|netlogon|kdc|active directory/i, "Serviços compatíveis com Active Directory encontrados", 30, evidence);
    score += collectPortEvidence(context, [53, 88, 135, 389, 445, 636, 3268], "Conjunto de portas típico de Active Directory observado", 20, evidence);
    score += collectDnsResolutionEvidence(context, /_msdcs\./i, "Resolução real de _msdcs observada nos checks DNS do host", 35, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "dns", "Host já possui check DNS associado", 10, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "tcp" && [53, 88, 135, 389, 445, 636, 3268].includes(Number(bundle.target.port)), "Conjunto de checks TCP alinhado ao papel de Active Directory", 15, evidence);
    return score;
  });

  pushRole("web_server", (evidence) => {
    let score = 0;
    score += collectPortEvidence(context, [80, 443], "Portas HTTP/HTTPS em escuta", 25, evidence);
    score += collectProcessEvidence(context, /nginx|apache|httpd|w3wp|iis/i, "Processo web compatível detectado", 30, evidence);
    score += collectServiceEvidence(context, /nginx|apache|httpd|iis|w3svc/i, "Serviço web ativo identificado", 20, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "http", "Check HTTP/HTTPS já configurado para o host", 35, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "tcp" && [80, 443].includes(Number(bundle.target.port)), "Checks TCP 80/443 já configurados para o host", 15, evidence);
    return score;
  });

  pushRole("application_server", (evidence) => {
    let score = 0;
    score += collectPortEvidence(context, [8080, 8081, 8000, 8443, 9000], "Porta típica de middleware ou aplicação em escuta", 15, evidence);
    score += collectProcessEvidence(context, /tomcat|jboss|wildfly|weblogic|java|dotnet|node|pm2|gunicorn/i, "Processo compatível com servidor de aplicação detectado", 30, evidence);
    score += collectServiceEvidence(context, /tomcat|jboss|wildfly|weblogic|pm2|node/i, "Serviço compatível com camada de aplicação identificado", 20, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "tcp" && [8080, 8081, 8000, 8443, 9000].includes(Number(bundle.target.port)), "Check TCP de porta típica de aplicação já configurado", 15, evidence);
    return score;
  });

  pushRole("database_server", (evidence) => {
    let score = 0;
    score += collectPortEvidence(context, [1433, 1521, 3306, 5432, 27017, 6379], "Porta típica de banco de dados em escuta", 25, evidence);
    score += collectProcessEvidence(context, /sqlservr|postgres|postmaster|mysqld|mariadbd|oracle|tnslsnr|mongod|redis-server/i, "Processo de banco de dados detectado", 35, evidence);
    score += collectServiceEvidence(context, /sql|postgres|mysql|mariadb|oracle|mongodb|redis/i, "Serviço de banco ativo identificado", 20, evidence);
    score += collectPackageEvidence(context, /postgres|mysql|mariadb|mongodb|redis|oracle/i, "Pacote relevante de banco instalado", 15, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "tcp" && [1433, 1521, 3306, 5432, 27017, 6379].includes(Number(bundle.target.port)), "Check TCP de banco já configurado para o host", 15, evidence);
    return score;
  });

  pushRole("virtualization_host", (evidence) => {
    let score = 0;
    score += collectProcessEvidence(context, /vmms|vmcompute|libvirtd|qemu-system|vboxheadless|vmware-hostd/i, "Processo compatível com host de virtualização detectado", 35, evidence);
    score += collectServiceEvidence(context, /hyper-v|vmms|libvirt|vmware/i, "Serviço compatível com virtualização ativo", 25, evidence);
    score += collectVirtualizationEvidence(context, "Sinais de virtualização ou guest tools detectados", 10, evidence);
    return score;
  });

  pushRole("proxy_server", (evidence) => {
    let score = 0;
    score += collectPortEvidence(context, [3128, 8080], "Porta típica de proxy em escuta", 20, evidence);
    score += collectProcessEvidence(context, /squid|haproxy|envoy/i, "Processo de proxy detectado", 35, evidence);
    score += collectServiceEvidence(context, /squid|haproxy|envoy/i, "Serviço proxy ativo identificado", 25, evidence);
    return score;
  });

  pushRole("print_server", (evidence) => {
    let score = 0;
    score += collectPortEvidence(context, [631], "Porta IPP/CUPS em escuta", 15, evidence);
    score += collectProcessEvidence(context, /spoolsv\.exe|spoolsv|cupsd/i, "Processo de impressão detectado", 45, evidence);
    score += collectServiceEvidence(context, /spooler|cups/i, "Serviço de impressão ativo identificado", 25, evidence);
    return score;
  });

  pushRole("backup_server", (evidence) => {
    let score = 0;
    score += collectProcessEvidence(context, /veeam/i, "Processos Veeam detectados no host", 45, evidence);
    score += collectProcessEvidence(context, /bacula|urbackup|rubrik|restic/i, "Processo compatível com backup detectado", 25, evidence);
    score += collectServiceEvidence(context, /veeam|bacula|urbackup/i, "Serviço de backup ativo identificado", 25, evidence);
    score += collectPackageEvidence(context, /veeam|bacula|urbackup|restic/i, "Pacote de backup encontrado no host", 20, evidence);
    return score;
  });

  if (osString.includes("windows")) {
    pushRole("windows_host", (evidence) => {
      evidence.push({
        source: "agent.os",
        type: "os",
        value: context.primaryAgentMetrics?.os || "windows",
        weight: 30,
        explanation: "Sistema operacional Windows reportado pelo agente"
      });
      return 30;
    });
  }

  if (osString.includes("linux")) {
    pushRole("linux_host", (evidence) => {
      evidence.push({
        source: "agent.os",
        type: "os",
        value: context.primaryAgentMetrics?.os || "linux",
        weight: 30,
        explanation: "Sistema operacional Linux reportado pelo agente"
      });
      return 30;
    });
  }

  pushRole("gateway", (evidence) => {
    let score = 0;
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "gateway", "Target do tipo gateway configurado para este host", 35, evidence);
    score += collectIdentityEvidence(context, /gateway|gw|borda/i, "Nome ou metadado do target sugere papel de gateway", 10, evidence);
    return score;
  });

  pushRole("firewall", (evidence) => {
    let score = 0;
    score += collectIdentityEvidence(context, /firewall|pfsense|opnsense|fortigate|checkpoint|sonicwall/i, "Nome ou metadado sugere dispositivo firewall", 25, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "gateway", "Comportamento monitorado como borda/gateway", 15, evidence);
    return score;
  });

  pushRole("router", (evidence) => {
    let score = 0;
    score += collectIdentityEvidence(context, /router|roteador|edge/i, "Nome ou metadado sugere roteador", 25, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "gateway", "Target do tipo gateway associado", 15, evidence);
    return score;
  });

  pushRole("mikrotik", (evidence) => {
    let score = 0;
    score += collectIdentityEvidence(context, /mikrotik|routeros/i, "Nome ou metadado indica Mikrotik/RouterOS", 25, evidence);
    score += collectTargetEvidence(context, (bundle) => bundle.target.type === "tcp" && Number(bundle.target.port) === 8291, "Check TCP 8291 de WinBox já configurado", 15, evidence);
    return score;
  });

  pushRole("switch", (evidence) => collectIdentityEvidence(context, /switch|core-sw|access-sw/i, "Nome ou metadado sugere switch", 35, evidence));
  pushRole("access_point", (evidence) => collectIdentityEvidence(context, /access point|ap-|wifi|wireless|unifi/i, "Nome ou metadado sugere access point", 35, evidence));

  return detected.sort((left, right) => right.score - left.score);
}

function summarizeAvailableSignals(context) {
  return {
    hasAgentMetrics: Boolean(context.primaryAgentMetrics),
    hasServices: Array.isArray(context.primaryAgentMetrics?.services) && context.primaryAgentMetrics.services.length > 0,
    hasListeningPorts: Array.isArray(context.primaryAgentMetrics?.listeningPorts) && context.primaryAgentMetrics.listeningPorts.length > 0,
    hasProcesses: Array.isArray(context.primaryAgentMetrics?.relevantProcesses) && context.primaryAgentMetrics.relevantProcesses.length > 0,
    hasShares: Array.isArray(context.primaryAgentMetrics?.shares) && context.primaryAgentMetrics.shares.length > 0,
    hasRolesFeatures: Array.isArray(context.primaryAgentMetrics?.rolesFeatures) && context.primaryAgentMetrics.rolesFeatures.length > 0,
    hasPackages: Array.isArray(context.primaryAgentMetrics?.packages) && context.primaryAgentMetrics.packages.length > 0
  };
}

module.exports = {
  inferRoles,
  summarizeAvailableSignals
};

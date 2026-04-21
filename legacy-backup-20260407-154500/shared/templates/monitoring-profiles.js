const { createDefaultThresholds } = require("../schemas/target-schema");

function withThresholds(type, overrides = {}) {
  return {
    ...createDefaultThresholds(type),
    ...overrides
  };
}

const MONITORING_PROFILES = [
  {
    id: "file-server",
    name: "Servidor de Arquivos",
    category: "server",
    description: "Perfil para servidores SMB/CIFS com agente e portas tipicas de compartilhamento.",
    observations: [
      "Utiliza checks reais suportados hoje: ping, agent e tcp.",
      "Aplica thresholds focados em CPU, RAM e disco."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping", { warningLatencyMs: 120, criticalLatencyMs: 250 }) },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent", { cpuUsageWarning: 80, cpuUsageCritical: 90, memoryUsageWarning: 80, memoryUsageCritical: 90, diskUsageWarning: 85, diskUsageCritical: 92 }) },
      { key: "smb-445", nameSuffix: "SMB 445", type: "tcp", hostSource: "host", port: 445, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp", { warningLatencyMs: 150, criticalLatencyMs: 400 }) },
      { key: "netbios-139", nameSuffix: "NetBIOS 139", type: "tcp", hostSource: "host", port: 139, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp", { warningLatencyMs: 150, criticalLatencyMs: 400 }) }
    ]
  },
  {
    id: "dns-server",
    name: "Servidor DNS",
    category: "server",
    description: "Perfil para servidores DNS com validacao de resolucao, conectividade e agente.",
    observations: [
      "Lookup DNS e editavel antes do save.",
      "Usa apenas checks reais ja suportados."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping", { warningLatencyMs: 100, criticalLatencyMs: 220 }) },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent") },
      { key: "dns", nameSuffix: "DNS", type: "dns", hostSource: "host", timeout: 4000, intervalSeconds: 30, metadata: { lookupHostnameSource: "lookupHostname" }, thresholds: withThresholds("dns", { warningLatencyMs: 120, criticalLatencyMs: 300 }) },
      { key: "tcp-53", nameSuffix: "TCP 53", type: "tcp", hostSource: "host", port: 53, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp", { warningLatencyMs: 120, criticalLatencyMs: 320 }) }
    ]
  },
  {
    id: "domain-controller",
    name: "Controlador de Dominio / AD",
    category: "server",
    description: "Perfil para Active Directory com portas de autenticacao, LDAP e catalogo global.",
    observations: [
      "Checks de DNS e portas padrao do AD.",
      "Ajuste URLs e agente conforme o host real."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent", { cpuUsageWarning: 75, cpuUsageCritical: 90 }) },
      { key: "dns", nameSuffix: "DNS", type: "dns", hostSource: "host", timeout: 4000, intervalSeconds: 30, metadata: { lookupHostnameSource: "lookupHostname" }, thresholds: withThresholds("dns") },
      { key: "tcp-53", nameSuffix: "TCP 53", type: "tcp", hostSource: "host", port: 53, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-88", nameSuffix: "TCP 88", type: "tcp", hostSource: "host", port: 88, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-135", nameSuffix: "TCP 135", type: "tcp", hostSource: "host", port: 135, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-389", nameSuffix: "TCP 389", type: "tcp", hostSource: "host", port: 389, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-445", nameSuffix: "TCP 445", type: "tcp", hostSource: "host", port: 445, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-636", nameSuffix: "TCP 636", type: "tcp", hostSource: "host", port: 636, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-3268", nameSuffix: "TCP 3268", type: "tcp", hostSource: "host", port: 3268, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") }
    ]
  },
  {
    id: "web-server",
    name: "Servidor Web",
    category: "server",
    description: "Perfil para servidores HTTP/HTTPS com verficacao web, portas e agente.",
    observations: [
      "Configure a URL base do servico web.",
      "Checks http, tcp e agent sao editaveis antes e depois."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "http", nameSuffix: "HTTP", type: "http", urlSource: "baseUrl", timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("http", { warningLatencyMs: 1200, criticalLatencyMs: 2500 }) },
      { key: "tcp-80", nameSuffix: "TCP 80", type: "tcp", hostSource: "host", port: 80, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-443", nameSuffix: "TCP 443", type: "tcp", hostSource: "host", port: 443, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent") }
    ]
  },
  {
    id: "database-server",
    name: "Servidor de Banco de Dados",
    category: "server",
    description: "Perfil para bancos com ping, agente e porta TCP configuravel conforme a engine.",
    observations: [
      "A porta do banco pode ser alterada antes do save.",
      "Nao implementa queries SQL, apenas checks reais suportados."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent", { diskUsageWarning: 80, diskUsageCritical: 90 }) },
      { key: "db-port", nameSuffix: "Porta Banco", type: "tcp", hostSource: "host", portSource: "databasePort", defaultPort: 5432, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp", { warningLatencyMs: 200, criticalLatencyMs: 500 }) }
    ]
  },
  {
    id: "print-server",
    name: "Servidor de Impressao",
    category: "server",
    description: "Perfil para servidores de impressao com agente, conectividade e porta de spool quando houver evidencia real.",
    observations: [
      "Nao inventa porta de impressao: o check TCP adicional so aparece quando o host expor uma porta real detectada.",
      "Mantem foco em disponibilidade do host e coleta detalhada pelo agente."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent") },
      { key: "print-port", nameSuffix: "Porta Spool", type: "tcp", hostSource: "host", portSource: "printPort", timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp"), enabledWhenContext: "printPort" }
    ]
  },
  {
    id: "backup-server",
    name: "Servidor de Backup",
    category: "server",
    description: "Perfil para servidores de backup com agente, conectividade e porta do servico quando houver evidencia tecnica real.",
    observations: [
      "A porta de backup so e sugerida quando detectada por processos ou portas em escuta.",
      "Nao cria checks ficticios para softwares de backup ainda nao suportados nativamente."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent", { diskUsageWarning: 80, diskUsageCritical: 90 }) },
      { key: "backup-port", nameSuffix: "Porta Backup", type: "tcp", hostSource: "host", portSource: "backupPort", timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp"), enabledWhenContext: "backupPort" }
    ]
  },
  {
    id: "linux-server",
    name: "Servidor Linux",
    category: "server",
    description: "Perfil basico para servidores Linux com conectividade e coleta via agente.",
    observations: [
      "Foco em health operacional por ping e agent."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent") }
    ]
  },
  {
    id: "windows-server",
    name: "Servidor Windows",
    category: "server",
    description: "Perfil basico para Windows com conectividade, agente e RDP padrao.",
    observations: [
      "Inclui TCP 3389 como check real opcional e editavel."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent") },
      { key: "tcp-3389", nameSuffix: "TCP 3389", type: "tcp", hostSource: "host", port: 3389, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") }
    ]
  },
  {
    id: "application-server",
    name: "Servidor de Aplicacao",
    category: "server",
    description: "Perfil para middleware e servicos de aplicacao com ping, porta configuravel e agente.",
    observations: [
      "A porta da aplicacao e configuravel no formulario do perfil."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "app-port", nameSuffix: "Porta App", type: "tcp", hostSource: "host", portSource: "applicationPort", defaultPort: 8080, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent") }
    ]
  },
  {
    id: "virtualization-host",
    name: "Host de Virtualizacao",
    category: "server",
    description: "Perfil para hypervisors e hosts de virtualizacao com checks basicos e agente.",
    observations: [
      "Porta 443 pode ser mantida ou removida antes do save."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping") },
      { key: "agent", nameSuffix: "Agent", type: "agent", urlSource: "agentUrl", secretSource: "agentSecret", timeout: 10000, intervalSeconds: 30, thresholds: withThresholds("agent", { cpuUsageWarning: 85, cpuUsageCritical: 95, memoryUsageWarning: 85, memoryUsageCritical: 95 }) },
      { key: "tcp-443", nameSuffix: "TCP 443", type: "tcp", hostSource: "host", port: 443, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") }
    ]
  },
  {
    id: "gateway",
    name: "Gateway",
    category: "network",
    description: "Perfil para gateways com checks de ping e check dedicado de gateway.",
    observations: [
      "Foca em latencia, jitter e perda de pacotes."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 2000, intervalSeconds: 20, thresholds: withThresholds("ping", { warningLatencyMs: 20, criticalLatencyMs: 80, warningPacketLoss: 5, criticalPacketLoss: 20 }) },
      { key: "gateway", nameSuffix: "Gateway", type: "gateway", hostSource: "host", timeout: 2000, intervalSeconds: 20, thresholds: withThresholds("gateway", { warningLatencyMs: 20, criticalLatencyMs: 80, warningPacketLoss: 5, criticalPacketLoss: 20 }) }
    ]
  },
  {
    id: "internet-link",
    name: "Link de Internet",
    category: "network",
    description: "Perfil para validacao de link com gateway local, ping externo e DNS.",
    observations: [
      "Nao simula throughput; usa apenas checks reais ja suportados.",
      "Host externo e DNS podem ser alterados antes do save."
    ],
    targetTemplates: [
      { key: "gateway", nameSuffix: "Gateway", type: "gateway", hostSource: "gatewayHost", timeout: 2000, intervalSeconds: 20, thresholds: withThresholds("gateway", { warningLatencyMs: 20, criticalLatencyMs: 80, warningPacketLoss: 5, criticalPacketLoss: 20 }) },
      { key: "internet-ping", nameSuffix: "Ping Externo", type: "ping", hostSource: "externalHost", defaultHost: "8.8.8.8", timeout: 3000, intervalSeconds: 30, thresholds: withThresholds("ping", { warningLatencyMs: 120, criticalLatencyMs: 250, warningPacketLoss: 10, criticalPacketLoss: 30 }) },
      { key: "dns", nameSuffix: "DNS", type: "dns", hostSource: "dnsServerHost", defaultHost: "1.1.1.1", timeout: 4000, intervalSeconds: 30, metadata: { lookupHostnameSource: "lookupHostname" }, thresholds: withThresholds("dns", { warningLatencyMs: 150, criticalLatencyMs: 400 }) }
    ]
  },
  {
    id: "mikrotik",
    name: "Mikrotik",
    category: "network",
    description: "Perfil para Mikrotik com checks atualmente suportados e preparado para futura camada SNMP.",
    observations: [
      "SNMP ainda nao existe nesta fase.",
      "Hoje aplica ping e portas de acesso de gerenciamento."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 2000, intervalSeconds: 20, thresholds: withThresholds("ping", { warningLatencyMs: 30, criticalLatencyMs: 100 }) },
      { key: "tcp-8291", nameSuffix: "WinBox 8291", type: "tcp", hostSource: "host", port: 8291, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-80", nameSuffix: "HTTP 80", type: "tcp", hostSource: "host", port: 80, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-443", nameSuffix: "HTTPS 443", type: "tcp", hostSource: "host", port: 443, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") }
    ]
  },
  {
    id: "switch",
    name: "Switch",
    category: "network",
    description: "Perfil para switches com checks basicos de conectividade e gerenciamento web.",
    observations: [
      "Preparado para futura expansao SNMP, sem fingir SNMP agora."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 2000, intervalSeconds: 20, thresholds: withThresholds("ping", { warningLatencyMs: 10, criticalLatencyMs: 40 }) },
      { key: "tcp-80", nameSuffix: "HTTP 80", type: "tcp", hostSource: "host", port: 80, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-443", nameSuffix: "HTTPS 443", type: "tcp", hostSource: "host", port: 443, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") }
    ]
  },
  {
    id: "firewall",
    name: "Firewall",
    category: "network",
    description: "Perfil para firewalls com checks de conectividade e acesso de gerenciamento real suportado hoje.",
    observations: [
      "Preparado para futura expansao SNMP, sem SNMP nesta fase."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 2000, intervalSeconds: 20, thresholds: withThresholds("ping", { warningLatencyMs: 20, criticalLatencyMs: 80 }) },
      { key: "tcp-443", nameSuffix: "HTTPS 443", type: "tcp", hostSource: "host", port: 443, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-80", nameSuffix: "HTTP 80", type: "tcp", hostSource: "host", port: 80, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") }
    ]
  },
  {
    id: "access-point",
    name: "Access Point",
    category: "network",
    description: "Perfil para access points com ping e verificacao de console web quando existente.",
    observations: [
      "Preparado para fase futura de telemetria via SNMP."
    ],
    targetTemplates: [
      { key: "ping", nameSuffix: "Ping", type: "ping", hostSource: "host", timeout: 2000, intervalSeconds: 20, thresholds: withThresholds("ping", { warningLatencyMs: 15, criticalLatencyMs: 60 }) },
      { key: "tcp-80", nameSuffix: "HTTP 80", type: "tcp", hostSource: "host", port: 80, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") },
      { key: "tcp-443", nameSuffix: "HTTPS 443", type: "tcp", hostSource: "host", port: 443, timeout: 5000, intervalSeconds: 30, thresholds: withThresholds("tcp") }
    ]
  }
];

function serializeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    category: profile.category,
    description: profile.description,
    observations: profile.observations,
    targetTemplates: profile.targetTemplates.map((template) => ({
      key: template.key,
      nameSuffix: template.nameSuffix,
      type: template.type,
      port: template.port || null,
      defaultPort: template.defaultPort || null,
      hostSource: template.hostSource || null,
      defaultHost: template.defaultHost || null,
      urlSource: template.urlSource || null,
      secretSource: template.secretSource || null,
      portSource: template.portSource || null,
      enabledWhenContext: template.enabledWhenContext || null,
      timeout: template.timeout,
      intervalSeconds: template.intervalSeconds,
      metadata: template.metadata || {},
      thresholds: template.thresholds || {}
    }))
  };
}

function listMonitoringProfiles() {
  return MONITORING_PROFILES.map(serializeProfile);
}

function findMonitoringProfile(profileId) {
  return MONITORING_PROFILES.find((profile) => profile.id === profileId) || null;
}

function materializeMonitoringProfile(profileOrId, context = {}) {
  const profile = typeof profileOrId === "string" ? findMonitoringProfile(profileOrId) : profileOrId;
  if (!profile) {
    return null;
  }

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

module.exports = {
  MONITORING_PROFILES,
  listMonitoringProfiles,
  findMonitoringProfile,
  materializeMonitoringProfile
};

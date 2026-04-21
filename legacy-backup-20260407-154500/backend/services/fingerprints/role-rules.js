const ROLE_METADATA = {
  file_server: {
    label: "Servidor de Arquivos",
    category: "server",
    recommendedProfileId: "file-server",
    minimumScore: 55
  },
  dns_server: {
    label: "Servidor DNS",
    category: "server",
    recommendedProfileId: "dns-server",
    minimumScore: 35
  },
  active_directory: {
    label: "Active Directory / Controlador de Dominio",
    category: "server",
    recommendedProfileId: "domain-controller",
    minimumScore: 55
  },
  web_server: {
    label: "Servidor Web",
    category: "server",
    recommendedProfileId: "web-server",
    minimumScore: 35
  },
  application_server: {
    label: "Servidor de Aplicacao",
    category: "server",
    recommendedProfileId: "application-server",
    minimumScore: 45
  },
  database_server: {
    label: "Servidor de Banco de Dados",
    category: "server",
    recommendedProfileId: "database-server",
    minimumScore: 55
  },
  linux_host: {
    label: "Host Linux Generico",
    category: "server",
    recommendedProfileId: "linux-server",
    minimumScore: 20
  },
  windows_host: {
    label: "Host Windows Generico",
    category: "server",
    recommendedProfileId: "windows-server",
    minimumScore: 20
  },
  virtualization_host: {
    label: "Host de Virtualizacao",
    category: "server",
    recommendedProfileId: "virtualization-host",
    minimumScore: 45
  },
  proxy_server: {
    label: "Servidor Proxy",
    category: "server",
    recommendedProfileId: "application-server",
    minimumScore: 55
  },
  print_server: {
    label: "Servidor de Impressao",
    category: "server",
    recommendedProfileId: "print-server",
    minimumScore: 45
  },
  backup_server: {
    label: "Servidor de Backup",
    category: "server",
    recommendedProfileId: "backup-server",
    minimumScore: 45
  },
  gateway: {
    label: "Gateway",
    category: "network",
    recommendedProfileId: "gateway",
    minimumScore: 35
  },
  firewall: {
    label: "Firewall",
    category: "network",
    recommendedProfileId: "firewall",
    minimumScore: 35
  },
  router: {
    label: "Roteador",
    category: "network",
    recommendedProfileId: "gateway",
    minimumScore: 35
  },
  mikrotik: {
    label: "Mikrotik",
    category: "network",
    recommendedProfileId: "mikrotik",
    minimumScore: 40
  },
  switch: {
    label: "Switch",
    category: "network",
    recommendedProfileId: "switch",
    minimumScore: 35
  },
  access_point: {
    label: "Access Point",
    category: "network",
    recommendedProfileId: "access-point",
    minimumScore: 35
  }
};

module.exports = {
  ROLE_METADATA
};

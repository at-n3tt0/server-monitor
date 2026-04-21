from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from backend.app.models.alert import Alert
from backend.app.models.host import Host
from backend.app.models.metric import CpuMetric, DiskMetric, HostStatusMetric, LatencyMetric, MemoryMetric, NetworkMetric
from backend.app.models.monitoring import (
    AlertRule,
    CollectorBinding,
    HostCapability,
    HostCredentialBinding,
    HostCollectionState,
    MonitoringProfile,
    ServiceCheck,
    ServiceCheckResult,
)
from backend.app.repositories.host_repository import HostRepository
from backend.app.repositories.monitoring_repository import MonitoringRepository
from backend.app.utils.time import utcnow


class OperationalSeedService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.host_repository = HostRepository(db)
        self.monitoring_repository = MonitoringRepository(db)

    def seed_profiles_and_hosts(self) -> None:
        self._seed_profiles()
        self._cleanup_non_operational_hosts()
        self._seed_hosts()

    def _seed_profiles(self) -> None:
        profiles = [
            MonitoringProfile(
                id="proxmox",
                name="proxmox",
                collector_type="proxmox_api",
                description="Hipervisor Proxmox com API preferencial e fallback SSH seguro.",
                polling_policy={"host": 30, "service": 30, "storage": 60, "vm": 30},
                expected_services=[
                    {"service_key": "proxmox_api", "check_type": "integration"},
                    {"service_key": "ssh", "check_type": "tcp", "port": 22},
                    {"service_key": "web_ui", "check_type": "tcp", "port": 8006},
                ],
                default_alert_rules=[
                    {"rule_key": "host_offline", "metric_key": "availability_percent", "critical_threshold": 0},
                    {"rule_key": "cpu_high", "metric_key": "cpu_percent", "warning_threshold": 80, "critical_threshold": 90},
                    {"rule_key": "memory_high", "metric_key": "memory_percent", "warning_threshold": 80, "critical_threshold": 90},
                ],
                default_capabilities=["vms", "storage", "swap", "smart", "load_average"],
            ),
            MonitoringProfile(
                id="windows_dc",
                name="windows_dc",
                collector_type="windows_agent",
                description="Controlador de domínio Windows com foco em AD, DNS e serviços críticos.",
                polling_policy={"host": 30, "service": 30, "events": 120, "patching": 3600},
                expected_services=[
                    {"service_key": "dns_tcp", "check_type": "tcp", "port": 53},
                    {"service_key": "kerberos", "check_type": "tcp", "port": 88},
                    {"service_key": "ldap", "check_type": "tcp", "port": 389},
                    {"service_key": "smb", "check_type": "tcp", "port": 445},
                ],
                default_alert_rules=[
                    {"rule_key": "service_critical_down", "metric_key": "service_state"},
                    {"rule_key": "disk_low", "metric_key": "disk_percent", "warning_threshold": 85, "critical_threshold": 95},
                ],
                default_capabilities=["ad_ds", "dns", "netlogon", "kdc", "dfsr", "patching", "windows_events"],
            ),
            MonitoringProfile(
                id="windows_file_server",
                name="windows_file_server",
                collector_type="windows_agent",
                description="Servidor de arquivos Windows com foco em volumes, SMB e eventos de storage.",
                polling_policy={"host": 30, "service": 30, "storage": 60},
                expected_services=[
                    {"service_key": "smb", "check_type": "tcp", "port": 445},
                    {"service_key": "rdp", "check_type": "tcp", "port": 3389},
                ],
                default_alert_rules=[
                    {"rule_key": "volume_low", "metric_key": "disk_percent", "warning_threshold": 80, "critical_threshold": 90},
                ],
                default_capabilities=["shares", "ntfs_events", "smb_events", "disk_growth"],
            ),
            MonitoringProfile(
                id="windows_legacy_app",
                name="windows_legacy_app",
                collector_type="windows_agent",
                description="Servidor Windows de aplicações legadas com foco em serviços e portas críticas.",
                polling_policy={"host": 30, "service": 30, "patching": 3600},
                expected_services=[
                    {"service_key": "oracle_listener", "check_type": "tcp", "port": 1521},
                    {"service_key": "firebird", "check_type": "tcp", "port": 3050},
                    {"service_key": "veeam_transport", "check_type": "tcp", "port": 6160},
                    {"service_key": "hyperv_vmms", "check_type": "tcp", "port": 2179},
                ],
                default_alert_rules=[
                    {"rule_key": "oracle_down", "metric_key": "service_state"},
                    {"rule_key": "firebird_down", "metric_key": "service_state"},
                ],
                default_capabilities=["oracle", "firebird", "veeam", "hyperv", "legacy_apps"],
            ),
            MonitoringProfile(
                id="linux_app",
                name="linux_app",
                collector_type="linux_agent",
                description="Servidor Linux de aplicação com host metrics, serviços e healthcheck web.",
                polling_policy={"host": 30, "service": 30, "backup": 3600, "http": 30},
                expected_services=[
                    {"service_key": "ssh", "check_type": "tcp", "port": 22},
                    {"service_key": "http", "check_type": "http", "target": "http://192.168.2.189/login"},
                ],
                default_alert_rules=[
                    {"rule_key": "http_health_failed", "metric_key": "http"},
                    {"rule_key": "backup_failed", "metric_key": "backup_status"},
                ],
                default_capabilities=["nginx", "php_fpm", "mysql", "ufw", "fail2ban", "backup_status", "load_average", "swap"],
            ),
            MonitoringProfile(
                id="mikrotik_router",
                name="mikrotik_router",
                collector_type="ping",
                description="Roteador MikroTik/RouterOS com monitoramento passivo e integracao profunda pendente de gerencia segura.",
                polling_policy={"host": 30, "service": 30, "dns": 60},
                expected_services=[
                    {"service_key": "dns_tcp", "check_type": "tcp", "port": 53},
                    {"service_key": "bandwidth_test", "check_type": "tcp", "port": 2000},
                ],
                default_alert_rules=[
                    {"rule_key": "host_offline", "metric_key": "availability_percent", "critical_threshold": 0},
                    {"rule_key": "latency_high", "metric_key": "latency_ms", "warning_threshold": 20, "critical_threshold": 80},
                    {"rule_key": "dns_service_down", "metric_key": "service_state"},
                ],
                default_capabilities=["routing", "firewall", "nat", "dns", "dhcp", "queues", "vpn", "routeros_inventory"],
            ),
        ]

        for profile in profiles:
            self.monitoring_repository.upsert_profile(profile)

    def _seed_hosts(self) -> None:
        host_definitions = self._host_definitions()
        for host_data in host_definitions:
            existing = self.host_repository.get(host_data["id"])
            payload = {
                key: value
                for key, value in host_data.items()
                if key not in {"credentials", "capabilities", "collectors", "service_checks", "alert_rules"}
            }
            if existing:
                host = self.host_repository.update(existing, payload)
            else:
                host = self.host_repository.create(**payload)
            self.monitoring_repository.replace_host_credentials(host.id, host_data["credentials"])
            self.monitoring_repository.replace_host_capabilities(host.id, host_data["capabilities"])
            self.monitoring_repository.replace_host_collectors(host.id, host_data["collectors"])
            self.monitoring_repository.replace_host_service_checks(host.id, host_data["service_checks"])
            self.monitoring_repository.replace_alert_rules(host.id, host_data["alert_rules"])

    def _cleanup_non_operational_hosts(self) -> None:
        managed_ids = {host_definition["id"] for host_definition in self._host_definitions()}
        existing_ids = {host.id for host in self.host_repository.list()}
        obsolete_ids = sorted(existing_ids - managed_ids)
        if not obsolete_ids:
            return

        for model in [
            CpuMetric,
            MemoryMetric,
            DiskMetric,
            NetworkMetric,
            LatencyMetric,
            HostStatusMetric,
            Alert,
            ServiceCheckResult,
            ServiceCheck,
            CollectorBinding,
            HostCredentialBinding,
            HostCapability,
            AlertRule,
            HostCollectionState,
        ]:
            self.db.execute(delete(model).where(model.host_id.in_(obsolete_ids)))

        self.db.execute(delete(Host).where(Host.id.in_(obsolete_ids)))
        self.db.commit()

    def _host_definitions(self) -> list[dict]:
        now = utcnow()
        return [
            {
                "id": "ccr",
                "name": "CCR",
                "hostname": "mikrotik-ccr",
                "address": "192.168.2.1",
                "role": "edge_router",
                "criticality": "critical",
                "operating_system": "MikroTik RouterOS (modelo exato pendente de gerencia)",
                "profile_id": "mikrotik_router",
                "monitor_type": "ping",
                "collector_type": "ssh_routeros",
                "agent_endpoint": None,
                "agent_token": None,
                "tcp_port": 53,
                "interval_seconds": 30,
                "timeout_ms": 5000,
                "is_active": True,
                "description": "Gateway principal MikroTik identificado pelo usuario como CCR. Gerencia remota fechada a partir do servidor de monitoramento durante a auditoria.",
                "details": {
                    "audit_date": "2026-04-07",
                    "device_class": "router",
                    "management_status": "blocked_from_monitoring_host",
                    "passive_findings": {
                        "icmp": "reachable",
                        "open_tcp_ports": [53, 2000, 2020],
                        "closed_management_ports": [22, 80, 443, 8291, 8728, 8729],
                    },
                    "audit_notes": [
                        "Porta 53/TCP aberta e funcional para o segmento local.",
                        "Porta 2000/TCP aberta, compativel com servico de bandwidth-test do RouterOS; revisar necessidade.",
                        "Porta 2020/TCP aberta e confirmada pelo usuario como WinBox em porta customizada.",
                        "Nao foi possivel validar modelo, versao RouterOS, usuarios, firewall e NAT por falta de um canal de gerencia compativel acessivel.",
                    ],
                },
                "tags": ["mikrotik", "router", "ccr", "gateway", "edge", "critical"],
                "expected_services": ["dns_tcp", "bandwidth_test", "winbox_custom"],
                "integration_status": "integration_pending",
                "last_status": "unknown",
                "created_at": now,
                "updated_at": now,
                "credentials": [
                    HostCredentialBinding(
                        host_id="ccr",
                        binding_name="mikrotik-ssh",
                        auth_method="ssh_password",
                        username="netto",
                        secret_env_var="SERVER_MONITOR_MIKROTIK_PASSWORD",
                        port=22,
                        validation_status="pending",
                        notes="SSH liberado temporariamente apenas para o host de monitoramento para auditoria e coleta profunda.",
                    ),
                    HostCredentialBinding(
                        host_id="ccr",
                        binding_name="mikrotik-api",
                        auth_method="routeros_api_password",
                        username="netto",
                        secret_env_var="SERVER_MONITOR_MIKROTIK_PASSWORD",
                        port=2020,
                        validation_status="failed",
                        notes="Porta 2020 indicada como acesso ao roteador, mas nao respondeu como API RouterOS a partir do host de monitoramento durante a auditoria.",
                    ),
                ],
                "capabilities": [HostCapability(host_id="ccr", capability_key=key, enabled=True, details={}) for key in ["routing", "firewall", "nat", "dns", "dhcp", "queues", "vpn", "routeros_inventory"]],
                "collectors": [
                    CollectorBinding(host_id="ccr", collector_type="ssh_routeros", priority=1, config={}),
                    CollectorBinding(host_id="ccr", collector_type="ping", priority=2, config={}),
                ],
                "service_checks": [
                    ServiceCheck(host_id="ccr", service_key="dns_tcp", display_name="Router DNS TCP/53", check_type="tcp", target="192.168.2.1", port=53, severity="warning", notes="Resolver local exposto ao segmento monitorado."),
                    ServiceCheck(host_id="ccr", service_key="bandwidth_test", display_name="Bandwidth Test TCP/2000", check_type="tcp", target="192.168.2.1", port=2000, severity="warning", notes="Porta tipica de bandwidth-test do RouterOS; revisar necessidade em producao."),
                    ServiceCheck(host_id="ccr", service_key="winbox_custom", display_name="WinBox TCP/2020", check_type="tcp", target="192.168.2.1", port=2020, severity="warning", notes="WinBox em porta customizada, conforme informado pelo usuario."),
                ],
                "alert_rules": [
                    AlertRule(host_id="ccr", rule_key="router_dns_exposed", metric_key="service_state", notes="Revisar necessidade do DNS local exposto ao segmento."),
                    AlertRule(host_id="ccr", rule_key="bandwidth_test_exposed", metric_key="service_state", notes="Desabilitar bandwidth-test se nao houver uso operacional."),
                ],
            },
            {
                "id": "pve",
                "name": "Proxmox PVE",
                "hostname": "pve",
                "address": "192.168.2.208",
                "role": "hypervisor",
                "criticality": "high",
                "operating_system": "Proxmox VE 9.1 / Debian 13",
                "profile_id": "proxmox",
                "monitor_type": "ping",
                "collector_type": "proxmox_api",
                "agent_endpoint": None,
                "agent_token": None,
                "tcp_port": 8006,
                "interval_seconds": 30,
                "timeout_ms": 5000,
                "is_active": True,
                "description": "Hipervisor Proxmox VE com VMs srv-03 e sicel-server.",
                "details": {
                    "audit_date": "2026-04-07",
                    "polling_policy": {"service": 30, "host": 30, "vm": 30, "storage": 60},
                    "proxmox": {"endpoint": "https://192.168.2.208:8006", "node_name": "pve", "verify_tls": False},
                },
                "tags": ["proxmox", "hypervisor", "virtualization", "critical"],
                "expected_services": ["proxmox_api", "ssh", "web_ui"],
                "integration_status": "integration_pending",
                "last_status": "unknown",
                "created_at": now,
                "updated_at": now,
                "credentials": [
                    HostCredentialBinding(
                        host_id="pve",
                        binding_name="proxmox-api",
                        auth_method="proxmox_api_token",
                        username="root@pam",
                        secret_env_var="SERVER_MONITOR_PVE_API_TOKEN_SECRET",
                        endpoint="https://192.168.2.208:8006",
                        port=8006,
                        validation_status="pending",
                        notes="Definir também SERVER_MONITOR_PVE_API_TOKEN_ID para ativar coleta completa.",
                        details={"token_id_env_var": "SERVER_MONITOR_PVE_API_TOKEN_ID"},
                    ),
                    HostCredentialBinding(
                        host_id="pve",
                        binding_name="proxmox-ssh",
                        auth_method="ssh_password",
                        username="root",
                        secret_env_var="SERVER_MONITOR_PVE_SSH_PASSWORD",
                        port=22,
                        validation_status="pending",
                        notes="Fallback via SSH, somente se a API não for usada.",
                    ),
                ],
                "capabilities": [HostCapability(host_id="pve", capability_key=key, enabled=True, details={}) for key in ["vms", "storage", "swap", "load_average", "smart"]],
                "collectors": [
                    CollectorBinding(host_id="pve", collector_type="proxmox_api", priority=1, config={"endpoint": "https://192.168.2.208:8006", "node_name": "pve", "verify_tls": False}),
                    CollectorBinding(host_id="pve", collector_type="ssh_linux", priority=2, config={"scope": "fallback", "service_names": []}),
                    CollectorBinding(host_id="pve", collector_type="ping", priority=3, config={}),
                ],
                "service_checks": [
                    ServiceCheck(host_id="pve", service_key="ssh", display_name="SSH", check_type="tcp", target="192.168.2.208", port=22, severity="warning", notes="Acesso administrativo."),
                    ServiceCheck(host_id="pve", service_key="web_ui", display_name="Proxmox Web UI", check_type="tcp", target="192.168.2.208", port=8006, severity="critical", notes="Console web."),
                    ServiceCheck(host_id="pve", service_key="spice_proxy", display_name="SPICE Proxy", check_type="tcp", target="192.168.2.208", port=3128, severity="warning", notes="Proxy SPICE."),
                ],
                "alert_rules": [
                    AlertRule(host_id="pve", rule_key="vm_down", metric_key="vm_state", notes="Alertar quando alguma VM auditada parar."),
                ],
            },
            {
                "id": "srv-00",
                "name": "SRV-00",
                "hostname": "SRV-00",
                "address": "192.168.2.204",
                "role": "windows_bdc_dns_backup",
                "criticality": "critical",
                "operating_system": "Windows Server 2019 Datacenter",
                "profile_id": "windows_dc",
                "monitor_type": "ping",
                "collector_type": "windows_agent",
                "tcp_port": 53,
                "interval_seconds": 30,
                "timeout_ms": 5000,
                "is_active": True,
                "description": "BDC, DNS secundário e futuro servidor de backup.",
                "details": {"audit_date": "2026-04-07", "disk_targets": ["C:", "D:", "E:"], "services": ["ADWS", "DNS", "Netlogon", "KDC", "DFSR", "postgresql-x64-16"]},
                "tags": ["windows", "domain-controller", "dns", "backup", "critical"],
                "expected_services": ["dns_tcp", "kerberos", "ldap", "smb", "postgresql_16"],
                "integration_status": "integration_pending",
                "last_status": "unknown",
                "created_at": now,
                "updated_at": now,
                "credentials": [
                    HostCredentialBinding(host_id="srv-00", binding_name="srv00-winrm", auth_method="winrm_ntlm", username="administrator", secret_env_var="SERVER_MONITOR_SRV00_PASSWORD", port=5985, validation_status="pending", notes="Conta informada para validacao inicial da coleta via WinRM."),
                ],
                "capabilities": [HostCapability(host_id="srv-00", capability_key=key, enabled=True, details={}) for key in ["ad_ds", "dns", "netlogon", "kdc", "dfsr", "postgresql", "patching", "windows_events"]],
                "collectors": [
                    CollectorBinding(host_id="srv-00", collector_type="winrm_windows", priority=1, config={"service_names": ["DNS", "NTDS", "Netlogon", "Kdc", "DFSR", "postgresql-x64-16"]}),
                    CollectorBinding(host_id="srv-00", collector_type="ping", priority=2, config={}),
                ],
                "service_checks": [
                    ServiceCheck(host_id="srv-00", service_key="dns_tcp", display_name="DNS TCP/53", check_type="tcp", target="192.168.2.204", port=53, severity="critical"),
                    ServiceCheck(host_id="srv-00", service_key="kerberos", display_name="Kerberos TCP/88", check_type="tcp", target="192.168.2.204", port=88, severity="critical"),
                    ServiceCheck(host_id="srv-00", service_key="ldap", display_name="LDAP TCP/389", check_type="tcp", target="192.168.2.204", port=389, severity="critical"),
                    ServiceCheck(host_id="srv-00", service_key="smb", display_name="SMB TCP/445", check_type="tcp", target="192.168.2.204", port=445, severity="critical"),
                    ServiceCheck(host_id="srv-00", service_key="postgresql_16", display_name="PostgreSQL 16", check_type="tcp", target="192.168.2.204", port=5432, severity="warning"),
                ],
                "alert_rules": [],
            },
            {
                "id": "srv-01",
                "name": "SRV-01",
                "hostname": "SRV-01",
                "address": "192.168.2.205",
                "role": "windows_pdc_dns_print_dfs",
                "criticality": "critical",
                "operating_system": "Windows Server 2016 Datacenter",
                "profile_id": "windows_dc",
                "monitor_type": "agent",
                "collector_type": "infrawatch_agent",
                "agent_endpoint": "http://192.168.2.205:9090",
                "agent_token": None,
                "tcp_port": 9090,
                "interval_seconds": 30,
                "timeout_ms": 8000,
                "is_active": True,
                "description": "PDC, DNS primário, impressão e DFS/DFSR. Agente legado a ser validado e reaproveitado se compatível.",
                "details": {"audit_date": "2026-04-07", "services": ["DNS", "NTDS", "Netlogon", "KDC", "DFSR", "Spooler"], "agent_candidate": "InfraWatchAgent"},
                "tags": ["windows", "pdc", "dns", "print", "dfsr", "critical"],
                "expected_services": ["legacy_agent", "dns_tcp", "kerberos", "ldap", "smb", "spooler"],
                "integration_status": "awaiting_collection",
                "last_status": "unknown",
                "created_at": now,
                "updated_at": now,
                "credentials": [
                    HostCredentialBinding(host_id="srv-01", binding_name="srv01-legacy-agent", auth_method="agent_token", username="agent", secret_env_var="SERVER_MONITOR_SRV01_AGENT_TOKEN", endpoint="http://192.168.2.205:9090", port=9090, validation_status="pending", notes="Compatibilidade será validada pelo coletor."),
                    HostCredentialBinding(host_id="srv-01", binding_name="srv01-winrm", auth_method="winrm_ntlm", username="administrator", secret_env_var="SERVER_MONITOR_SRV01_PASSWORD", port=5985, validation_status="pending", notes="Fallback caso o agente legado nao seja compativel."),
                ],
                "capabilities": [HostCapability(host_id="srv-01", capability_key=key, enabled=True, details={}) for key in ["ad_ds", "dns", "netlogon", "kdc", "dfsr", "spooler", "patching", "auth_failures"]],
                "collectors": [
                    CollectorBinding(host_id="srv-01", collector_type="agent", priority=1, config={"agent_family": "infrawatch", "compatibility_required": True}),
                    CollectorBinding(host_id="srv-01", collector_type="winrm_windows", priority=2, config={"service_names": ["DNS", "NTDS", "Netlogon", "Kdc", "DFSR", "Spooler"]}),
                    CollectorBinding(host_id="srv-01", collector_type="ping", priority=3, config={}),
                ],
                "service_checks": [
                    ServiceCheck(host_id="srv-01", service_key="legacy_agent", display_name="InfraWatchAgent", check_type="tcp", target="192.168.2.205", port=9090, severity="warning"),
                    ServiceCheck(host_id="srv-01", service_key="dns_tcp", display_name="DNS TCP/53", check_type="tcp", target="192.168.2.205", port=53, severity="critical"),
                    ServiceCheck(host_id="srv-01", service_key="kerberos", display_name="Kerberos TCP/88", check_type="tcp", target="192.168.2.205", port=88, severity="critical"),
                    ServiceCheck(host_id="srv-01", service_key="ldap", display_name="LDAP TCP/389", check_type="tcp", target="192.168.2.205", port=389, severity="critical"),
                    ServiceCheck(host_id="srv-01", service_key="smb", display_name="SMB TCP/445", check_type="tcp", target="192.168.2.205", port=445, severity="critical"),
                ],
                "alert_rules": [],
            },
            {
                "id": "srv-03",
                "name": "SRV-03",
                "hostname": "SRV-03",
                "address": "192.168.2.207",
                "role": "windows_file_server",
                "criticality": "high",
                "operating_system": "Windows Server 2022 Datacenter Evaluation",
                "profile_id": "windows_file_server",
                "monitor_type": "ping",
                "collector_type": "windows_agent",
                "tcp_port": 445,
                "interval_seconds": 30,
                "timeout_ms": 5000,
                "is_active": True,
                "description": "Servidor de arquivos departamental com foco em D:, espaço livre e SMB.",
                "details": {"audit_date": "2026-04-07", "disk_targets": ["C:", "D:"], "shares": ["arquivo", "compras", "contabilidade", "controladoria", "drh", "gabinete", "informatica", "licitação", "naf", "obras", "patrimonio", "planejamento", "PMM_arquivos_scanneados", "procuradoria", "segov", "semad", "seof", "tesouraria", "tributos", "vigias"]},
                "tags": ["windows", "file-server", "storage", "smb", "high"],
                "expected_services": ["smb", "rdp"],
                "integration_status": "integration_pending",
                "last_status": "unknown",
                "created_at": now,
                "updated_at": now,
                "credentials": [
                    HostCredentialBinding(host_id="srv-03", binding_name="srv03-winrm", auth_method="winrm_ntlm", username="administrator", secret_env_var="SERVER_MONITOR_SRV03_PASSWORD", port=5985, validation_status="pending", notes="Conta informada para validacao inicial da coleta via WinRM."),
                ],
                "capabilities": [HostCapability(host_id="srv-03", capability_key=key, enabled=True, details={}) for key in ["shares", "ntfs_events", "smb_events", "disk_growth", "patching"]],
                "collectors": [
                    CollectorBinding(host_id="srv-03", collector_type="winrm_windows", priority=1, config={"service_names": ["LanmanServer"]}),
                    CollectorBinding(host_id="srv-03", collector_type="ping", priority=2, config={}),
                ],
                "service_checks": [
                    ServiceCheck(host_id="srv-03", service_key="smb", display_name="SMB TCP/445", check_type="tcp", target="192.168.2.207", port=445, severity="critical"),
                    ServiceCheck(host_id="srv-03", service_key="rdp", display_name="RDP TCP/3389", check_type="tcp", target="192.168.2.207", port=3389, severity="warning"),
                ],
                "alert_rules": [],
            },
            {
                "id": "srv-04",
                "name": "SRV-04",
                "hostname": "SRV-04",
                "address": "192.168.2.209",
                "role": "windows_legacy_folha",
                "criticality": "high",
                "operating_system": "Windows Server 2019 Datacenter",
                "profile_id": "windows_legacy_app",
                "monitor_type": "ping",
                "collector_type": "windows_agent",
                "tcp_port": 1521,
                "interval_seconds": 30,
                "timeout_ms": 5000,
                "is_active": True,
                "description": "Servidor da Folha com Oracle XE, Firebird, Veeam e Hyper-V.",
                "details": {"audit_date": "2026-04-07", "services": ["OracleServiceXE", "OracleXETNSListener", "FirebirdServerDefaultInstance", "VeeamTransportSvc", "VeeamAgentSvc", "VMMS", "AnyDesk"]},
                "tags": ["windows", "legacy-app", "oracle", "firebird", "veeam", "hyper-v"],
                "expected_services": ["oracle_listener", "firebird", "veeam_transport", "hyperv_vmms", "anydesk"],
                "integration_status": "integration_pending",
                "last_status": "unknown",
                "created_at": now,
                "updated_at": now,
                "credentials": [
                    HostCredentialBinding(host_id="srv-04", binding_name="srv04-winrm", auth_method="winrm_ntlm", username="administrador", secret_env_var="SERVER_MONITOR_SRV04_PASSWORD", port=5985, validation_status="pending", notes="Conta informada para validacao inicial da coleta via WinRM."),
                ],
                "capabilities": [HostCapability(host_id="srv-04", capability_key=key, enabled=True, details={}) for key in ["oracle", "firebird", "veeam", "hyperv", "patching", "windows_events"]],
                "collectors": [
                    CollectorBinding(host_id="srv-04", collector_type="winrm_windows", priority=1, config={"service_names": ["OracleServiceXE", "OracleXETNSListener", "FirebirdServerDefaultInstance", "VeeamTransportSvc", "VeeamAgentSvc", "vmms", "AnyDesk"]}),
                    CollectorBinding(host_id="srv-04", collector_type="ping", priority=2, config={}),
                ],
                "service_checks": [
                    ServiceCheck(host_id="srv-04", service_key="oracle_listener", display_name="Oracle Listener", check_type="tcp", target="192.168.2.209", port=1521, severity="critical"),
                    ServiceCheck(host_id="srv-04", service_key="firebird", display_name="Firebird", check_type="tcp", target="192.168.2.209", port=3050, severity="critical"),
                    ServiceCheck(host_id="srv-04", service_key="hyperv_vmms", display_name="Hyper-V VMMS", check_type="tcp", target="192.168.2.209", port=2179, severity="warning"),
                    ServiceCheck(host_id="srv-04", service_key="veeam_transport", display_name="Veeam Transport", check_type="tcp", target="192.168.2.209", port=6160, severity="warning"),
                    ServiceCheck(host_id="srv-04", service_key="anydesk", display_name="AnyDesk", check_type="tcp", target="192.168.2.209", port=7070, severity="warning"),
                ],
                "alert_rules": [],
            },
            {
                "id": "cicel",
                "name": "cicel",
                "hostname": "cicel",
                "address": "192.168.2.189",
                "role": "linux_app",
                "criticality": "high",
                "operating_system": "Ubuntu Server 24.04.2 LTS",
                "profile_id": "linux_app",
                "monitor_type": "ping",
                "collector_type": "ssh_linux",
                "tcp_port": 80,
                "interval_seconds": 30,
                "timeout_ms": 5000,
                "is_active": True,
                "description": "Servidor de aplicação do SICEL Rápido com nginx, PHP-FPM, MySQL, UFW e fail2ban.",
                "details": {"audit_date": "2026-04-07", "http_health": "http://192.168.2.189/login", "backup_script": "/usr/local/sbin/sicel-db-backup.sh", "backup_path": "/var/backups/sicel"},
                "tags": ["linux", "nginx", "php-fpm", "mysql", "sicel", "backup"],
                "expected_services": ["ssh", "http", "nginx", "php8.3-fpm", "mysql", "ufw", "fail2ban"],
                "integration_status": "integration_pending",
                "last_status": "unknown",
                "created_at": now,
                "updated_at": now,
                "credentials": [
                    HostCredentialBinding(host_id="cicel", binding_name="cicel-ssh", auth_method="ssh_password", username="cicel", secret_env_var="SERVER_MONITOR_CICEL_SSH_PASSWORD", port=22, validation_status="pending", notes="A auditoria indica acesso por chave; preferir migração para chave dedicada.", ssh_key_path="${SERVER_MONITOR_CICEL_SSH_KEY_PATH}"),
                ],
                "capabilities": [HostCapability(host_id="cicel", capability_key=key, enabled=True, details={}) for key in ["nginx", "php_fpm", "mysql", "ufw", "fail2ban", "backup_status", "http_health", "swap", "load_average"]],
                "collectors": [
                    CollectorBinding(host_id="cicel", collector_type="ssh_linux", priority=1, config={"service_names": ["nginx", "php8.3-fpm", "mysql", "ssh", "ufw", "fail2ban"]}),
                    CollectorBinding(host_id="cicel", collector_type="ping", priority=2, config={}),
                ],
                "service_checks": [
                    ServiceCheck(host_id="cicel", service_key="ssh", display_name="SSH", check_type="tcp", target="192.168.2.189", port=22, severity="warning"),
                    ServiceCheck(host_id="cicel", service_key="http", display_name="SICEL HTTP", check_type="http", target="http://192.168.2.189/login", severity="critical", notes="Healthcheck web do SICEL."),
                ],
                "alert_rules": [],
            },
        ]

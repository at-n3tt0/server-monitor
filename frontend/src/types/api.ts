export type User = {
  username: string;
  role: string;
};

export type MetricPoint = {
  recorded_at: string;
  value: number | null;
  value_secondary: number | null;
  label: string | null;
};

export type CurrentMetricSummary = {
  cpu_percent: number | null;
  memory_percent: number | null;
  disk_percent: number | null;
  latency_ms: number | null;
  packet_loss_percent: number | null;
  rx_rate: number | null;
  tx_rate: number | null;
  status: string | null;
  availability_percent: number | null;
  last_seen_at: string | null;
  message: string | null;
  collector_status: string | null;
  integration_status: string | null;
  collector_name: string | null;
  vm_count: number | null;
  vm_running: number | null;
  services_ok: number | null;
  services_total: number | null;
  service_states: Array<{
    service_key: string;
    status: string;
    message: string | null;
    response_time_ms: number | null;
    recorded_at: string | null;
  }>;
  collection_payload: Record<string, unknown>;
};

export type Host = {
  id: string;
  name: string;
  address: string | null;
  hostname: string | null;
  role: string | null;
  criticality: string;
  operating_system: string | null;
  profile_id: string | null;
  monitor_type: string;
  collector_type: string | null;
  agent_endpoint: string | null;
  agent_token: string | null;
  tcp_port: number | null;
  interval_seconds: number;
  timeout_ms: number;
  is_active: boolean;
  description: string | null;
  details: Record<string, unknown>;
  tags: string[];
  expected_services: string[];
  integration_status: string;
  last_seen_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type HostDashboardSummary = {
  host: Host;
  current: CurrentMetricSummary;
  cpu_series: MetricPoint[];
  memory_series: MetricPoint[];
  latency_series: MetricPoint[];
  traffic_series: MetricPoint[];
  disk_series: MetricPoint[];
};

export type Alert = {
  id: string;
  host_id: string;
  alert_key: string;
  alert_type: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

export type AuditLog = {
  id: number;
  actor_username: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type DashboardBootstrap = {
  generated_at: string;
  user: User;
  hosts: HostDashboardSummary[];
  alerts: Alert[];
};

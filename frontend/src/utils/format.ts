export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "sem dados ainda";
  return `${value.toFixed(1)}%`;
}

export function formatMilliseconds(value: number | null | undefined): string {
  if (value == null) return "sem dados ainda";
  return `${value.toFixed(0)} ms`;
}

export function formatRate(value: number | null | undefined): string {
  if (value == null) return "sem dados ainda";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "sem dados ainda";
  return new Date(value).toLocaleString("pt-BR");
}

export function statusLabel(value: string | null | undefined): string {
  if (!value) return "sem dados ainda";
  if (value === "up") return "online";
  if (value === "down") return "offline";
  if (value === "degraded") return "degradado";
  if (value === "pending") return "integração pendente";
  return value;
}

export function integrationLabel(value: string | null | undefined): string {
  if (!value) return "aguardando coleta";
  const labels: Record<string, string> = {
    active: "ativo",
    awaiting_collection: "aguardando coleta",
    integration_pending: "integração pendente",
    collector_error: "erro de coleta",
    pending_credentials: "credencial pendente",
    dependency_missing: "dependência pendente"
  };
  return labels[value] ?? value;
}

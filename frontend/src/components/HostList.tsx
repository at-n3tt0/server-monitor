import type { HostDashboardSummary } from "../types/api";
import { formatMilliseconds, formatPercent, statusLabel } from "../utils/format";


type HostListProps = {
  hosts: HostDashboardSummary[];
  selectedHostId: string | null;
  onSelect: (hostId: string) => void;
};


export function HostList({ hosts, selectedHostId, onSelect }: HostListProps) {
  return (
    <div className="host-strip">
      {hosts.map((item) => {
        const selected = item.host.id === selectedHostId;
        return (
          <button
            key={item.host.id}
            className={`host-tile ${selected ? "host-tile--selected" : ""}`}
            onClick={() => onSelect(item.host.id)}
            type="button"
          >
            <div className="host-tile__header">
              <strong>{item.host.name}</strong>
              <span className={`pill pill--${item.current.status ?? "unknown"}`}>{statusLabel(item.current.status)}</span>
            </div>
            <div className="host-tile__body">
              <span>{item.host.address ?? item.host.agent_endpoint ?? "sem endereco"}</span>
              <span>CPU {formatPercent(item.current.cpu_percent)}</span>
              <span>RAM {formatPercent(item.current.memory_percent)}</span>
              <span>LAT {formatMilliseconds(item.current.latency_ms)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

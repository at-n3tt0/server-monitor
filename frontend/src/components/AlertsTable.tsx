import type { Alert } from "../types/api";
import { formatDateTime } from "../utils/format";
import { EmptyState } from "./EmptyState";


export function AlertsTable({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) {
    return <EmptyState title="sem alertas ativos" description="Nenhum alerta real está aberto neste momento." />;
  }

  return (
    <div className="table-card">
      <div className="panel-header">
        <h3>Alertas recentes</h3>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Host</th>
            <th>Severidade</th>
            <th>Título</th>
            <th>Última ocorrência</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td>{alert.host_id}</td>
              <td>{alert.severity}</td>
              <td>{alert.title}</td>
              <td>{formatDateTime(alert.last_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

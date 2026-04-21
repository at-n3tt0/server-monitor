import type { AuditLog } from "../types/api";
import { EmptyState } from "./EmptyState";
import { formatDateTime } from "../utils/format";


export function AuditTable({ logs }: { logs: AuditLog[] }) {
  if (!logs.length) {
    return <EmptyState title="sem auditoria disponível" description="Nenhuma ação administrativa foi registrada ainda." />;
  }

  return (
    <div className="table-card">
      <div className="panel-header">
        <h3>Auditoria</h3>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Usuário</th>
            <th>Ação</th>
            <th>Mensagem</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{formatDateTime(log.created_at)}</td>
              <td>{log.actor_username ?? "sistema"}</td>
              <td>{log.action}</td>
              <td>{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

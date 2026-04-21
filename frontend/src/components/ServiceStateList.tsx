import { EmptyState } from "./EmptyState";
import type { CurrentMetricSummary } from "../types/api";
import { formatDateTime, integrationLabel, statusLabel } from "../utils/format";


export function ServiceStateList({ current }: { current: CurrentMetricSummary }) {
  if (!current.service_states.length) {
    return <EmptyState title={integrationLabel(current.integration_status)} description={current.message ?? "Ainda não há estados de serviço reais para este host."} />;
  }

  return (
    <div className="service-grid">
      {current.service_states.map((service) => (
        <article className="service-card" key={`${service.service_key}-${service.recorded_at ?? "latest"}`}>
          <div className="service-card__header">
            <strong>{service.service_key}</strong>
            <span className={`pill pill--${service.status}`}>{statusLabel(service.status)}</span>
          </div>
          <p>{service.message ?? "sem detalhe adicional"}</p>
          <small>{service.recorded_at ? formatDateTime(service.recorded_at) : "coleta atual"}</small>
        </article>
      ))}
    </div>
  );
}

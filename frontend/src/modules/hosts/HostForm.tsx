import { useState } from "react";

import type { Host } from "../../types/api";


type HostFormProps = {
  onSubmit: (payload: Partial<Host>) => Promise<void>;
};


const initialState: Partial<Host> = {
  id: "",
  name: "",
  address: "",
  monitor_type: "ping",
  interval_seconds: 30,
  timeout_ms: 5000,
  is_active: true,
  details: {
    thresholds: {
      warning_latency_ms: 150,
      critical_latency_ms: 300,
      warning_packet_loss: 10,
      critical_packet_loss: 30,
      cpu_usage_warning: 80,
      cpu_usage_critical: 90,
      memory_usage_warning: 80,
      memory_usage_critical: 90,
      disk_usage_warning: 85,
      disk_usage_critical: 95
    }
  }
};


export function HostForm({ onSubmit }: HostFormProps) {
  const [values, setValues] = useState<Partial<Host>>(initialState);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="host-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          await onSubmit(values);
          setValues(initialState);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="panel-header">
        <h3>Novo host</h3>
      </div>
      <div className="form-grid">
        <input placeholder="id do host" value={values.id ?? ""} onChange={(event) => setValues((current) => ({ ...current, id: event.target.value }))} />
        <input placeholder="nome" value={values.name ?? ""} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} />
        <input placeholder="endereço" value={values.address ?? ""} onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))} />
        <select value={values.monitor_type ?? "ping"} onChange={(event) => setValues((current) => ({ ...current, monitor_type: event.target.value }))}>
          <option value="ping">ping</option>
          <option value="agent">agent</option>
          <option value="local">local</option>
        </select>
      </div>
      <button className="button" type="submit" disabled={saving}>
        {saving ? "salvando..." : "Criar host"}
      </button>
    </form>
  );
}

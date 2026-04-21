import { EmptyState } from "./EmptyState";
import { statusLabel } from "../utils/format";


type VmState = {
  vmid?: number;
  name?: string;
  status?: string;
  cpus?: number;
  maxmem?: number;
};


export function VmStateList({ vms }: { vms: VmState[] }) {
  if (!vms.length) {
    return <EmptyState title="sem VMs expostas" description="Este host não retornou estado de VMs na última coleta." />;
  }

  return (
    <div className="service-grid">
      {vms.map((vm) => (
        <article className="service-card" key={String(vm.vmid ?? vm.name)}>
          <div className="service-card__header">
            <strong>{vm.name ?? `VM ${vm.vmid}`}</strong>
            <span className={`pill pill--${vm.status ?? "unknown"}`}>{statusLabel(vm.status)}</span>
          </div>
          <p>VMID {vm.vmid ?? "-"}</p>
          <small>{vm.cpus ?? "-"} vCPU • {vm.maxmem ? `${Math.round(vm.maxmem / 1024 / 1024 / 1024)} GB RAM` : "RAM sem dado"}</small>
        </article>
      ))}
    </div>
  );
}

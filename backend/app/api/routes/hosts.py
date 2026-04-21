from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from backend.app.api.deps import get_current_user, require_admin
from backend.app.db.session import get_db
from backend.app.models.metric import CpuMetric, DiskMetric, LatencyMetric, MemoryMetric, NetworkMetric
from backend.app.repositories.audit_repository import AuditRepository
from backend.app.repositories.host_repository import HostRepository
from backend.app.repositories.metric_repository import MetricRepository
from backend.app.schemas.host import HostCreate, HostResponse, HostUpdate
from backend.app.schemas.metric import MetricPoint
from backend.app.services.audit_service import AuditService
from backend.app.services.dashboard_service import DashboardService


router = APIRouter(prefix="/api/hosts", tags=["hosts"])


@router.get("", response_model=list[HostResponse])
def list_hosts(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return HostRepository(db).list()


@router.post("", response_model=HostResponse)
def create_host(payload: HostCreate, db: Session = Depends(get_db), user=Depends(require_admin)):
    repository = HostRepository(db)
    if repository.get(payload.id):
        raise HTTPException(status_code=409, detail="Host ja existe")
    host = repository.create(**payload.model_dump())
    AuditService(AuditRepository(db)).log("host.create", "host", f"Host {host.name} criado", user.username, host.id, payload.model_dump())
    return host


@router.put("/{host_id}", response_model=HostResponse)
def update_host(host_id: str, payload: HostUpdate, db: Session = Depends(get_db), user=Depends(require_admin)):
    repository = HostRepository(db)
    host = repository.get(host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host nao encontrado")
    updated = repository.update(host, payload.model_dump(exclude_none=True))
    AuditService(AuditRepository(db)).log("host.update", "host", f"Host {updated.name} atualizado", user.username, updated.id, payload.model_dump(exclude_none=True))
    return updated


@router.delete("/{host_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_host(host_id: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    repository = HostRepository(db)
    metric_repository = MetricRepository(db)
    host = repository.get(host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host nao encontrado")
    metric_repository.delete_host_metrics(host_id)
    repository.delete(host)
    AuditService(AuditRepository(db)).log("host.delete", "host", f"Host {host.name} removido", user.username, host.id, {})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{host_id}/current")
def get_current_metrics(host_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not HostRepository(db).get(host_id):
        raise HTTPException(status_code=404, detail="Host nao encontrado")
    return DashboardService(db).get_current_summary(host_id)


@router.get("/{host_id}/history")
def get_host_history(host_id: str, metric: str, limit: int = 120, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not HostRepository(db).get(host_id):
        raise HTTPException(status_code=404, detail="Host nao encontrado")
    repository = MetricRepository(db)
    model_map = {
        "cpu": (CpuMetric, lambda row: MetricPoint(recorded_at=row.recorded_at, value=row.usage_percent)),
        "memory": (MemoryMetric, lambda row: MetricPoint(recorded_at=row.recorded_at, value=row.used_percent)),
        "latency": (LatencyMetric, lambda row: MetricPoint(recorded_at=row.recorded_at, value=row.latency_ms)),
        "traffic": (NetworkMetric, lambda row: MetricPoint(recorded_at=row.recorded_at, value=row.rx_rate, value_secondary=row.tx_rate, label=row.interface_name)),
        "disk": (DiskMetric, lambda row: MetricPoint(recorded_at=row.recorded_at, value=row.used_percent, label=row.mountpoint)),
    }
    if metric not in model_map:
        raise HTTPException(status_code=400, detail="Metrica invalida")
    model, mapper = model_map[metric]
    return {"metric": metric, "points": [mapper(row) for row in repository.get_series(model, host_id, limit)]}

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from backend.app.models.metric import CpuMetric, DiskMetric, HostStatusMetric, LatencyMetric, MemoryMetric, NetworkMetric


class MetricRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add_batch(self, items: list[object]) -> None:
        if not items:
            return
        self.db.add_all(items)
        self.db.commit()

    def get_latest(self, model, host_id: str):
        return self.db.scalar(select(model).where(model.host_id == host_id).order_by(desc(model.recorded_at)).limit(1))

    def get_series(self, model, host_id: str, limit: int = 120):
        rows = list(self.db.scalars(select(model).where(model.host_id == host_id).order_by(desc(model.recorded_at)).limit(limit)))
        rows.reverse()
        return rows

    def delete_host_metrics(self, host_id: str) -> None:
        for model in [CpuMetric, MemoryMetric, DiskMetric, NetworkMetric, LatencyMetric, HostStatusMetric]:
            self.db.execute(delete(model).where(model.host_id == host_id))
        self.db.commit()

import psutil

from backend.app.utils.time import utcnow


class LocalCollector:
    def collect(self) -> dict:
        cpu_percent = psutil.cpu_percent(interval=0.2)
        memory = psutil.virtual_memory()
        disks = []
        for partition in psutil.disk_partitions():
            try:
                usage = psutil.disk_usage(partition.mountpoint)
                disks.append(
                    {
                        "mountpoint": partition.mountpoint,
                        "used_percent": usage.percent,
                        "used_bytes": usage.used,
                        "total_bytes": usage.total,
                    }
                )
            except PermissionError:
                continue
        network_counters = psutil.net_io_counters(pernic=True)
        networks = [
            {
                "interface_name": name,
                "rx_bytes": stats.bytes_recv,
                "tx_bytes": stats.bytes_sent,
            }
            for name, stats in network_counters.items()
        ]
        return {
            "recorded_at": utcnow(),
            "status": "up",
            "availability_percent": 100.0,
            "message": "Coleta local concluida",
            "cpu_percent": cpu_percent,
            "cpu_cores": psutil.cpu_count(logical=True),
            "memory_percent": memory.percent,
            "memory_used_bytes": memory.used,
            "memory_total_bytes": memory.total,
            "disks": disks,
            "networks": networks,
        }

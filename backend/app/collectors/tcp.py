import asyncio
from backend.app.utils.time import utcnow


class TcpCollector:
    async def collect(self, host: str, port: int, timeout_ms: int) -> dict:
        started = utcnow()
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout_ms / 1000)
            writer.close()
            await writer.wait_closed()
            ended = utcnow()
            return {
                "status": "up",
                "message": f"TCP {host}:{port} acessível",
                "response_time_ms": round((ended - started).total_seconds() * 1000, 2),
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "status": "down",
                "message": f"Falha no TCP {host}:{port}: {exc}",
                "response_time_ms": None,
            }

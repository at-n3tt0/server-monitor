import httpx

from backend.app.utils.time import utcnow


class AgentCollector:
    async def collect(self, endpoint: str, token: str | None, timeout_ms: int) -> dict:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
            response = await client.get(f"{endpoint.rstrip('/')}/metrics", headers=headers)
            response.raise_for_status()
            payload = response.json()
        payload["recorded_at"] = utcnow()
        payload["status"] = payload.get("status", "up")
        payload["availability_percent"] = payload.get("availability_percent", 100.0)
        payload["message"] = payload.get("message", "Metricas coletadas do agente")
        return payload

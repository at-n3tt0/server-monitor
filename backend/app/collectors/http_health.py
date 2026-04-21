import httpx


class HttpHealthCollector:
    async def collect(self, url: str, timeout_ms: int) -> dict:
        try:
            async with httpx.AsyncClient(timeout=timeout_ms / 1000, follow_redirects=True) as client:
                response = await client.get(url)
            return {
                "status": "up" if response.status_code < 400 else "down",
                "message": f"HTTP {response.status_code}",
                "response_time_ms": response.elapsed.total_seconds() * 1000 if response.elapsed else None,
                "status_code": response.status_code,
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "status": "down",
                "message": f"Falha no healthcheck HTTP: {exc}",
                "response_time_ms": None,
            }

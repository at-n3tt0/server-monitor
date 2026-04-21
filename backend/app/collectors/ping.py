import asyncio
import re

from backend.app.utils.time import utcnow


PING_TIME_RE = re.compile(r"(?:time|tempo)[=<]?\s*(\d+(?:[.,]\d+)?)\s*ms", re.IGNORECASE)
RECEIVED_RE = [
    re.compile(r"Received = (\d+)", re.IGNORECASE),
    re.compile(r"(\d+)\s+received", re.IGNORECASE),
    re.compile(r"Recebidos = (\d+)", re.IGNORECASE),
]
SENT_RE = [
    re.compile(r"Sent = (\d+)", re.IGNORECASE),
    re.compile(r"(\d+)\s+packets transmitted", re.IGNORECASE),
    re.compile(r"Enviados = (\d+)", re.IGNORECASE),
]


class PingCollector:
    async def collect(self, host: str, timeout_ms: int, samples: int = 3) -> dict:
        args = ["ping", "-n", str(samples), "-w", str(timeout_ms), host]
        started = utcnow()
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        output = (stdout or b"").decode(errors="ignore")
        error_text = (stderr or b"").decode(errors="ignore").strip()

        times = [float(match.group(1).replace(",", ".")) for match in PING_TIME_RE.finditer(output)]
        sent = samples
        received = len(times)
        for pattern in SENT_RE:
            match = pattern.search(output)
            if match:
                sent = int(match.group(1))
                break
        for pattern in RECEIVED_RE:
            match = pattern.search(output)
            if match:
                received = int(match.group(1))
                break

        packet_loss = 100.0 if sent <= 0 else max(0.0, round((1 - received / sent) * 100, 2))
        latency = round(sum(times) / len(times), 2) if times else None

        return {
            "recorded_at": started,
            "status": "up" if received > 0 else "down",
            "availability_percent": 100.0 if received > 0 else 0.0,
            "latency_ms": latency,
            "packet_loss_percent": packet_loss,
            "message": f"{received}/{sent} respostas ICMP" if received > 0 else (error_text or "Host sem resposta"),
        }

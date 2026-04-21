from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.routes import alerts, audit, auth, dashboard, hosts
from backend.app.core.config import get_settings
from backend.app.core.security import decode_access_token
from backend.app.db.session import Base, SessionLocal, engine
from backend.app.services.auth_service import AuthService
from backend.app.services.monitoring_service import MonitoringService
from backend.app.services.operational_seed_service import OperationalSeedService
from backend.app.websocket.manager import WebSocketManager


settings = get_settings()
websocket_manager = WebSocketManager()
monitoring_service = MonitoringService(SessionLocal, websocket_manager)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        auth_service = AuthService(db)
        auth_service.ensure_bootstrap_admin()
        OperationalSeedService(db).seed_profiles_and_hosts()
    finally:
        db.close()
    await monitoring_service.start()
    yield
    await monitoring_service.stop()


app = FastAPI(title="server-monitor", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(hosts.router)
app.include_router(dashboard.router)
app.include_router(alerts.router)
app.include_router(audit.router)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.websocket("/ws/dashboard")
async def dashboard_socket(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return
    try:
        decode_access_token(token)
    except Exception:
        await websocket.close(code=4401)
        return

    await websocket_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket)

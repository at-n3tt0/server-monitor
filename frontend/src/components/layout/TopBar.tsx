type TopBarProps = {
  username: string;
  role: string;
  wsConnected: boolean;
  autoRotate: boolean;
  tvMode?: boolean;
  onToggleAutoRotate: () => void;
  onToggleFullscreen: () => void;
  onLogout: () => void;
};


export function TopBar({ username, role, wsConnected, autoRotate, tvMode = false, onToggleAutoRotate, onToggleFullscreen, onLogout }: TopBarProps) {
  return (
    <header className={`topbar ${tvMode ? "topbar--tv" : ""}`}>
      <div className="topbar__brand">
        <p className="eyebrow">{tvMode ? "Grafana Style TV" : "TV Mode NOC"}</p>
        <h1>{tvMode ? "Infra Overview" : "Server Monitor"}</h1>
        {!tvMode ? <p className="muted">Tela continua para observacao em TV com graficos e telemetria real.</p> : null}
      </div>
      <div className="topbar__meta">
        <span className={`badge ${wsConnected ? "badge--ok" : "badge--danger"}`}>
          {wsConnected ? "stream" : "offline"}
        </span>
        <span className={`badge ${autoRotate ? "badge--ok" : "badge--danger"}`}>
          {autoRotate ? "rotate" : "paused"}
        </span>
        {!tvMode ? (
          <div className="identity">
            <strong>{username}</strong>
            <span>{role}</span>
          </div>
        ) : null}
        <button className="button button--ghost" onClick={onToggleAutoRotate} type="button">
          {autoRotate ? "Pausar rotacao" : "Iniciar rotacao"}
        </button>
        <button className="button button--ghost" onClick={onToggleFullscreen} type="button">
          Fullscreen
        </button>
        {!tvMode ? (
          <button className="button button--ghost" onClick={onLogout} type="button">
            Sair
          </button>
        ) : null}
      </div>
    </header>
  );
}

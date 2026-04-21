import { useState } from "react";


type LoginPageProps = {
  onLogin: (username: string, password: string) => Promise<void>;
  error: string | null;
};


export function LoginPage({ onLogin, error }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <main className="login-page">
      <section className="login-card">
        <p className="eyebrow">Autenticação</p>
        <h1>Server Monitor</h1>
        <p className="muted">Entre para visualizar dashboards reais, histórico persistido e estado ao vivo via WebSocket.</p>
        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoading(true);
            try {
              await onLogin(username, password);
            } finally {
              setLoading(false);
            }
          }}
        >
          <input placeholder="usuário" value={username} onChange={(event) => setUsername(event.target.value)} />
          <input placeholder="senha" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error ? <div className="error-banner">{error}</div> : null}
          <button className="button" type="submit" disabled={loading}>
            {loading ? "entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

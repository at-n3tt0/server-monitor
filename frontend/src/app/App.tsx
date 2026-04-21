import { useEffect } from "react";

import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { useDashboardWebSocket } from "../hooks/useDashboardWebSocket";
import { api, authStorage } from "../services/api";
import { useAppStore } from "../store/useAppStore";
import type { Host } from "../types/api";


export function App() {
  const tvMode = window.location.pathname.startsWith("/tv");
  const token = useAppStore((state) => state.token);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const setToken = useAppStore((state) => state.setToken);
  const setBootstrap = useAppStore((state) => state.setBootstrap);
  const setHosts = useAppStore((state) => state.setHosts);
  const setAuditLogs = useAppStore((state) => state.setAuditLogs);
  const setLoading = useAppStore((state) => state.setLoading);
  const setError = useAppStore((state) => state.setError);
  const error = useAppStore((state) => state.error);

  useDashboardWebSocket(token);

  useEffect(() => {
    const stored = authStorage.getToken();
    if (stored) {
      setToken(stored);
    }
  }, [setToken]);

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoading(true);
    Promise.all([
      api.dashboardBootstrap(),
      api.listHosts(),
      api.listAudit().catch(() => [])
    ])
      .then(([dashboard, hosts, auditLogs]) => {
        setBootstrap(dashboard);
        setHosts(hosts);
        setAuditLogs(auditLogs);
        setError(null);
      })
      .catch((requestError) => {
        authStorage.clear();
        setToken(null);
        setBootstrap(null);
        setError(requestError instanceof Error ? requestError.message : "Falha ao carregar o dashboard");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [setAuditLogs, setBootstrap, setError, setHosts, setLoading, setToken, token]);

  async function handleLogin(username: string, password: string) {
    const response = await api.login(username, password);
    authStorage.setToken(response.access_token);
    setToken(response.access_token);
    setError(null);
  }

  async function handleCreateHost(payload: Partial<Host>) {
    await api.createHost(payload);
    const [dashboard, hosts, auditLogs] = await Promise.all([
      api.dashboardBootstrap(),
      api.listHosts(),
      api.listAudit().catch(() => [])
    ]);
    setBootstrap(dashboard);
    setHosts(hosts);
    setAuditLogs(auditLogs);
  }

  function handleLogout() {
    authStorage.clear();
    setToken(null);
    setBootstrap(null);
  }

  if (!token || !bootstrap) {
    return <LoginPage onLogin={handleLogin} error={error} />;
  }

  return <DashboardPage onLogout={handleLogout} onCreateHost={handleCreateHost} tvMode={tvMode} />;
}

import type { Alert, AuditLog, DashboardBootstrap, Host, User } from "../types/api";


const API_HEADERS: HeadersInit = {
  "Content-Type": "application/json"
};


function getToken(): string | null {
  return window.localStorage.getItem("server-monitor-token");
}


async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers ?? API_HEADERS);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail ?? payload.message ?? "Falha na requisicao");
  }

  return payload as T;
}


export const api = {
  login: async (username: string, password: string) => request<{ access_token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  }),
  me: async () => request<User>("/api/auth/me"),
  dashboardBootstrap: async () => request<DashboardBootstrap>("/api/dashboard/bootstrap"),
  listHosts: async () => request<Host[]>("/api/hosts"),
  createHost: async (payload: Partial<Host>) => request<Host>("/api/hosts", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateHost: async (hostId: string, payload: Partial<Host>) => request<Host>(`/api/hosts/${hostId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }),
  deleteHost: async (hostId: string) => request<void>(`/api/hosts/${hostId}`, { method: "DELETE" }),
  listAlerts: async () => request<Alert[]>("/api/alerts"),
  listAudit: async () => request<AuditLog[]>("/api/audit")
};

export const authStorage = {
  getToken,
  setToken: (token: string) => window.localStorage.setItem("server-monitor-token", token),
  clear: () => window.localStorage.removeItem("server-monitor-token")
};

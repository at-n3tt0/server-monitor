import { create } from "zustand";

import type { AuditLog, DashboardBootstrap, Host } from "../types/api";


type AppState = {
  token: string | null;
  bootstrap: DashboardBootstrap | null;
  hosts: Host[];
  auditLogs: AuditLog[];
  selectedHostId: string | null;
  wsConnected: boolean;
  loading: boolean;
  error: string | null;
  setToken: (token: string | null) => void;
  setBootstrap: (bootstrap: DashboardBootstrap | null) => void;
  setHosts: (hosts: Host[]) => void;
  setAuditLogs: (logs: AuditLog[]) => void;
  setSelectedHostId: (hostId: string | null) => void;
  setWsConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};


export const useAppStore = create<AppState>((set) => ({
  token: null,
  bootstrap: null,
  hosts: [],
  auditLogs: [],
  selectedHostId: null,
  wsConnected: false,
  loading: false,
  error: null,
  setToken: (token) => set({ token }),
  setBootstrap: (bootstrap) => set((state) => ({
    bootstrap,
    selectedHostId: state.selectedHostId ?? bootstrap?.hosts[0]?.host.id ?? null
  })),
  setHosts: (hosts) => set({ hosts }),
  setAuditLogs: (auditLogs) => set({ auditLogs }),
  setSelectedHostId: (selectedHostId) => set({ selectedHostId }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));

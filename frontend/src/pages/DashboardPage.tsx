import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../components/EmptyState";
import { MetricBar } from "../components/charts/MetricBar";
import { MetricChart } from "../components/charts/MetricChart";
import { MiniGauge } from "../components/charts/MiniGauge";
import { TopBar } from "../components/layout/TopBar";
import { StatCard } from "../components/StatCard";
import { useAppStore } from "../store/useAppStore";
import type { Host } from "../types/api";
import { formatMilliseconds, formatPercent, formatRate } from "../utils/format";


type DashboardPageProps = {
  onLogout: () => void;
  onCreateHost: (payload: Partial<Host>) => Promise<void>;
  tvMode?: boolean;
};


export function DashboardPage({ onLogout, tvMode = false }: DashboardPageProps) {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const selectedHostId = useAppStore((state) => state.selectedHostId);
  const setSelectedHostId = useAppStore((state) => state.setSelectedHostId);
  const wsConnected = useAppStore((state) => state.wsConnected);
  const [autoRotate, setAutoRotate] = useState(true);

  const hosts = bootstrap?.hosts ?? [];

  useEffect(() => {
    if (!autoRotate || hosts.length < 2) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      const currentIndex = hosts.findIndex((item) => item.host.id === selectedHostId);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % hosts.length : 0;
      setSelectedHostId(hosts[nextIndex]?.host.id ?? null);
    }, 12000);

    return () => window.clearInterval(interval);
  }, [autoRotate, hosts, selectedHostId, setSelectedHostId]);

  if (!bootstrap) {
    return <EmptyState title="aguardando coleta" description="O dashboard ainda nao recebeu dados reais do backend." />;
  }

  const selectedHost = hosts.find((item) => item.host.id === selectedHostId) ?? hosts[0];
  const onlineHosts = hosts.filter((item) => item.current.status === "up").length;
  const degradedHosts = hosts.filter((item) => item.current.status === "degraded").length;
  const offlineHosts = hosts.filter((item) => item.current.status === "down").length;
  const pendingHosts = hosts.filter((item) => item.current.integration_status === "integration_pending").length;
  const selectedHostLabel = selectedHost?.host.name?.toUpperCase().replace(/\s+/g, "-") ?? "--";
  const isSelectedNetworkDevice = selectedHost?.host.profile_id === "mikrotik_router";

  const mainChart = useMemo(() => {
    if (!selectedHost) {
      return {
        title: "Host timeline",
        series: [],
        color: "#8ad05f",
        secondaryColor: undefined as string | undefined,
        note: "sem historico real disponivel"
      };
    }

    if (selectedHost.host.profile_id === "mikrotik_router" && selectedHost.latency_series.length) {
      return {
        title: "Latency timeline",
        series: selectedHost.latency_series,
        color: "#5794f2",
        secondaryColor: undefined,
        note: "latencia real do gateway"
      };
    }

    if (selectedHost.traffic_series.length) {
      return {
        title: "Traffic timeline",
        series: selectedHost.traffic_series,
        color: "#8ad05f",
        secondaryColor: "#6ca6ff",
        note: "trafego real"
      };
    }

    if (selectedHost.cpu_series.length) {
      return {
        title: "CPU timeline",
        series: selectedHost.cpu_series,
        color: "#8ad05f",
        secondaryColor: undefined,
        note: "trafego indisponivel, exibindo CPU real"
      };
    }

    if (selectedHost.memory_series.length) {
      return {
        title: "Memory timeline",
        series: selectedHost.memory_series,
        color: "#8ad05f",
        secondaryColor: undefined,
        note: "trafego indisponivel, exibindo memoria real"
      };
    }

    if (selectedHost.disk_series.length) {
      return {
        title: "Disk timeline",
        series: selectedHost.disk_series,
        color: "#d9b44a",
        secondaryColor: undefined,
        note: "trafego indisponivel, exibindo disco real"
      };
    }

    if (selectedHost.latency_series.length) {
      return {
        title: "Latency timeline",
        series: selectedHost.latency_series,
        color: "#5794f2",
        secondaryColor: undefined,
        note: "trafego indisponivel, exibindo latencia real"
      };
    }

    return {
      title: "Host timeline",
      series: [],
      color: "#8ad05f",
      secondaryColor: undefined,
      note: "sem historico real disponivel"
    };
  }, [selectedHost]);

  const maxTrafficRate = useMemo(() => {
    const values = hosts.flatMap((item) => [item.current.rx_rate ?? 0, item.current.tx_rate ?? 0]);
    const highest = Math.max(...values, 1);
    return highest;
  }, [hosts]);

  function handleToggleFullscreen() {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
      return;
    }
    void document.exitFullscreen();
  }

  function handleManualSelect(hostId: string) {
    setAutoRotate(false);
    setSelectedHostId(hostId);
  }

  function getServiceStatusValue(
    item: (typeof hosts)[number],
    serviceKey: string
  ): { value: number; formattedValue: string; color: string } {
    const match = item.current.service_states.find((service) => service.service_key === serviceKey);
    if (!match) {
      return { value: 0, formattedValue: "sem dados", color: "#4b5563" };
    }
    if (match.status === "up") {
      return { value: 100, formattedValue: "ativo", color: "#8ad05f" };
    }
    return { value: 15, formattedValue: match.status, color: "#e24d42" };
  }

  function getLatencyGaugeValue(latencyMs: number | null | undefined): number | null {
    if (latencyMs == null) return null;
    return Math.max(0, 100 - Math.min(latencyMs, 100));
  }

  return (
    <div className={`app-shell app-shell--tv app-shell--tv-only ${tvMode ? "app-shell--grafana" : ""}`}>
      <TopBar
        username={bootstrap.user.username}
        role={bootstrap.user.role}
        wsConnected={wsConnected}
        autoRotate={autoRotate}
        tvMode={tvMode}
        onToggleAutoRotate={() => setAutoRotate((value) => !value)}
        onToggleFullscreen={handleToggleFullscreen}
        onLogout={onLogout}
      />

      <section className="stats-grid stats-grid--tv">
        <StatCard label="Hosts" value={String(hosts.length)} />
        <StatCard label="Online" value={String(onlineHosts)} tone="ok" />
        <StatCard label="Warn" value={String(degradedHosts + pendingHosts)} tone="warning" />
        <StatCard label="Offline" value={String(offlineHosts)} tone="danger" />
        <StatCard label="Selected" value={selectedHostLabel} />
      </section>

      <section className="grafana-wall">
        {hosts.map((item) => {
          const trafficPercentUp = ((item.current.tx_rate ?? 0) / maxTrafficRate) * 100;
          const trafficPercentDown = ((item.current.rx_rate ?? 0) / maxTrafficRate) * 100;
          const selected = item.host.id === selectedHost?.host.id;
          const isNetworkDevice = item.host.profile_id === "mikrotik_router";
          const dnsStatus = getServiceStatusValue(item, "dns_tcp");
          const bandwidthStatus = getServiceStatusValue(item, "bandwidth_test");
          const winboxStatus = getServiceStatusValue(item, "winbox_custom");

          return (
            <button
              className={`grafana-host ${selected ? "grafana-host--selected" : ""}`}
              key={item.host.id}
              onClick={() => handleManualSelect(item.host.id)}
              type="button"
            >
              <div className="grafana-host__title">
                <strong>{item.host.name}</strong>
                <span>{item.host.address ?? "sem endereco"}</span>
              </div>

              {isNetworkDevice ? (
                <>
                  <div className="grafana-host__gauges">
                    <MiniGauge label="ICMP" value={item.current.availability_percent} color="#8ad05f" />
                    <MiniGauge label="LATENCIA" value={getLatencyGaugeValue(item.current.latency_ms)} color="#5794f2" />
                  </div>

                  <div className="grafana-host__bars">
                    <MetricBar label="DNS 53" value={dnsStatus.value} formattedValue={dnsStatus.formattedValue} color={dnsStatus.color} />
                    <MetricBar label="BWTEST 2000" value={bandwidthStatus.value} formattedValue={bandwidthStatus.formattedValue} color={bandwidthStatus.color} />
                    <MetricBar label="WINBOX 2020" value={winboxStatus.value} formattedValue={winboxStatus.formattedValue} color={winboxStatus.color} />
                  </div>
                </>
              ) : (
                <>
                  <div className="grafana-host__gauges">
                    <MiniGauge label="CPU" value={item.current.cpu_percent} color="#8ad05f" />
                    <MiniGauge label="MEMORIA" value={item.current.memory_percent} color="#8ad05f" />
                  </div>

                  <div className="grafana-host__bars">
                    <MetricBar label="UPLOAD" value={trafficPercentUp} formattedValue={formatRate(item.current.tx_rate)} color="#8ad05f" />
                    <MetricBar label="DOWNLOAD" value={trafficPercentDown} formattedValue={formatRate(item.current.rx_rate)} color="#8ad05f" />
                    <MetricBar label="DISCO" value={item.current.disk_percent} formattedValue={item.current.disk_percent != null ? `${item.current.disk_percent.toFixed(1)}%` : "sem dados"} color="#d9b44a" />
                  </div>
                </>
              )}
            </button>
          );
        })}
      </section>

      <section className="dashboard-grid dashboard-grid--grafana">
        <div className="panel panel--span-9 panel--main-chart">
          <div className="panel-header panel-header--grafana-main">
            <div>
              <h2>{selectedHost?.host.name ?? "Host selecionado"}</h2>
              <p className="muted panel-header__subline">
                <span>{selectedHost?.host.address ?? "sem endereco"}</span>
                <span>{selectedHost?.host.profile_id ?? "sem perfil"}</span>
                <span>{selectedHost?.host.operating_system ?? "SO nao identificado"}</span>
                <span>{mainChart.note}</span>
              </p>
            </div>
          </div>
          <MetricChart title={mainChart.title} series={mainChart.series} color={mainChart.color} secondaryColor={mainChart.secondaryColor} height={430} />
        </div>
        <div className="panel panel--span-3 panel--stack">
          {isSelectedNetworkDevice ? (
            <>
              <div className="chart-panel chart-panel--grafana chart-panel--network">
                <div className="panel-header">
                  <h3>Network posture</h3>
                  <span className="pill pill--up">{formatMilliseconds(selectedHost?.current.latency_ms)}</span>
                </div>
                <div className="network-panel__bars">
                  <MetricBar
                    label="ICMP"
                    value={selectedHost?.current.availability_percent ?? 0}
                    formattedValue={formatPercent(selectedHost?.current.availability_percent)}
                    color="#8ad05f"
                  />
                  <MetricBar
                    label="DNS 53"
                    value={getServiceStatusValue(selectedHost, "dns_tcp").value}
                    formattedValue={getServiceStatusValue(selectedHost, "dns_tcp").formattedValue}
                    color={getServiceStatusValue(selectedHost, "dns_tcp").color}
                  />
                  <MetricBar
                    label="WINBOX 2020"
                    value={getServiceStatusValue(selectedHost, "winbox_custom").value}
                    formattedValue={getServiceStatusValue(selectedHost, "winbox_custom").formattedValue}
                    color={getServiceStatusValue(selectedHost, "winbox_custom").color}
                  />
                  <MetricBar
                    label="BWTEST 2000"
                    value={getServiceStatusValue(selectedHost, "bandwidth_test").value}
                    formattedValue={getServiceStatusValue(selectedHost, "bandwidth_test").formattedValue}
                    color={getServiceStatusValue(selectedHost, "bandwidth_test").color}
                  />
                </div>
              </div>
              <MetricChart title="Latency timeline" series={selectedHost?.latency_series ?? []} color="#5794f2" height={180} />
              <div className="chart-panel chart-panel--grafana chart-panel--network">
                <div className="panel-header">
                  <h3>Security note</h3>
                  <span className="pill pill--pending">passivo</span>
                </div>
                <div className="network-panel__notes">
                  <p>WinBox customizado em 2020/TCP esta exposto ao host de monitoramento.</p>
                  <p>Bandwidth-test em 2000/TCP segue visivel e merece revisao se nao houver uso.</p>
                  <p>Sem API/SSH acessiveis daqui, firewall e NAT internos ainda dependem de export ou acesso dedicado.</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <MetricChart title="CPU timeline" series={selectedHost?.cpu_series ?? []} color="#8ad05f" height={180} />
              <MetricChart title="Memory timeline" series={selectedHost?.memory_series ?? []} color="#8ad05f" height={180} />
              <MetricChart title="Disk timeline" series={selectedHost?.disk_series ?? []} color="#d9b44a" height={180} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

import { Area, AreaChart, CartesianGrid, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "../EmptyState";
import type { MetricPoint } from "../../types/api";


type MetricChartProps = {
  title: string;
  series: MetricPoint[];
  color: string;
  secondaryColor?: string;
  height?: number;
};


export function MetricChart({ title, series, color, secondaryColor, height = 280 }: MetricChartProps) {
  if (!series.length) {
    return <EmptyState title="sem historico disponivel" description={`Nenhum ponto real foi persistido ainda para ${title.toLowerCase()}.`} />;
  }

  const latest = series[series.length - 1];

  return (
    <div className="chart-panel chart-panel--grafana">
      <div className="panel-header">
        <h3>{title}</h3>
        <span className="pill pill--up">{latest?.value != null ? latest.value.toFixed(1) : "sem leitura"}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={series}>
          <defs>
            <linearGradient id={`fill-${title.replace(/\s+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(122, 134, 153, 0.18)" vertical={true} horizontal={true} />
          <XAxis
            dataKey="recorded_at"
            tickFormatter={(value) => new Date(value).toLocaleTimeString("pt-BR")}
            tick={{ fill: "rgba(147,160,179,0.85)", fontSize: 11 }}
            axisLine={{ stroke: "rgba(130,148,171,0.16)" }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "rgba(147,160,179,0.85)", fontSize: 11 }}
            axisLine={{ stroke: "rgba(130,148,171,0.16)" }}
            tickLine={false}
            width={44}
          />
          <Tooltip labelFormatter={(value) => new Date(value as string).toLocaleString("pt-BR")} />
          <Legend />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.06)" />
          <Area type="monotone" dataKey="value" name="principal" stroke={color} fill={`url(#fill-${title.replace(/\s+/g, "-")})`} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="value" name="principal linha" stroke={color} dot={false} strokeWidth={1.4} legendType="none" />
          {secondaryColor ? (
            <Line type="monotone" dataKey="value_secondary" name="secundaria" stroke={secondaryColor} dot={false} strokeWidth={2} activeDot={{ r: 4 }} />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

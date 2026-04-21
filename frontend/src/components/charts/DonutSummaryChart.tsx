import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { EmptyState } from "../EmptyState";


type Slice = {
  label: string;
  value: number;
  color: string;
};

type DonutSummaryChartProps = {
  title: string;
  slices: Slice[];
  centerLabel: string;
  centerValue: string;
};


export function DonutSummaryChart({ title, slices, centerLabel, centerValue }: DonutSummaryChartProps) {
  const hasData = slices.some((slice) => slice.value > 0);

  if (!hasData) {
    return <EmptyState title="sem dados ainda" description={`Nenhum dado real disponivel para ${title.toLowerCase()}.`} />;
  }

  return (
    <div className="chart-panel">
      <div className="panel-header">
        <h3>{title}</h3>
      </div>
      <div className="donut-layout">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius={58} outerRadius={88} stroke="rgba(255,255,255,0.06)" strokeWidth={2}>
              {slices.map((slice) => (
                <Cell key={slice.label} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
        <div className="donut-legend">
          {slices.map((slice) => (
            <div className="donut-legend__item" key={slice.label}>
              <i style={{ backgroundColor: slice.color }} />
              <span>{slice.label}</span>
              <strong>{slice.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

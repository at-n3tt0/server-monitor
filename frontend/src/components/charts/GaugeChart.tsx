import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";


type GaugeChartProps = {
  label: string;
  value: number | null | undefined;
  unit?: string;
  color: string;
  max?: number;
};


export function GaugeChart({ label, value, unit = "%", color, max = 100 }: GaugeChartProps) {
  const safeValue = value == null ? null : Math.max(0, Math.min(value, max));
  const data = [{ name: label, value: safeValue ?? 0, fill: color }];

  return (
    <div className="gauge-card">
      <div className="panel-header">
        <h3>{label}</h3>
      </div>
      {safeValue == null ? (
        <div className="gauge-empty">sem dados ainda</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={170}>
            <RadialBarChart data={data} startAngle={180} endAngle={0} innerRadius="65%" outerRadius="100%" barSize={18}>
              <PolarAngleAxis type="number" domain={[0, max]} tick={false} axisLine={false} />
              <RadialBar background dataKey="value" cornerRadius={10} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="gauge-value">
            <strong>{safeValue.toFixed(unit === "ms" ? 0 : 1)}</strong>
            <span>{unit}</span>
          </div>
        </>
      )}
    </div>
  );
}

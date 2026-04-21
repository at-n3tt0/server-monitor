import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";


type MiniGaugeProps = {
  label: string;
  value: number | null | undefined;
  color?: string;
};


export function MiniGauge({ label, value, color = "#74f36f" }: MiniGaugeProps) {
  const safeValue = value == null ? null : Math.max(0, Math.min(value, 100));
  const data = [{ value: safeValue ?? 0, fill: color }];

  return (
    <div className="mini-gauge">
      <ResponsiveContainer width="100%" height={84}>
        <RadialBarChart data={data} startAngle={180} endAngle={0} innerRadius="78%" outerRadius="98%" barSize={6}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar background dataKey="value" cornerRadius={4} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="mini-gauge__value">{safeValue == null ? "--" : `${safeValue.toFixed(2)}%`}</div>
      <div className="mini-gauge__label">{label}</div>
    </div>
  );
}

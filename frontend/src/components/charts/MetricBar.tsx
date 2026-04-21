type MetricBarProps = {
  label: string;
  value: number | null | undefined;
  formattedValue: string;
  color?: string;
};


export function MetricBar({ label, value, formattedValue, color = "#74f36f" }: MetricBarProps) {
  const safeValue = value == null ? 0 : Math.max(0, Math.min(value, 100));

  return (
    <div className="metric-bar">
      <div className="metric-bar__header">
        <span>{label}</span>
        <strong>{formattedValue}</strong>
      </div>
      <div className="metric-bar__track">
        <div className="metric-bar__fill" style={{ width: `${safeValue}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

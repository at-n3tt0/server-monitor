type StatCardProps = {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warning" | "danger";
};


export function StatCard({ label, value, tone = "neutral" }: StatCardProps) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

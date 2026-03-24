// Stat card — single metric display in the terminal aesthetic

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  accent?: boolean;
}

export function StatCard({ label, value, subValue, accent = false }: StatCardProps) {
  return (
    <div className="border border-border p-3">
      <div className="font-label-mono text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`font-stat tabular-nums ${accent ? "text-amber" : "text-foreground"}`}>
        {value}
      </div>
      {subValue && (
        <div className="font-small text-secondary-foreground mt-0.5">
          {subValue}
        </div>
      )}
    </div>
  );
}

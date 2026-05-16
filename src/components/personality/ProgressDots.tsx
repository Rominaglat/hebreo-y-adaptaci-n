interface ProgressBarProps {
  current: number; // 1-based
  total: number;
}

export function ProgressDots({ current, total }: ProgressBarProps) {
  const pct = Math.round((current / total) * 100);

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold tabular-nums text-foreground tracking-tight">
            {current.toString().padStart(2, '0')}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            / {total}
          </span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
      </div>
      <div className="relative h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-primary to-accent transition-[width] duration-500 ease-[cubic-bezier(0.33,1,0.68,1)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

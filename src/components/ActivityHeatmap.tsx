import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useStreak } from '@/hooks/useStreak';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActivityHeatmapProps {
  className?: string;
  /** How many weeks back to show. Default 26 (~6 months). */
  weeks?: number;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatHe(d: Date): string {
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function ActivityHeatmap({ className, weeks = 26 }: ActivityHeatmapProps) {
  const { activityDates } = useStreak();

  const grid = useMemo(() => {
    const activitySet = new Set(activityDates);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the start: weeks * 7 days back, aligned to Sunday
    const totalDays = weeks * 7;
    const start = new Date(today);
    start.setDate(start.getDate() - totalDays + 1);
    // Align to start of week (Sunday)
    start.setDate(start.getDate() - start.getDay());

    const days: { date: Date; key: string; active: boolean }[] = [];
    const cur = new Date(start);
    while (cur <= today) {
      const k = dateKey(cur);
      days.push({
        date: new Date(cur),
        key: k,
        active: activitySet.has(k),
      });
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [activityDates, weeks]);

  // Group into columns (weeks)
  const columns = useMemo(() => {
    const cols: { date: Date; key: string; active: boolean }[][] = [];
    for (let i = 0; i < grid.length; i += 7) {
      cols.push(grid.slice(i, i + 7));
    }
    return cols;
  }, [grid]);

  const totalActiveDays = activityDates.length;

  return (
    <Card className={cn('overflow-hidden border-border/60', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-lg tracking-tight">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/15 to-accent/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          פעילות
        </CardTitle>
        <CardDescription>
          {totalActiveDays} ימי פעילות בחצי השנה האחרונה
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={50}>
          <div className="overflow-x-auto" dir="ltr">
            <div className="inline-flex gap-1">
              {columns.map((col, i) => (
                <div key={i} className="flex flex-col gap-1">
                  {col.map((day) => (
                    <Tooltip key={day.key}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'w-3 h-3 rounded-sm transition-colors',
                            day.active
                              ? 'bg-gradient-to-br from-primary to-accent shadow-sm shadow-primary/20'
                              : 'bg-muted hover:bg-muted-foreground/20'
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">
                          {day.active ? '✓ פעיל ' : 'ללא פעילות '}
                          <span dir="rtl">{formatHe(day.date)}</span>
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </TooltipProvider>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-muted-foreground" dir="ltr">
          <span>פחות</span>
          <div className="flex gap-1">
            <div className="w-3 h-3 rounded-sm bg-muted" />
            <div className="w-3 h-3 rounded-sm bg-primary/40" />
            <div className="w-3 h-3 rounded-sm bg-primary/70" />
            <div className="w-3 h-3 rounded-sm bg-gradient-to-br from-primary to-accent" />
          </div>
          <span>יותר</span>
        </div>
      </CardContent>
    </Card>
  );
}

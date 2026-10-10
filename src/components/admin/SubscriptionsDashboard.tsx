import { useMemo, useState, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
  type TooltipProps,
} from 'recharts';
import { Users, Wallet, Hourglass, AlertTriangle, RefreshCw, Loader2, Link2Off } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  computeKpis, revenueSeries, formatIls, type SubscriptionRow, type RevenuePoint,
} from '@/lib/subscriptionMetrics';
import type { SubscriptionSyncRun, SyncResult } from '@/hooks/useStudentSubscriptions';

interface SubscriptionsDashboardProps {
  rows: SubscriptionRow[];
  lastRun: SubscriptionSyncRun | null;
  loading: boolean;
  error: string | null;
  syncing: boolean;
  onSync: () => Promise<SyncResult>;
}

const DATE_LOCALES = { he, en: enUS, es } as const;
const MONTH_LOCALES: Record<string, string> = { he: 'he-IL', en: 'en-US', es: 'es' };

/** 'bridge_error: bridge refused: unauthorized' → 'bridge_error' */
const errorCode = (raw: string | null | undefined) => (raw ?? '').split(':')[0].trim() || 'internal_error';

function KpiTile({ icon, label, value, unit, hints, tone = 'primary' }: {
  icon: ReactNode;
  label: string;
  value: string;
  /** Shown small beside the value, so a long unit never truncates the number. */
  unit?: string;
  hints: Array<{ text: string; warn?: boolean }>;
  tone?: 'primary' | 'success' | 'warning' | 'destructive';
}) {
  const toneClass = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }[tone];
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={cn('flex w-9 h-9 rounded-lg items-center justify-center flex-shrink-0', toneClass)}>{icon}</span>
        <span className="text-sm text-muted-foreground font-medium leading-tight">{label}</span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 min-w-0">
        <span className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">{value}</span>
        {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
      </p>
      {hints.length > 0 && (
        <div className="space-y-1">
          {hints.map((h) => (
            <p
              key={h.text}
              className={cn('text-xs leading-snug', h.warn ? 'text-warning font-medium' : 'text-muted-foreground')}
            >
              {h.warn && <AlertTriangle className="inline w-3 h-3 me-1 -mt-0.5" aria-hidden />}
              {h.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const { t, language } = useLanguage();
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(MONTH_LOCALES[language] ?? 'he-IL', { month: 'short', year: '2-digit' }),
    [language],
  );
  const monthLabel = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return monthFmt.format(new Date(y, m - 1, 1));
  };

  const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload as RevenuePoint;
    return (
      <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md" dir={language === 'he' ? 'rtl' : 'ltr'}>
        <p className="font-medium mb-1">{monthLabel(String(label))}</p>
        {point.actual !== null && (
          <p className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{t('manageUsers.subs.chartActual')}</span>
            <span className="tabular-nums font-medium">{formatIls(point.actual, language)}</span>
          </p>
        )}
        {point.forecast !== null && (
          <p className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{t('manageUsers.subs.chartForecast')}</span>
            <span className="tabular-nums font-medium">{formatIls(point.forecast, language)}</span>
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold">{t('manageUsers.subs.chartTitle')}</h3>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden><line x1="0" y1="2" x2="18" y2="2" stroke="hsl(var(--primary))" strokeWidth="2" /></svg>
            {t('manageUsers.subs.chartActual')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden><line x1="0" y1="2" x2="18" y2="2" stroke="hsl(var(--primary))" strokeWidth="2" strokeDasharray="4 3" /></svg>
            {t('manageUsers.subs.chartForecast')}
          </span>
        </div>
      </div>

      {/* Time runs left-to-right in every language, so the chart itself is LTR. */}
      <div dir="ltr" className="h-[220px] sm:h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="subsActualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis
              dataKey="month"
              tickFormatter={monthLabel}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tickFormatter={(v: number) => formatIls(v, language, { compact: true })}
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <ChartTooltip
              content={renderTooltip}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.4, strokeDasharray: '3 3' }}
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="none"
              fill="url(#subsActualFill)"
              connectNulls={false}
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{t('manageUsers.subs.chartHint')}</p>

      {/* Same numbers as a table, for screen readers. */}
      <table className="sr-only">
        <caption>{t('manageUsers.subs.chartTitle')}</caption>
        <thead>
          <tr><th>{t('manageUsers.subs.chartTitle')}</th><th>{t('manageUsers.subs.chartActual')}</th><th>{t('manageUsers.subs.chartForecast')}</th></tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.month}>
              <td>{monthLabel(p.month)}</td>
              <td>{p.actual === null ? '—' : formatIls(p.actual, language)}</td>
              <td>{p.forecast === null ? '—' : formatIls(p.forecast, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnmatchedDialog({ rows, open, onOpenChange }: {
  rows: SubscriptionRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('manageUsers.subs.unmatchedTitle')}</DialogTitle>
          <DialogDescription>{t('manageUsers.subs.unmatchedDesc')}</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start w-14">{t('manageUsers.subs.row')}</TableHead>
                <TableHead className="text-start">{t('admin.user')}</TableHead>
                <TableHead className="text-start">{t('manageUsers.subs.reason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{r.sheet_row}</TableCell>
                  <TableCell>
                    <p className="font-medium">{r.full_name || '—'}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: 'start' }}>
                      {[r.email, r.phone].filter(Boolean).join(' · ')}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">{t(`manageUsers.subs.note.${r.match_note ?? 'none'}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** KPI strip + revenue chart above the users table. Admin-only. */
export function SubscriptionsDashboard({ rows, lastRun, loading, error, syncing, onSync }: SubscriptionsDashboardProps) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const kpis = useMemo(() => computeKpis(rows, today), [rows, today]);
  const series = useMemo(() => revenueSeries(rows, today), [rows, today]);
  const unmatched = useMemo(() => rows.filter((r) => !r.user_id), [rows]);

  const handleSync = async () => {
    const result = await onSync();
    if (result.ok) {
      toast({ title: t('manageUsers.subs.syncDone') });
    } else {
      toast({
        title: t('manageUsers.subs.syncFailed'),
        description: t(`manageUsers.subs.error.${errorCode(result.error)}`),
        variant: 'destructive',
      });
    }
  };

  // Every row carries the time of the sync that wrote it — i.e. the last good one.
  const lastOkLabel = (() => {
    const at = rows[0]?.synced_at ?? null;
    if (!at) return t('manageUsers.subs.neverSynced');
    const time = formatDistanceToNow(new Date(at), {
      addSuffix: true,
      locale: DATE_LOCALES[language as keyof typeof DATE_LOCALES] ?? he,
    });
    return t('manageUsers.subs.synced').replace('{time}', time);
  })();
  const lastRunFailed = lastRun?.ok === false;
  const runErrorCode = errorCode(lastRun?.error);
  const hasData = rows.length > 0;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-lg">{t('manageUsers.subs.title')}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{lastOkLabel}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="self-start sm:self-auto">
            {syncing ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <RefreshCw className="w-4 h-4 me-2" />}
            {t('manageUsers.subs.syncNow')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {lastRunFailed && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium">{t(`manageUsers.subs.error.${runErrorCode}`)}</p>
              {hasData && <p className="text-xs text-muted-foreground">{t('manageUsers.subs.lastSyncFailed')}</p>}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{t('manageUsers.subs.loadError')}</p>
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground py-4">{t('manageUsers.subs.empty')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiTile
                icon={<Users className="w-[18px] h-[18px]" />}
                label={t('manageUsers.subs.payingStudents')}
                value={String(kpis.payingCount)}
                tone="success"
                hints={[
                  kpis.activeWithoutPrice > 0
                    ? { text: t('manageUsers.subs.activeWithoutPrice').replace('{n}', String(kpis.activeWithoutPrice)), warn: true }
                    : { text: t('manageUsers.subs.allPriced') },
                ]}
              />
              <KpiTile
                icon={<Wallet className="w-[18px] h-[18px]" />}
                label={t('manageUsers.subs.mrr')}
                value={formatIls(kpis.mrr, language)}
                hints={[{ text: t('manageUsers.subs.mrrHint') }]}
              />
              <KpiTile
                icon={<Hourglass className="w-[18px] h-[18px]" />}
                label={t('manageUsers.subs.lifetime')}
                value={kpis.expectedLifetimeMonths !== null ? kpis.expectedLifetimeMonths.toFixed(1) : '—'}
                unit={kpis.expectedLifetimeMonths !== null ? t('manageUsers.subs.monthsUnit') : t('manageUsers.subs.noChurn')}
                hints={[
                  ...(kpis.monthlyChurn !== null && kpis.monthlyChurn > 0
                    ? [{ text: t('manageUsers.subs.lifetimeHint').replace('{p}', (kpis.monthlyChurn * 100).toFixed(1)) }]
                    : []),
                  ...(kpis.avgCancelledLifetimeMonths !== null
                    ? [{ text: t('manageUsers.subs.lifetimeActual').replace('{n}', kpis.avgCancelledLifetimeMonths.toFixed(1)) }]
                    : []),
                ]}
              />
              <KpiTile
                icon={<AlertTriangle className="w-[18px] h-[18px]" />}
                label={t('manageUsers.subs.paymentFailed')}
                value={String(kpis.paymentFailedCount)}
                tone={kpis.paymentFailedCount > 0 ? 'destructive' : 'primary'}
                hints={[{ text: t('manageUsers.subs.cancelledToDate').replace('{n}', String(kpis.cancelledCount)) }]}
              />
            </div>

            <RevenueChart data={series} />

            {unmatched.length > 0 && (
              <button
                type="button"
                onClick={() => setUnmatchedOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <Link2Off className="w-4 h-4" aria-hidden />
                {t('manageUsers.subs.unmatched').replace('{n}', String(unmatched.length))}
              </button>
            )}
            <UnmatchedDialog rows={unmatched} open={unmatchedOpen} onOpenChange={setUnmatchedOpen} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

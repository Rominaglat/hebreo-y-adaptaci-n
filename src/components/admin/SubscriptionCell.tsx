import { format } from 'date-fns';
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatIls, type SubscriptionRow, type SubStatus } from '@/lib/subscriptionMetrics';

const STATUS_STYLE: Record<SubStatus, { icon: typeof CheckCircle2; className: string }> = {
  active: { icon: CheckCircle2, className: 'text-success' },
  cancelled: { icon: XCircle, className: 'text-muted-foreground' },
  payment_failed: { icon: AlertTriangle, className: 'text-destructive' },
  unknown: { icon: HelpCircle, className: 'text-muted-foreground' },
};

const showDate = (day: string) => format(new Date(`${day}T00:00:00`), 'd.M.yyyy');

/** Price + status for one student on Manage Users; dates in the tooltip. */
export function SubscriptionCell({ sub }: { sub: SubscriptionRow | undefined }) {
  const { t, language } = useLanguage();
  if (!sub) return <span className="text-muted-foreground">—</span>;

  const { icon: StatusIcon, className } = STATUS_STYLE[sub.status];
  const price = sub.monthly_price === null
    ? t('manageUsers.subs.noPrice')
    : t('manageUsers.subs.perMonth').replace('{price}', formatIls(sub.monthly_price, language));

  const dateLine = (label: string, day: string | null, source: string | null) => {
    if (!day) return null;
    const estimated = source && source !== 'sheet';
    return (
      <p>
        {label}: <span className="tabular-nums">{showDate(day)}</span>
        {estimated && (
          <span className="text-muted-foreground">
            {' '}({t('manageUsers.subs.estimated')} — {t(`manageUsers.subs.source.${source}`)})
          </span>
        )}
      </p>
    );
  };
  const started = dateLine(t('manageUsers.subs.startedAt'), sub.started_at, sub.started_at_source);
  const cancelled = dateLine(t('manageUsers.subs.cancelledAt'), sub.cancelled_at, sub.cancelled_at_source);

  const content = (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className={cn('text-sm font-medium tabular-nums', sub.monthly_price === null && 'text-muted-foreground font-normal')}>
        {price}
      </span>
      <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
        <StatusIcon className="w-3 h-3" aria-hidden />
        {t(`manageUsers.subs.status.${sub.status}`)}
      </span>
    </div>
  );

  if (!started && !cancelled) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-start cursor-default rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {content}
        </button>
      </TooltipTrigger>
      <TooltipContent className="text-xs space-y-0.5">
        {started}
        {cancelled}
      </TooltipContent>
    </Tooltip>
  );
}

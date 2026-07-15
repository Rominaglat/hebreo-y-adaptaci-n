import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Target } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { lessonsForHours, type GoalUnit } from '@/lib/weeklyGoal';
import { cn } from '@/lib/utils';

// Theme-aware progress ring (track + center text use CSS tokens, arc uses the
// brand terracotta gradient). Center text is an HTML overlay — no SVG-text
// overlap, and it reads correctly in light AND dark mode.
function ProgressRing({ pct, sub }: { pct: number; sub: string }) {
  const clamped = Math.max(0, Math.min(1, pct));
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - clamped);
  return (
    <div className="relative flex-shrink-0" style={{ width: 132, height: 132 }}>
      <svg width="132" height="132" viewBox="0 0 132 132" className="-rotate-90">
        <circle cx="66" cy="66" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
        <circle cx="66" cy="66" r={r} fill="none" stroke="url(#goalgrad)" strokeWidth="12"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.33,1,0.68,1)' }} />
        <defs>
          <linearGradient id="goalgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#C4582A" /><stop offset="1" stopColor="#E8965E" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-extrabold text-foreground leading-none">{Math.round(clamped * 100)}%</span>
        <span className="text-[11px] text-muted-foreground mt-1" dir="ltr">{sub}</span>
      </div>
    </div>
  );
}

const CARD = 'relative overflow-hidden border-border/60 shadow-sm bg-gradient-to-br from-primary/10 via-card to-accent/5';

export default function GoalWidget() {
  const { t } = useLanguage();
  const { goal, progress, defaultLessonMinutes, loading, saveGoal, snapshots, streakWeeks } = useWeeklyGoal();
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState<GoalUnit>('hours');
  const [target, setTarget] = useState(10);
  const [emails, setEmails] = useState(true);
  const [saving, setSaving] = useState(false);

  if (loading) return <Card className={cn(CARD, 'h-36 animate-pulse')} />;

  const showForm = editing || !goal;

  // ---------- set / edit form ----------
  if (showForm) {
    const approx = unit === 'hours' ? lessonsForHours(target, defaultLessonMinutes) : null;
    return (
      <Card className={cn(CARD, 'p-5 sm:p-6')}>
        <div className="absolute -top-10 -end-10 w-40 h-40 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-lg font-bold tracking-tight text-foreground">{t('goal.widget.setTitle')}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t('goal.widget.setDesc')}</p>

          <div className="grid gap-6 sm:grid-cols-2 sm:items-center max-w-3xl mx-auto">
            {/* goal controls */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/[0.05] dark:bg-white/[0.06] p-1">
                {(['hours', 'lessons'] as GoalUnit[]).map(u => (
                  <button key={u} type="button" onClick={() => setUnit(u)}
                    className={cn('py-2 rounded-lg font-bold text-sm transition',
                      unit === u ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    {t(u === 'hours' ? 'goal.unit.hours' : 'goal.unit.lessons')}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4">
                <Button type="button" variant="outline" size="icon" className="rounded-full h-10 w-10 flex-shrink-0 text-lg" onClick={() => setTarget(v => Math.max(1, v - 1))}>–</Button>
                <div className="flex-1 text-center">
                  <div className="text-4xl font-extrabold text-foreground leading-none">{target}</div>
                  <div className="text-xs text-muted-foreground mt-1.5">
                    {t(unit === 'hours' ? 'goal.widget.perWeekHours' : 'goal.widget.perWeekLessons')}
                    {approx != null && <> · {t('goal.widget.approxLessons').replace('{n}', String(approx))}</>}
                  </div>
                </div>
                <Button type="button" variant="outline" size="icon" className="rounded-full h-10 w-10 flex-shrink-0 text-lg" onClick={() => setTarget(v => v + 1)}>+</Button>
              </div>
            </div>

            {/* email opt-in + save */}
            <div className="space-y-3">
              <label className="flex items-center gap-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.05] p-3 cursor-pointer">
                <Checkbox checked={emails} onCheckedChange={v => setEmails(Boolean(v))} />
                <span className="text-sm text-foreground leading-snug">{t('goal.widget.emailOptin')}</span>
              </label>
              <Button className="w-full font-bold" disabled={saving}
                onClick={async () => { setSaving(true); await saveGoal(unit, target, emails); setSaving(false); setEditing(false); }}>
                {t('goal.widget.save')}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // ---------- active / tracking ----------
  const p = progress!;
  const doneStr = goal!.unit === 'hours'
    ? (p.hoursDone % 1 ? p.hoursDone.toFixed(1) : String(p.hoursDone))
    : String(p.lessonsDone);
  const unitLabel = t(goal!.unit === 'hours' ? 'goal.widget.hoursShort' : 'goal.widget.lessonsShort');
  const remainingAmount = Math.max(0, goal!.target - p.actual);
  const remainingLabel = `${remainingAmount % 1 ? remainingAmount.toFixed(1) : remainingAmount} ${unitLabel}`;

  return (
    <Card className={cn(CARD, 'shadow-sm hover:shadow-md transition-shadow duration-300 p-5 sm:p-6')}>
      <div className="absolute -top-10 -end-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
        <ProgressRing pct={p.pct} sub={`${doneStr} / ${goal!.target}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Target className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-bold tracking-tight text-foreground truncate">{t('goal.widget.title')}</h3>
            </div>
            <button type="button" className="text-sm font-bold text-primary hover:underline flex-shrink-0" onClick={() => {
              setUnit(goal!.unit); setTarget(goal!.target); setEmails(goal!.emailsEnabled); setEditing(true);
            }}>{t('goal.widget.edit')}</button>
          </div>

          <p className="text-2xl font-extrabold text-foreground leading-none">
            {doneStr} <span className="text-sm font-semibold text-muted-foreground">/ {goal!.target} {unitLabel}</span>
          </p>
          <p className="text-sm text-muted-foreground mt-1.5">
            {remainingAmount <= 0 ? t('goal.widget.done') : t('goal.widget.remaining').replace('{n}', remainingLabel)}
          </p>

          {(streakWeeks > 0 || snapshots.length > 0) && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {streakWeeks > 0 && (
                <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary font-bold text-xs px-2.5 py-1 rounded-full">
                  🔥 {t('goal.widget.streakWeeks').replace('{n}', String(streakWeeks))}
                </span>
              )}
              {snapshots.length > 0 && (
                <div className="flex items-center gap-1.5" title={t('goal.widget.lastWeeks')}>
                  {[...snapshots].reverse().map((s) => (
                    <div key={s.weekStart} title={s.weekStart}
                      className={cn('w-3.5 h-3.5 rounded-full',
                        s.met ? 'bg-gradient-to-br from-primary to-accent' : 'bg-transparent border border-border')} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

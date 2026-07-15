import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { lessonsForHours, type GoalUnit } from '@/lib/weeklyGoal';
import { cn } from '@/lib/utils';

function ProgressRing({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct));
  const r = 56, c = 2 * Math.PI * r, off = c * (1 - clamped);
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" className="mx-auto">
      <circle cx="75" cy="75" r={r} fill="none" stroke="#F1E7D6" strokeWidth="15" />
      <circle cx="75" cy="75" r={r} fill="none" stroke="url(#goalgrad)" strokeWidth="15"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        transform="rotate(-90 75 75)" />
      <text x="75" y="72" textAnchor="middle" fontSize="32" fontWeight="800" fill="#2A2320">
        {Math.round(clamped * 100)}%
      </text>
      <defs>
        <linearGradient id="goalgrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C4582A" /><stop offset="1" stopColor="#E0864F" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function GoalWidget() {
  const { t } = useLanguage();
  const { goal, progress, defaultLessonMinutes, loading, saveGoal, snapshots, streakWeeks } = useWeeklyGoal();
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState<GoalUnit>('hours');
  const [target, setTarget] = useState(10);
  const [emails, setEmails] = useState(true);
  const [saving, setSaving] = useState(false);

  if (loading) return <Card className="p-6 animate-pulse h-40" />;

  const showForm = editing || !goal;

  if (showForm) {
    const approx = unit === 'hours' ? lessonsForHours(target, defaultLessonMinutes) : null;
    return (
      <Card className="p-6">
        <h3 className="text-lg font-extrabold text-foreground mb-1">🎯 {t('goal.widget.setTitle')}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t('goal.widget.setDesc')}</p>

        <div className="flex bg-secondary/60 rounded-xl p-1 mb-4">
          {(['hours', 'lessons'] as GoalUnit[]).map(u => (
            <button key={u} type="button" onClick={() => setUnit(u)}
              className={cn('flex-1 py-2 rounded-lg font-bold text-sm transition',
                unit === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              {t(u === 'hours' ? 'goal.unit.hours' : 'goal.unit.lessons')}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center gap-4 mb-1">
          <Button type="button" variant="outline" size="icon" onClick={() => setTarget(v => Math.max(1, v - 1))}>–</Button>
          <span className="text-4xl font-extrabold text-foreground w-16 text-center">{target}</span>
          <Button type="button" variant="outline" size="icon" onClick={() => setTarget(v => v + 1)}>+</Button>
        </div>
        <p className="text-center text-sm text-muted-foreground mb-4">
          {t(unit === 'hours' ? 'goal.widget.perWeekHours' : 'goal.widget.perWeekLessons')}
          {approx != null && <> · {t('goal.widget.approxLessons').replace('{n}', String(approx))}</>}
        </p>

        <label className="flex items-center gap-3 bg-secondary/40 rounded-lg p-3 mb-4 cursor-pointer">
          <Checkbox checked={emails} onCheckedChange={v => setEmails(Boolean(v))} />
          <span className="text-sm text-foreground">{t('goal.widget.emailOptin')}</span>
        </label>

        <Button className="w-full font-bold" disabled={saving}
          onClick={async () => { setSaving(true); await saveGoal(unit, target, emails); setSaving(false); setEditing(false); }}>
          {t('goal.widget.save')}
        </Button>
      </Card>
    );
  }

  const p = progress!;
  const doneStr = goal!.unit === 'hours'
    ? (p.hoursDone % 1 ? p.hoursDone.toFixed(1) : String(p.hoursDone))
    : String(p.lessonsDone);
  const ofKey = goal!.unit === 'hours' ? 'goal.widget.ofHours' : 'goal.widget.ofLessons';
  const remainingAmount = Math.max(0, goal!.target - p.actual);
  const remainingUnit = t(goal!.unit === 'hours' ? 'goal.widget.hoursShort' : 'goal.widget.lessonsShort');
  const remainingLabel = `${remainingAmount % 1 ? remainingAmount.toFixed(1) : remainingAmount} ${remainingUnit}`;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-extrabold text-foreground">{t('goal.widget.title')}</h3>
        <button type="button" className="text-sm font-bold text-primary" onClick={() => {
          setUnit(goal!.unit); setTarget(goal!.target); setEmails(goal!.emailsEnabled); setEditing(true);
        }}>{t('goal.widget.edit')}</button>
      </div>
      <ProgressRing pct={p.pct} />
      <p className="text-center text-sm text-foreground mt-2">
        {t(ofKey).replace('{done}', doneStr).replace('{target}', String(goal!.target))}
      </p>
      <p className="text-center text-sm text-muted-foreground mt-1">
        {remainingAmount <= 0
          ? t('goal.widget.done')
          : t('goal.widget.remaining').replace('{n}', remainingLabel)}
      </p>

      {streakWeeks > 0 && (
        <div className="text-center mt-3">
          <span className="inline-flex items-center gap-1.5 bg-secondary text-primary font-bold text-sm px-3 py-1.5 rounded-full">
            🔥 {t('goal.widget.streakWeeks').replace('{n}', String(streakWeeks))}
          </span>
        </div>
      )}

      {snapshots.length > 0 && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{t('goal.widget.lastWeeks')}</p>
          <div className="flex gap-2">
            {[...snapshots].reverse().map((s) => (
              <div key={s.weekStart} title={s.weekStart}
                className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white',
                  s.met ? 'bg-gradient-to-br from-primary to-accent' : 'bg-transparent border-2 border-border')}>
                {s.met ? '✓' : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

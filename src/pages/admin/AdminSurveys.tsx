import { useCallback, useEffect, useMemo, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, Copy, Download, Inbox, Loader2, MessageSquareHeart, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { format } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  ASPECT_COLUMN,
  ASPECTS,
  IMPROVEMENT_OPTIONS,
  SURVEY_PATH,
  activeStudentIds,
  summarize,
  surveyPeriod,
  type SurveyResponseRow,
} from '@/lib/satisfactionSurvey';

// Admin-only tab: every monthly satisfaction-survey response, grouped by month,
// with a light summary and the list of active students who haven't answered yet.

interface StudentProfile { id: string; full_name: string | null; email: string | null; avatar_url: string | null; deleted_at: string | null }

const dateLocales = { he, en: enUS, es } as const;

// PostgREST caps a request at 1000 rows — page through so nothing is silently cut.
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** A single-hue magnitude bar with its value as text beside it. */
function Meter({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">{label}</span>
        <span className="font-semibold tabular-nums flex-shrink-0">{display}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden" role="presentation">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export default function AdminSurveys() {
  const { t, language } = useLanguage();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<SurveyResponseRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, StudentProfile>>({});
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const currentPeriod = useMemo(() => surveyPeriod(), []);
  const [period, setPeriod] = useState(currentPeriod);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, profs, roles] = await Promise.all([
        fetchAllRows<SurveyResponseRow>((from, to) => supabase
          .from('satisfaction_survey_responses')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)),
        fetchAllRows<StudentProfile>((from, to) => supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, deleted_at')
          .order('id')
          .range(from, to)),
        fetchAllRows<{ user_id: string; role: string }>((from, to) => supabase
          .from('user_roles')
          .select('user_id, role')
          .order('user_id')
          .order('role')
          .range(from, to)),
      ]);
      setResponses(rows);
      setProfiles(Object.fromEntries(profs.map((p) => [p.id, p])));
      setActiveIds(activeStudentIds(profs, roles));
    } catch (e) {
      toast({ title: t('surveys.loadError'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => { void load(); }, [load]);

  const locale = dateLocales[language as keyof typeof dateLocales] ?? he;
  const monthLabel = (p: string) => {
    const [y, m] = p.split('-').map(Number);
    const label = format(new Date(y, m - 1, 1), 'LLLL yyyy', { locale });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const periods = useMemo(
    () => [...new Set([currentPeriod, ...responses.map((r) => r.period)])].sort().reverse(),
    [responses, currentPeriod],
  );

  const monthRows = useMemo(() => responses.filter((r) => r.period === period), [responses, period]);
  const summary = useMemo(() => summarize(monthRows), [monthRows]);

  const respondents = useMemo(() => new Set(monthRows.map((r) => r.user_id)), [monthRows]);
  const activeResponded = useMemo(() => [...activeIds].filter((id) => respondents.has(id)).length, [activeIds, respondents]);
  const notAnswered = useMemo(
    () => [...activeIds]
      .filter((id) => !respondents.has(id))
      .map((id) => profiles[id])
      .filter((p): p is StudentProfile => !!p)
      .sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '')),
    [activeIds, respondents, profiles],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return monthRows;
    return monthRows.filter((r) => {
      const p = profiles[r.user_id];
      return `${p?.full_name ?? ''} ${p?.email ?? ''}`.toLowerCase().includes(q);
    });
  }, [monthRows, profiles, search]);

  const surveyUrl = `${window.location.origin}${SURVEY_PATH}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(surveyUrl);
      toast({ title: t('surveys.linkCopied') });
    } catch {
      // Clipboard can be blocked (permissions / insecure context) — the URL is
      // shown on the page, so the admin can still copy it by hand.
    }
  };

  const tenureLabel = (code: string) => t(`survey.tenure.${code}`);
  const improvementLabels = (codes: string[]) => codes.map((c) => t(`survey.improvement.${c}`)).join(', ');
  const levelLabel = (n: number) => t(`survey.level.${n}`);
  const studentName = (id: string) => profiles[id]?.full_name || profiles[id]?.email || t('surveys.unknownStudent');
  const initials = (name: string) => name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const fmt1 = (n: number | null) => (n == null ? '—' : n.toFixed(1));

  const exportExcel = async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(period.slice(0, 7));
    ws.columns = [
      { header: t('surveys.colName'), key: 'name', width: 24 },
      { header: t('surveys.colEmail'), key: 'email', width: 30 },
      { header: t('surveys.colDate'), key: 'date', width: 18 },
      { header: t('survey.q.tenure'), key: 'tenure', width: 18 },
      { header: t('survey.q.recommend'), key: 'recommend', width: 14 },
      { header: t('survey.q.overall'), key: 'overall', width: 14 },
      { header: t('survey.q.improvement'), key: 'improvement', width: 36 },
      ...ASPECTS.map((a) => ({ header: t(`survey.aspect.${a}`), key: `aspect_${a}`, width: 18 })),
      { header: t('survey.q.contribution'), key: 'contribution', width: 50 },
      { header: t('survey.q.suggestions'), key: 'suggestions', width: 50 },
      { header: t('survey.q.comments'), key: 'comments', width: 50 },
    ];
    ws.getRow(1).font = { bold: true };
    filtered.forEach((r) => {
      ws.addRow({
        name: profiles[r.user_id]?.full_name ?? '',
        email: profiles[r.user_id]?.email ?? '',
        date: format(new Date(r.created_at), 'yyyy-MM-dd HH:mm'),
        tenure: tenureLabel(r.tenure),
        recommend: t(r.would_recommend ? 'survey.yes' : 'survey.no'),
        overall: r.overall_satisfaction,
        improvement: improvementLabels(r.needs_improvement),
        ...Object.fromEntries(ASPECTS.map((a) => [`aspect_${a}`, levelLabel(r[ASPECT_COLUMN[a]])])),
        contribution: r.contribution,
        suggestions: r.suggestions,
        comments: r.comments ?? '',
      });
    });
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `encuesta-${period.slice(0, 7)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const ratePct = activeIds.size > 0 ? Math.round((activeResponded / activeIds.size) * 100) : null;
  const maxImprovement = Math.max(1, ...IMPROVEMENT_OPTIONS.map((o) => summary.improvementCounts[o]));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <MessageSquareHeart className="w-5 h-5 text-primary" /> {t('nav.surveys')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('surveys.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 ms-auto">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-auto min-w-48 gap-2" aria-label={t('surveys.month')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>
                  {monthLabel(p)}{p === currentPeriod ? ` ${t('surveys.currentMonth')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void exportExcel()} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 me-2" /> {t('surveys.export')}
          </Button>
        </div>
      </div>

      {/* Survey link */}
      <Card className="p-3 flex flex-wrap items-center gap-3">
        <code dir="ltr" className="text-sm bg-muted rounded px-2 py-1 select-all break-all">{surveyUrl}</code>
        <Button size="sm" onClick={() => void copyLink()} className="ms-auto">
          <Copy className="w-4 h-4 me-2" /> {t('surveys.copyLink')}
        </Button>
      </Card>

      {/* Headline numbers */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={t('surveys.responseRate')}
          value={ratePct == null ? '—' : `${ratePct}%`}
          sub={`${activeResponded} ${t('surveys.ofActive').replace('{n}', String(activeIds.size))}`}
        />
        <StatTile label={t('surveys.avgOverall')} value={summary.avgOverall == null ? '—' : `${fmt1(summary.avgOverall)} / 5`} />
        <StatTile label={t('surveys.recommend')} value={summary.recommendPct == null ? '—' : `${summary.recommendPct}%`} />
      </div>

      {summary.count > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">{t('surveys.improvementTitle')}</h3>
            {IMPROVEMENT_OPTIONS.map((o) => (
              <Meter
                key={o}
                label={t(`survey.improvement.${o}`)}
                value={summary.improvementCounts[o]}
                max={maxImprovement}
                display={String(summary.improvementCounts[o])}
              />
            ))}
          </Card>
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">{t('surveys.aspectsTitle')}</h3>
            {ASPECTS.map((a) => (
              <Meter
                key={a}
                label={t(`survey.aspect.${a}`)}
                value={summary.aspectAverages[a] ?? 0}
                max={4}
                display={fmt1(summary.aspectAverages[a])}
              />
            ))}
          </Card>
        </div>
      )}

      {/* Responses */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border/60">
          <h3 className="font-semibold">
            {t('surveys.responses')} <span className="text-muted-foreground font-normal tabular-nums">({monthRows.length})</span>
          </h3>
          {monthRows.length > 0 && (
            <div className="relative ms-auto">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('surveys.search')} className="ps-9 w-52 sm:w-64" />
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="py-14 px-6 text-center text-sm text-muted-foreground space-y-2">
            <Inbox className="w-8 h-8 mx-auto opacity-50" />
            <p>{monthRows.length === 0 ? t('surveys.noResponses') : t('surveys.noMatches')}</p>
          </div>
        ) : (
          <Accordion type="multiple" className="divide-y divide-border/60">
            {filtered.map((r) => {
              const name = studentName(r.user_id);
              const p = profiles[r.user_id];
              return (
                <AccordionItem key={r.id} value={r.id} className="border-b-0">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 gap-3">
                    <span className="flex items-center gap-3 flex-1 min-w-0 text-start">
                      <Avatar className="w-9 h-9 flex-shrink-0">
                        <AvatarImage src={p?.avatar_url ?? undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials(name)}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-sm truncate">{name}</span>
                        <span className="block text-xs text-muted-foreground truncate" dir="ltr">
                          {p?.email ?? ''}
                        </span>
                      </span>
                      <span className="hidden sm:block text-xs text-muted-foreground flex-shrink-0">
                        {format(new Date(r.created_at), 'd MMM, HH:mm', { locale })}
                      </span>
                      <span className="text-sm font-bold tabular-nums flex-shrink-0">{r.overall_satisfaction}/5</span>
                      {r.would_recommend
                        ? <ThumbsUp className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-label={t('survey.yes')} />
                        : <ThumbsDown className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-label={t('survey.no')} />}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <dl className="grid gap-3 text-sm">
                      {([
                        [t('survey.q.tenure'), tenureLabel(r.tenure)],
                        [t('survey.q.recommend'), t(r.would_recommend ? 'survey.yes' : 'survey.no')],
                        [t('survey.q.overall'), `${r.overall_satisfaction} / 5`],
                        [t('survey.q.improvement'), improvementLabels(r.needs_improvement)],
                      ] as const).map(([q, a]) => (
                        <div key={q} className="rounded-md bg-muted/40 p-3 space-y-1">
                          <dt className="text-xs font-medium text-muted-foreground">{q}</dt>
                          <dd>{a}</dd>
                        </div>
                      ))}
                      <div className="rounded-md bg-muted/40 p-3 space-y-2">
                        <dt className="text-xs font-medium text-muted-foreground">{t('survey.q.aspects')}</dt>
                        <dd className="grid gap-y-1 gap-x-10 sm:grid-cols-2">
                          {ASPECTS.map((a) => (
                            <div key={a} className="flex justify-between gap-3">
                              <span>{t(`survey.aspect.${a}`)}</span>
                              <span className="font-medium">{levelLabel(r[ASPECT_COLUMN[a]])}</span>
                            </div>
                          ))}
                        </dd>
                      </div>
                      {([
                        [t('survey.q.contribution'), r.contribution],
                        [t('survey.q.suggestions'), r.suggestions],
                        [t('survey.q.comments'), r.comments],
                      ] as const).filter(([, a]) => !!a).map(([q, a]) => (
                        <div key={q} className="rounded-md bg-muted/40 p-3 space-y-1">
                          <dt className="text-xs font-medium text-muted-foreground">{q}</dt>
                          <dd className="whitespace-pre-wrap">{a}</dd>
                        </div>
                      ))}
                    </dl>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </Card>

      {/* Active students who haven't answered this month */}
      <Collapsible>
        <Card className="overflow-hidden">
          <CollapsibleTrigger asChild>
            <button type="button" className="group w-full flex items-center justify-between gap-3 p-4 text-start hover:bg-muted/40">
              <span className="font-semibold">
                {notAnswered.length === 0
                  ? t('surveys.allAnswered')
                  : t('surveys.notAnswered').replace('{n}', String(notAnswered.length))}
              </span>
              {notAnswered.length > 0 && (
                <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              )}
            </button>
          </CollapsibleTrigger>
          {notAnswered.length > 0 && (
            <CollapsibleContent>
              <ul className={cn('grid sm:grid-cols-2 gap-x-6 gap-y-1.5 px-4 pb-4 text-sm')}>
                {notAnswered.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-2 min-w-0">
                    <span className="truncate">{s.full_name || '—'}</span>
                    <span className="text-xs text-muted-foreground truncate" dir="ltr">{s.email}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          )}
        </Card>
      </Collapsible>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { motion } from 'framer-motion';
import {
  Sparkles,
  AlertTriangle,
  MessagesSquare,
  Target,
  Download,
  History,
  Loader2,
  RefreshCw,
  ChevronLeft,
  Rocket,
  Puzzle,
  Palette,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePersonalityAssessment } from '@/hooks/usePersonalityAssessment';
import { ActivityRings } from '@/components/personality/dashboard/ActivityRings';
import { ProportionalDonut } from '@/components/personality/dashboard/ProportionalDonut';
import { useCountUp } from '@/components/personality/dashboard/useCountUp';
import {
  DISC_COLOR_LABELS_HE,
  DISC_COLOR_NAMES_HE,
  EMYTH_AXIS_NAMES_HE,
} from '@/lib/personality/types';
import type {
  DiscColor,
  EmythAxis,
  PersonalityAssessment,
} from '@/lib/personality/types';
import { cn } from '@/lib/utils';

// ─── color tokens ────────────────────────────────────────────────────

const EMYTH_COLOR: Record<EmythAxis, string> = {
  EM: '#CE1EE8',
  MN: '#1EE8DB',
  AR: '#E88A1E',
};

const EMYTH_ICON = {
  EM: Rocket,
  MN: Puzzle,
  AR: Palette,
} as const;

const DISC_COLOR_HEX: Record<DiscColor, string> = {
  R: '#E5484D',
  Y: '#F5A524',
  G: '#2BB673',
  B: '#3B82F6',
};

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * UI displays use SHARES everywhere (sum to 100). With v3, shares are
 * derived from strengths via a zero-floored centered model, so genuine
 * dominance still shows visually (e.g. strong-EM user → ~100/0/0 shares)
 * while neutral answers fall back to a balanced split with an explicit
 * "פרופיל לא מובהק" dominance label that surfaces the truth.
 *
 * Strengths remain in the data layer (consumed by Claude's narrative
 * prompt and the dominance-label computation) but never appear as a
 * number in the UI — mixing two scales was the bug that made the
 * rings, legend and donut center disagree with each other.
 */
function rankedEmyth(a: PersonalityAssessment): { key: EmythAxis; value: number }[] {
  return [
    { key: 'EM' as EmythAxis, value: a.emyth_scores.entrepreneur },
    { key: 'MN' as EmythAxis, value: a.emyth_scores.manager },
    { key: 'AR' as EmythAxis, value: a.emyth_scores.artisan },
  ].sort((x, y) => y.value - x.value);
}

function getActionTitle(a: PersonalityAssessment): string {
  // v3 ships a pre-computed Hebrew dominance label that interprets the
  // strength pattern correctly (e.g. "יזם מובהק", "פרופיל מעורב יזם-מנהל",
  // "פרופיל לא מובהק"). Fall back to the legacy share-derived heuristic
  // only for old v1 rows.
  if (a.emyth_scores.dominance_label) return a.emyth_scores.dominance_label;

  const ranked = rankedEmyth(a);
  const [first, second] = ranked;
  if (first.value >= 50) return EMYTH_AXIS_NAMES_HE[first.key];
  if (second.value >= 25) {
    return `${EMYTH_AXIS_NAMES_HE[first.key]}-${EMYTH_AXIS_NAMES_HE[second.key]}`;
  }
  return EMYTH_AXIS_NAMES_HE[first.key];
}

interface PersonalityResultsViewProps {
  onRetake?: () => void;
}

// ─── component ────────────────────────────────────────────────────────

export default function PersonalityResultsView({ onRetake }: PersonalityResultsViewProps = {}) {
  const params = useParams<{ id?: string }>();
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const { latest, history, loading, fetchById, cooldown } = usePersonalityAssessment();
  const { toast } = useToast();

  const [requested, setRequested] = useState<PersonalityAssessment | null>(null);
  const [requestedLoading, setRequestedLoading] = useState(false);
  const [hoveredEmyth, setHoveredEmyth] = useState<EmythAxis | null>(null);
  const [hoveredDisc, setHoveredDisc] = useState<DiscColor | null>(null);

  useEffect(() => {
    if (!params.id) return;
    setRequestedLoading(true);
    fetchById(params.id).then((row) => {
      setRequested(row);
      setRequestedLoading(false);
    });
  }, [params.id, fetchById]);

  const assessment = params.id ? requested : latest;
  const showLoading = params.id ? requestedLoading : loading;

  const userName = useMemo(
    () => user?.user_metadata?.full_name || user?.email || '',
    [user],
  );

  const [pdfBusy, setPdfBusy] = useState(false);

  const handleDownloadPdf = async () => {
    if (!assessment) return;
    setPdfBusy(true);
    try {
      // Lazy-load @react-pdf/renderer — it's ~700KB and only needed on download.
      const [{ pdf }, { PdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/personality/PdfDocument'),
      ]);
      const blob = await pdf(
        <PdfDocument
          assessment={assessment}
          userName={userName}
          tenantName={currentTenant?.name}
          tenantLogoUrl={currentTenant?.logo_url}
        />,
      ).toBlob();
      const filename = `personality-${format(new Date(assessment.created_at), 'yyyy-MM-dd')}.pdf`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Defer revoke to give the browser time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('PDF generation failed', e);
      toast({
        title: 'שגיאה ביצירת ה-PDF',
        description: e instanceof Error ? e.message : 'נסו שוב',
        variant: 'destructive',
      });
    } finally {
      setPdfBusy(false);
    }
  };

  // ─── loading / empty ────────────────────────────────────────────────

  if (showLoading) {
    return (
      <DashboardWrapper>
        <div className="space-y-6 pt-12">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-80 w-full rounded-3xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
        </div>
      </DashboardWrapper>
    );
  }

  if (!assessment) {
    return (
      <DashboardWrapper>
        <div className="max-w-2xl mx-auto pt-16 text-center space-y-4">
          <div className="text-lg font-bold">לא נמצא ניתוח אישיות</div>
          <p className="text-muted-foreground">השאלון יופיע כאן לאחר השלמת המילוי.</p>
          <Button asChild>
            <Link to="/personality">למעבר לשאלון</Link>
          </Button>
        </div>
      </DashboardWrapper>
    );
  }

  // ─── data ────────────────────────────────────────────────────────────

  const emythRanked = rankedEmyth(assessment);
  const top = emythRanked[0];
  const dateLabel = format(new Date(assessment.created_at), 'd בMMMM yyyy', { locale: he });
  const actionTitle = getActionTitle(assessment);
  const primaryDisc = assessment.disc_primary;

  // Both donut (proportional) and bars (each filling its own track) read
  // from the same `value` (share, sums to 100) — that keeps the donut
  // arc, the center number and the bar widths all in agreement.
  const discSegments = (['R', 'Y', 'G', 'B'] as DiscColor[]).map((c) => ({
    key: c,
    value: assessment.disc_scores[c],
    color: DISC_COLOR_HEX[c],
    label: DISC_COLOR_NAMES_HE[c],
    caption: DISC_COLOR_LABELS_HE[c],
  }));

  // Rings fill independently 0-100. With share values, each ring shows
  // its proportional share — dominance is still visible (the dominant
  // axis fills a much larger ring) and the legend numbers sum to 100.
  const ringsData = emythRanked.map((r) => ({
    key: r.key,
    value: r.value,
    color: EMYTH_COLOR[r.key],
    label: EMYTH_AXIS_NAMES_HE[r.key],
  }));

  return (
    <DashboardWrapper>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 mb-10 sm:mb-14">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleDownloadPdf}
              disabled={pdfBusy}
              size="sm"
              variant="ghost"
              className="text-foreground/70 hover:text-foreground hover:bg-foreground/5"
            >
              {pdfBusy ? <Loader2 className="w-4 h-4 me-1.5 animate-spin" /> : <Download className="w-4 h-4 me-1.5" />}
              PDF
            </Button>
            {!params.id && onRetake && !cooldown.active && (
              <Button
                onClick={onRetake}
                size="sm"
                variant="ghost"
                className="text-foreground/70 hover:text-foreground hover:bg-foreground/5"
              >
                <RefreshCw className="w-4 h-4 me-1.5" />
                שאלון חדש
              </Button>
            )}
          </div>
          <div className="text-end space-y-0.5">
            <div className="dash-eyebrow uppercase text-foreground/40">
              הפרופיל האישיותי שלך
            </div>
            <div className="text-sm text-foreground/60 tabular-nums">{dateLabel}</div>
          </div>
        </header>

        {/* Hero — Activity Rings + Communication Donut */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 sm:gap-6 mb-4 sm:mb-6">
          <Tile className="overflow-hidden">
            <div className="absolute top-6 inset-x-6 sm:top-8 sm:inset-x-8 z-10">
              <div className="dash-eyebrow uppercase text-foreground/40 text-right">
                מבנה האישיות
              </div>
              {(() => {
                // Long dominance labels (e.g. "פרופיל לא מובהק — מומלץ למלא שוב...")
                // split at the em-dash: short headline + subtle subtitle.
                const dashIdx = actionTitle.indexOf(' — ');
                const headline = dashIdx > 0 ? actionTitle.slice(0, dashIdx) : actionTitle;
                const subtitle = dashIdx > 0 ? actionTitle.slice(dashIdx + 3) : null;
                return (
                  <>
                    <div className="dash-action-title text-3xl sm:text-4xl mt-1.5 text-right">
                      {headline}
                    </div>
                    {subtitle && (
                      <div className="text-sm text-foreground/55 mt-1.5 text-right max-w-[28ch] ms-auto">
                        {subtitle}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="flex items-center justify-center pt-20 pb-20 sm:pt-24 sm:pb-24">
              <ActivityRings
                rings={ringsData}
                size={340}
                thickness={32}
                gap={6}
                hoveredKey={hoveredEmyth}
              />
            </div>

            {/* Legend strip — interactive */}
            <div className="absolute bottom-5 inset-x-6 sm:inset-x-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              {emythRanked.map((r) => {
                const Icon = EMYTH_ICON[r.key];
                const isHovered = hoveredEmyth === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onMouseEnter={() => setHoveredEmyth(r.key)}
                    onMouseLeave={() => setHoveredEmyth(null)}
                    onFocus={() => setHoveredEmyth(r.key)}
                    onBlur={() => setHoveredEmyth(null)}
                    className={cn(
                      'group flex items-center gap-2 px-3 py-2 rounded-xl transition-all',
                      'hover:bg-foreground/[0.04] focus:bg-foreground/[0.04] outline-none',
                      isHovered && 'bg-foreground/[0.04] ring-1 ring-foreground/10',
                    )}
                  >
                    <span
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
                      style={{ backgroundColor: EMYTH_COLOR[r.key] }}
                    >
                      <Icon className="w-3.5 h-3.5 text-white" strokeWidth={2.4} />
                    </span>
                    <div className="text-start">
                      <div className="text-[10px] uppercase tracking-wider text-foreground/50 leading-tight font-semibold">
                        {EMYTH_AXIS_NAMES_HE[r.key]}
                      </div>
                      <div className="text-sm font-bold tabular-nums leading-tight" style={{ color: EMYTH_COLOR[r.key] }}>
                        {r.value}%
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Tile>

          {/* Communication donut */}
          <Tile>
            <div className="dash-eyebrow uppercase text-foreground/40 text-right">
              סגנון תקשורת
            </div>
            <div className="dash-action-title text-2xl sm:text-3xl text-right mt-1.5">
              {DISC_COLOR_NAMES_HE[primaryDisc]}
              <span className="text-foreground/40 mx-2">·</span>
              <span style={{ color: DISC_COLOR_HEX[primaryDisc] }}>
                {DISC_COLOR_LABELS_HE[primaryDisc]}
              </span>
            </div>

            <div className="flex items-center justify-center py-6 text-foreground">
              <ProportionalDonut
                segments={discSegments}
                primaryKey={primaryDisc}
                hoveredKey={hoveredDisc}
                size={220}
                thickness={32}
              />
            </div>

            {/* Bars row — each bar shows the color's share (sum-to-100),
                so the bar widths and the donut arcs visualize the same thing. */}
            <div className="space-y-1.5 mt-2">
              {discSegments
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((s, i) => (
                  <BarRow
                    key={s.key}
                    label={s.label}
                    value={s.value}
                    color={s.color}
                    delay={0.4 + i * 0.08}
                    isHovered={hoveredDisc === s.key}
                    isFaded={!!hoveredDisc && hoveredDisc !== s.key}
                    onMouseEnter={() => setHoveredDisc(s.key as DiscColor)}
                    onMouseLeave={() => setHoveredDisc(null)}
                  />
                ))}
            </div>
          </Tile>
        </div>

        {/* Combined-type insight tile */}
        <Tile className="mb-4 sm:mb-6">
          <div className="text-right">
            <div className="dash-eyebrow uppercase text-foreground/40 mb-1">
              הצירוף שלך
            </div>
            <div className="dash-action-title text-2xl sm:text-3xl mb-4">
              <span style={{ color: EMYTH_COLOR[top.key] }}>{EMYTH_AXIS_NAMES_HE[top.key]}</span>
              <span className="text-foreground/30 text-xl font-light mx-3">·</span>
              <span style={{ color: DISC_COLOR_HEX[primaryDisc] }}>
                {DISC_COLOR_NAMES_HE[primaryDisc]}
              </span>
            </div>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-foreground/85 max-w-3xl">
            {assessment.insights.summary ?? ''}
          </p>
        </Tile>

        {/* 3 insight tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
          <InsightTile
            icon={Sparkles}
            label="חוזקות"
            accent="#22c55e"
            items={assessment.insights.strengths ?? []}
          />
          <InsightTile
            icon={AlertTriangle}
            label="אתגרים"
            accent="#f59e0b"
            items={assessment.insights.weaknesses ?? []}
          />
          <InsightTile
            icon={Target}
            label="המלצות לפעולה"
            accent="#a78bfa"
            items={assessment.insights.action_recommendations ?? []}
            numbered
          />
        </div>

        {/* Communication-style paragraph */}
        <Tile className="mb-4 sm:mb-6">
          <div className="flex items-start gap-3 mb-4">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#3B82F622', color: '#3B82F6' }}
            >
              <MessagesSquare className="w-4 h-4" strokeWidth={2.2} />
            </div>
            <div className="text-right">
              <div className="dash-eyebrow uppercase text-foreground/40">
                איך לעבוד איתך
              </div>
              <div className="text-lg font-bold mt-0.5">סגנון תקשורת</div>
            </div>
          </div>
          <p className="text-[15px] sm:text-base leading-relaxed text-foreground/85 max-w-3xl">
            {assessment.insights.communication_style ?? ''}
          </p>
        </Tile>

        {/* History */}
        {history.length > 1 && !params.id && (
          <Tile className="mb-4">
            <Accordion type="single" collapsible>
              <AccordionItem value="history" className="border-0">
                <AccordionTrigger className="hover:no-underline py-1 [&[data-state=open]>svg]:rotate-90">
                  <div className="flex items-center gap-3">
                    <History className="w-4 h-4 text-foreground/50" />
                    <span className="dash-eyebrow uppercase text-foreground/60">
                      היסטוריית מילויים · {history.length}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-3">
                  <div className="space-y-1">
                    {history.map((row, i) => {
                      const t = rankedEmyth(row)[0];
                      const isLatest = i === 0;
                      return (
                        <Link
                          key={row.id}
                          to={`/personality/${row.id}`}
                          className={cn(
                            'flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition',
                            isLatest
                              ? 'bg-foreground/[0.04] hover:bg-foreground/[0.08]'
                              : 'hover:bg-foreground/[0.04]',
                          )}
                        >
                          <div className="text-sm tabular-nums text-foreground/80">
                            {format(new Date(row.created_at), 'd בMMM yyyy', { locale: he })}
                            {isLatest && (
                              <span className="ms-2 px-1.5 py-0.5 rounded bg-foreground/10 text-[9px] uppercase tracking-wider font-bold">עדכני</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold tabular-nums" style={{ color: EMYTH_COLOR[t.key] }}>
                              {EMYTH_AXIS_NAMES_HE[t.key]} {t.value}%
                            </span>
                            <span className="text-xs font-bold" style={{ color: DISC_COLOR_HEX[row.disc_primary] }}>
                              {DISC_COLOR_NAMES_HE[row.disc_primary]}
                            </span>
                            <ChevronLeft className="w-4 h-4 text-foreground/30" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Tile>
        )}

        {cooldown.active && !params.id && (
          <div className="flex items-center justify-center gap-2 text-xs text-foreground/40 mb-4">
            <RefreshCw className="w-3.5 h-3.5" />
            ניתן לחזור על השאלון בעוד {cooldown.days_remaining} ימים
          </div>
        )}
      </div>

    </DashboardWrapper>
  );
}

// ─── Wrapper with theme-aware backdrop ─────────────────────────────────

function DashboardWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-4 sm:-m-6 lg:-m-8 min-h-screen relative overflow-hidden bg-[#fafafd] dark:bg-[#0a0a14]">
      {/* Mesh gradient — very subtle in light, vivid in dark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] dark:opacity-[0.18]"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 600px 400px at 80% 0%, ${EMYTH_COLOR.EM}88 0%, transparent 50%),
            radial-gradient(ellipse 500px 400px at 20% 30%, ${EMYTH_COLOR.MN}66 0%, transparent 50%),
            radial-gradient(ellipse 700px 500px at 50% 100%, ${EMYTH_COLOR.AR}55 0%, transparent 50%)
          `,
        }}
      />
      {/* Dotted texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5] dark:opacity-100"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '32px 32px',
          color: 'rgba(15, 23, 42, 0.04)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// ─── Tile (theme-aware glass card with hover lift) ─────────────────────

interface TileProps {
  children: React.ReactNode;
  className?: string;
  /** Disable hover lift (used by some layouts) */
  noLift?: boolean;
}

function Tile({ children, className, noLift }: TileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.33, 1, 0.68, 1] }}
      whileHover={noLift ? undefined : { y: -3 }}
      className={cn(
        'relative rounded-3xl p-6 sm:p-8 transition-shadow',
        // Light: white surface with hairline border + soft shadow
        'bg-white border border-foreground/[0.08] shadow-[0_2px_8px_rgba(15,23,42,0.04)]',
        'hover:shadow-[0_8px_30px_rgba(15,23,42,0.08)]',
        // Dark: glass card
        'dark:bg-white/[0.04] dark:border-white/[0.08] dark:backdrop-blur',
        'dark:shadow-[0_4px_30px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]',
        'dark:hover:shadow-[0_8px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 rounded-3xl pointer-events-none opacity-0 dark:opacity-100"
        style={{
          background: 'radial-gradient(ellipse at top right, rgba(255,255,255,0.04), transparent 60%)',
        }}
      />
      <div className="relative h-full">{children}</div>
    </motion.div>
  );
}

// ─── BarRow (interactive bar) ──────────────────────────────────────────

function BarRow({
  label,
  value,
  color,
  delay,
  isHovered,
  isFaded,
  onMouseEnter,
  onMouseLeave,
}: {
  label: string;
  value: number;
  color: string;
  delay: number;
  isHovered: boolean;
  isFaded: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const counted = useCountUp(value, 1100, delay * 1000);
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onMouseEnter}
      onBlur={onMouseLeave}
      className={cn(
        'flex items-center gap-3 w-full px-2 py-1.5 rounded-lg transition-all outline-none',
        'hover:bg-foreground/[0.04] focus:bg-foreground/[0.04]',
        isFaded && 'opacity-40',
        isHovered && 'bg-foreground/[0.04]',
      )}
    >
      <div className="flex items-center gap-1.5 w-20 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs text-foreground/70 font-medium">{label}</span>
      </div>
      <div className="flex-1 h-1.5 bg-foreground/[0.06] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, delay, ease: [0.33, 1, 0.68, 1] }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <div className="text-xs font-bold tabular-nums w-10 text-end">{counted}%</div>
    </button>
  );
}

// ─── Insight tile ──────────────────────────────────────────────────────

interface InsightTileProps {
  icon: typeof Sparkles;
  label: string;
  accent: string;
  items: string[];
  numbered?: boolean;
}

function InsightTile({ icon: Icon, label, accent, items, numbered }: InsightTileProps) {
  return (
    <Tile className="h-full">
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${accent}22`, color: accent }}
        >
          <Icon className="w-4 h-4" strokeWidth={2.2} />
        </div>
        <div className="text-right">
          <div className="dash-eyebrow uppercase text-foreground/40">תובנה</div>
          <div className="text-base font-bold tracking-tight mt-0.5">{label}</div>
        </div>
      </div>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
            className="flex items-start gap-3 text-[14.5px] leading-relaxed text-foreground/85"
          >
            {numbered ? (
              <span
                className="text-base font-extrabold tabular-nums shrink-0 w-6"
                style={{ color: accent }}
              >
                {(i + 1).toString().padStart(2, '0')}
              </span>
            ) : (
              <span
                className="mt-2 w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: accent }}
              />
            )}
            <span>{item}</span>
          </motion.li>
        ))}
      </ul>
    </Tile>
  );
}

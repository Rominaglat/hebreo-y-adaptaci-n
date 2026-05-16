// True vector PDF using @react-pdf/renderer.
// Heebo bundled locally via @expo-google-fonts/heebo. Charts rendered as
// explicit SVG Path arcs (strokeDasharray and gradient strokes don't render
// reliably in @react-pdf so we draw the geometry directly).

import {
  Document,
  Page,
  Text,
  View,
  Image,
  Font,
  StyleSheet,
  Svg,
  Circle,
  Path,
  G,
} from '@react-pdf/renderer';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import type {
  DiscColor,
  EmythAxis,
  PersonalityAssessment,
} from '@/lib/personality/types';
import {
  DISC_COLOR_LABELS_HE,
  DISC_COLOR_NAMES_HE,
  EMYTH_AXIS_NAMES_HE,
} from '@/lib/personality/types';
import {
  PdfRocket,
  PdfPuzzle,
  PdfPalette,
  PdfSparkles,
  PdfAlertTriangle,
  PdfTarget,
  PdfMessagesSquare,
} from './PdfIcons';

// ─── font registration ────────────────────────────────────────────────

import HeeboLight from '@expo-google-fonts/heebo/300Light/Heebo_300Light.ttf';
import HeeboRegular from '@expo-google-fonts/heebo/400Regular/Heebo_400Regular.ttf';
import HeeboMedium from '@expo-google-fonts/heebo/500Medium/Heebo_500Medium.ttf';
import HeeboSemiBold from '@expo-google-fonts/heebo/600SemiBold/Heebo_600SemiBold.ttf';
import HeeboBold from '@expo-google-fonts/heebo/700Bold/Heebo_700Bold.ttf';
import HeeboExtraBold from '@expo-google-fonts/heebo/800ExtraBold/Heebo_800ExtraBold.ttf';
import HeeboBlack from '@expo-google-fonts/heebo/900Black/Heebo_900Black.ttf';

Font.register({
  family: 'Heebo',
  fonts: [
    { src: HeeboLight, fontWeight: 300 },
    { src: HeeboRegular, fontWeight: 400 },
    { src: HeeboMedium, fontWeight: 500 },
    { src: HeeboSemiBold, fontWeight: 600 },
    { src: HeeboBold, fontWeight: 700 },
    { src: HeeboExtraBold, fontWeight: 800 },
    { src: HeeboBlack, fontWeight: 900 },
  ],
});

// Don't break Hebrew words at line ends.
Font.registerHyphenationCallback((word) => [word]);

// ─── color tokens ─────────────────────────────────────────────────────

const C = {
  ink: '#0f172a',
  ink2: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  hairline: '#eef0f3',
};

const EMYTH_COLOR: Record<EmythAxis, string> = {
  EM: '#CE1EE8',
  MN: '#1EE8DB',
  AR: '#E88A1E',
};

const DISC_COLOR_HEX: Record<DiscColor, string> = {
  R: '#E5484D',
  Y: '#F5A524',
  G: '#2BB673',
  B: '#3B82F6',
};

type IconCmp = typeof PdfRocket;
const EMYTH_ICON: Record<EmythAxis, IconCmp> = {
  EM: PdfRocket,
  MN: PdfPuzzle,
  AR: PdfPalette,
};

// ─── helpers ──────────────────────────────────────────────────────────

// UI mirrors PersonalityResultsView: use SHARES everywhere (sum to 100).
// v3 shares are derived from strengths so dominance is still visible.
function rankedEmyth(scores: PersonalityAssessment['emyth_scores']) {
  return [
    { key: 'EM' as EmythAxis, value: scores.entrepreneur },
    { key: 'MN' as EmythAxis, value: scores.manager },
    { key: 'AR' as EmythAxis, value: scores.artisan },
  ].sort((a, b) => b.value - a.value);
}

function getActionTitle(a: PersonalityAssessment): string {
  // v3 ships a pre-computed Hebrew dominance label; v1 falls back to the share heuristic.
  if (a.emyth_scores.dominance_label) {
    const dashIdx = a.emyth_scores.dominance_label.indexOf(' — ');
    return dashIdx > 0
      ? a.emyth_scores.dominance_label.slice(0, dashIdx)
      : a.emyth_scores.dominance_label;
  }
  const ranked = rankedEmyth(a.emyth_scores);
  const [first, second] = ranked;
  if (first.value >= 50) return EMYTH_AXIS_NAMES_HE[first.key];
  if (second.value >= 25) {
    return `${EMYTH_AXIS_NAMES_HE[first.key]}-${EMYTH_AXIS_NAMES_HE[second.key]}`;
  }
  return EMYTH_AXIS_NAMES_HE[first.key];
}

// ─── stylesheet ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 28,
    paddingHorizontal: 36,
    backgroundColor: '#ffffff',
    fontFamily: 'Heebo',
    fontSize: 10,
    color: C.ink,
    lineHeight: 1.5,
    // Hebrew text needs RTL direction so neutral characters (periods,
    // commas, parentheses) sit at the end of the sentence visually
    // (= left edge in RTL reading).
    direction: 'rtl',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  logo: {
    height: 70,
    objectFit: 'contain',
  },
  subHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
  },
  eyebrow: {
    fontSize: 8,
    fontWeight: 700,
    color: C.faint,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    textAlign: 'right',
    lineHeight: 1,
  },
  hero: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginBottom: 10,
  },
  tile: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
  },
  // Anchor every tile heading to the right edge.
  tileHeader: {
    alignItems: 'flex-end',
  },
  ringsTile: {
    flex: 1.4,
  },
  donutTile: {
    flex: 1,
  },
  bigTitle: {
    fontWeight: 800,
    color: C.ink,
    marginTop: 2,
    textAlign: 'right',
    lineHeight: 1.1,
  },
  proseRtl: {
    fontSize: 10,
    color: C.ink2,
    lineHeight: 1.6,
    marginTop: 8,
    textAlign: 'right',
  },
  ringsCenter: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  legendRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'center',
    gap: 18,
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
  },
  legendItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  legendIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenter: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  // Bars fill from the right edge so the visual reading matches RTL.
  barRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  barLabel: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    width: 50,
  },
  barTrack: {
    flex: 1,
    height: 4,
    backgroundColor: C.hairline,
    borderRadius: 999,
    flexDirection: 'row-reverse',
  },
  insightRow: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginBottom: 10,
  },
  insightTile: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 11,
  },
  insightHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  insightIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightItem: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 5,
    marginBottom: 5,
  },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 999,
    marginTop: 4,
  },
});

// ─── SVG arc helper ───────────────────────────────────────────────────

interface ArcProps {
  cx: number;
  cy: number;
  r: number;
  /** Arc start angle in radians (0 = top / 12 o'clock; positive = clockwise). */
  startAngle?: number;
  /** Arc end angle in radians. */
  endAngle: number;
  color: string;
  strokeWidth: number;
  rounded?: boolean;
}

function ArcPath({
  cx,
  cy,
  r,
  startAngle = 0,
  endAngle,
  color,
  strokeWidth,
  rounded = false,
}: ArcProps) {
  const sweep = endAngle - startAngle;
  if (sweep <= 0.0001) return null;
  if (sweep >= 2 * Math.PI - 0.001) {
    return (
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap={rounded ? 'round' : 'butt'}
      />
    );
  }
  const startX = cx + r * Math.sin(startAngle);
  const startY = cy - r * Math.cos(startAngle);
  const endX = cx + r * Math.sin(endAngle);
  const endY = cy - r * Math.cos(endAngle);
  const largeArc = sweep > Math.PI ? 1 : 0;
  return (
    <Path
      d={`M ${startX},${startY} A ${r},${r} 0 ${largeArc} 1 ${endX},${endY}`}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap={rounded ? 'round' : 'butt'}
    />
  );
}

// ─── Activity rings ───────────────────────────────────────────────────

interface ActivityRingsSvgProps {
  rings: { key: string; value: number; color: string }[];
  size: number;
  thickness: number;
  gap: number;
}

function ActivityRingsSvg({ rings, size, thickness, gap }: ActivityRingsSvgProps) {
  const cx = size / 2;
  const cy = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rings.map((r, i) => {
        const radius = size / 2 - thickness / 2 - i * (thickness + gap);
        const fraction = Math.max(0, Math.min(100, r.value)) / 100;
        const endAngle = fraction * 2 * Math.PI;
        return (
          <G key={r.key}>
            <Circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={r.color}
              strokeOpacity={0.15}
              strokeWidth={thickness}
            />
            <ArcPath
              cx={cx}
              cy={cy}
              r={radius}
              endAngle={endAngle}
              color={r.color}
              strokeWidth={thickness}
              rounded
            />
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Proportional donut ───────────────────────────────────────────────

interface DonutSvgProps {
  segments: { key: string; value: number; color: string }[];
  size: number;
  thickness: number;
}

function DonutSvg({ segments, size, thickness }: DonutSvgProps) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const GAP_RAD = (3 / 360) * 2 * Math.PI;

  let cursor = 0;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={C.hairline}
        strokeWidth={thickness}
      />
      {total > 0 &&
        segments.map((seg) => {
          const value = Math.max(0, seg.value);
          const fraction = value / total;
          const startAngle = cursor + GAP_RAD / 2;
          const endAngle = cursor + fraction * 2 * Math.PI - GAP_RAD / 2;
          cursor += fraction * 2 * Math.PI;
          if (endAngle - startAngle <= 0) return null;
          return (
            <ArcPath
              key={seg.key}
              cx={cx}
              cy={cy}
              r={radius}
              startAngle={startAngle}
              endAngle={endAngle}
              color={seg.color}
              strokeWidth={thickness}
            />
          );
        })}
    </Svg>
  );
}

// ─── document ─────────────────────────────────────────────────────────

interface PdfDocumentProps {
  assessment: PersonalityAssessment;
  userName?: string;
  tenantName?: string;
  tenantLogoUrl?: string | null;
}

export function PdfDocument({
  assessment,
  userName,
  tenantName,
  tenantLogoUrl,
}: PdfDocumentProps) {
  const { emyth_scores, disc_scores, disc_primary, insights } = assessment;
  const dateLabel = format(new Date(assessment.created_at), 'd בMMMM yyyy', { locale: he });
  const emythRanked = rankedEmyth(emyth_scores);
  const top = emythRanked[0];
  const actionTitle = getActionTitle(assessment);

  const ringsData = emythRanked.map((r) => ({
    key: r.key,
    value: r.value,
    color: EMYTH_COLOR[r.key],
    label: EMYTH_AXIS_NAMES_HE[r.key],
  }));

  // Donut, bars and center all read the same share value (sum to 100)
  // so the donut arc, bar width and center number stay in agreement.
  const discSegments = (['R', 'Y', 'G', 'B'] as DiscColor[]).map((c) => ({
    key: c,
    value: disc_scores[c],
    color: DISC_COLOR_HEX[c],
    label: DISC_COLOR_NAMES_HE[c],
    caption: DISC_COLOR_LABELS_HE[c],
  }));

  return (
    <Document>
      {/* ───────────────────────── Page 1 ───────────────────────── */}
      <Page size="A4" style={styles.page}>
        {/* Top centered logo */}
        {tenantLogoUrl ? (
          <View style={styles.logoWrap}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={tenantLogoUrl} style={styles.logo} />
          </View>
        ) : tenantName ? (
          <View style={[styles.logoWrap, { paddingVertical: 12 }]}>
            <Text style={{ fontSize: 14, fontWeight: 700, textAlign: 'center' }}>
              {tenantName}
            </Text>
          </View>
        ) : null}

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.eyebrow}>הפרופיל האישיותי שלך</Text>
            <Text style={{ fontSize: 9.5, color: C.muted, marginTop: 3, textAlign: 'right' }}>
              {dateLabel}
            </Text>
          </View>
          {userName ? (
            <View>
              <Text style={{ fontSize: 9.5, color: C.muted, textAlign: 'left' }}>
                {userName}
              </Text>
            </View>
          ) : <View />}
        </View>

        {/* Hero — rings + donut */}
        <View style={styles.hero}>
          {/* Activity Rings tile */}
          <View style={[styles.tile, styles.ringsTile, { overflow: 'hidden' }]}>
            <View style={styles.tileHeader}>
              <Text style={styles.eyebrow}>מבנה האישיות</Text>
              <Text style={[styles.bigTitle, { fontSize: 22 }]}>{actionTitle}</Text>
            </View>

            <View style={styles.ringsCenter}>
              <View style={{ position: 'relative', width: 200, height: 200 }}>
                <ActivityRingsSvg
                  rings={ringsData}
                  size={200}
                  thickness={20}
                  gap={4}
                />
                {/* Center label */}
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 200,
                    height: 200,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: EMYTH_COLOR[top.key],
                      marginBottom: 1,
                      textAlign: 'center',
                      lineHeight: 1.1,
                    }}
                  >
                    {EMYTH_AXIS_NAMES_HE[top.key]}
                  </Text>
                  <View style={{ position: 'relative' }}>
                    <Text
                      style={{
                        fontSize: 30,
                        fontWeight: 300,
                        color: C.ink,
                        letterSpacing: -1,
                        lineHeight: 1,
                      }}
                    >
                      {top.value}
                    </Text>
                    <Text
                      style={{
                        position: 'absolute',
                        left: '100%',
                        top: 5,
                        marginLeft: 2,
                        fontSize: 12,
                        fontWeight: 400,
                        color: C.muted,
                        lineHeight: 1,
                      }}
                    >
                      %
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Legend — label and value as separate Text blocks so the bidi
                algorithm can't bleed characters across colors. */}
            <View style={styles.legendRow}>
              {emythRanked.map((r) => {
                const Icon = EMYTH_ICON[r.key];
                return (
                  <View key={r.key} style={styles.legendItem}>
                    <View style={[styles.legendIconBadge, { backgroundColor: EMYTH_COLOR[r.key] }]}>
                      <Icon size={10} color="#ffffff" strokeWidth={2.4} />
                    </View>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5 }}>
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: C.muted,
                          lineHeight: 1.2,
                        }}
                      >
                        {EMYTH_AXIS_NAMES_HE[r.key]}
                      </Text>
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: EMYTH_COLOR[r.key],
                          lineHeight: 1.2,
                        }}
                      >
                        {r.value}%
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Communication Donut tile */}
          <View style={[styles.tile, styles.donutTile]}>
            <View style={styles.tileHeader}>
              <Text style={styles.eyebrow}>סגנון תקשורת</Text>
              <Text style={[styles.bigTitle, { fontSize: 16 }]}>
                <Text>{DISC_COLOR_NAMES_HE[disc_primary]}</Text>
                <Text style={{ color: C.faint }}> · </Text>
                <Text style={{ color: DISC_COLOR_HEX[disc_primary] }}>
                  {DISC_COLOR_LABELS_HE[disc_primary]}
                </Text>
              </Text>
            </View>

            <View style={styles.donutCenter}>
              <View style={{ position: 'relative', width: 145, height: 145 }}>
                <DonutSvg segments={discSegments} size={145} thickness={20} />
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 145,
                    height: 145,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: DISC_COLOR_HEX[disc_primary],
                      marginBottom: 1,
                      textAlign: 'center',
                      lineHeight: 1.1,
                    }}
                  >
                    {DISC_COLOR_NAMES_HE[disc_primary]}
                  </Text>
                  <View style={{ position: 'relative' }}>
                    <Text
                      style={{
                        fontSize: 24,
                        fontWeight: 300,
                        color: C.ink,
                        letterSpacing: -0.5,
                        lineHeight: 1,
                      }}
                    >
                      {disc_scores[disc_primary]}
                    </Text>
                    <Text
                      style={{
                        position: 'absolute',
                        left: '100%',
                        top: 4,
                        marginLeft: 2,
                        fontSize: 10,
                        color: C.muted,
                        lineHeight: 1,
                      }}
                    >
                      %
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Bars — share per color (sums to 100, matches donut arcs). */}
            <View style={{ marginTop: 2 }}>
              {discSegments
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((s) => (
                  <View key={s.key} style={styles.barRow}>
                    <View style={styles.barLabel}>
                      <View
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 999,
                          backgroundColor: s.color,
                        }}
                      />
                      <Text style={{ fontSize: 9, color: C.ink2, textAlign: 'right' }}>
                        {s.label}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={{
                          width: `${s.value}%`,
                          height: 4,
                          backgroundColor: s.color,
                          borderRadius: 999,
                        }}
                      />
                    </View>
                    <Text
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: C.ink,
                        width: 22,
                        textAlign: 'left',
                      }}
                    >
                      {s.value}%
                    </Text>
                  </View>
                ))}
            </View>
          </View>
        </View>

        {/* Combined-type tile */}
        <View style={[styles.tile, { marginBottom: 10 }]}>
          <View style={styles.tileHeader}>
            <Text style={styles.eyebrow}>הצירוף שלך</Text>
            <Text style={[styles.bigTitle, { fontSize: 16 }]}>
              <Text style={{ color: EMYTH_COLOR[top.key] }}>
                {EMYTH_AXIS_NAMES_HE[top.key]}
              </Text>
              <Text style={{ color: C.faint }}> · </Text>
              <Text style={{ color: DISC_COLOR_HEX[disc_primary] }}>
                {DISC_COLOR_NAMES_HE[disc_primary]}
              </Text>
            </Text>
          </View>
          <Text style={styles.proseRtl}>{insights.summary ?? ''}</Text>
        </View>
      </Page>

      {/* ───────────────────────── Page 2 ───────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={[styles.subHeader, { marginBottom: 10 }]}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.eyebrow}>הניתוח · המשך</Text>
            <Text style={{ fontSize: 9.5, color: C.muted, marginTop: 3, textAlign: 'right' }}>
              {dateLabel}
            </Text>
          </View>
          {userName ? (
            <View>
              <Text style={{ fontSize: 9.5, color: C.muted, textAlign: 'left' }}>
                {userName}
              </Text>
            </View>
          ) : <View />}
        </View>

        {/* Insight tiles row — compressed for one-page fit */}
        <View style={styles.insightRow}>
          <InsightTile
            label="חוזקות"
            accent="#22c55e"
            Icon={PdfSparkles}
            items={insights.strengths ?? []}
          />
          <InsightTile
            label="אתגרים"
            accent="#f59e0b"
            Icon={PdfAlertTriangle}
            items={insights.weaknesses ?? []}
          />
          <InsightTile
            label="המלצות לפעולה"
            accent="#a78bfa"
            Icon={PdfTarget}
            items={insights.action_recommendations ?? []}
            numbered
          />
        </View>

        {/* Communication-style paragraph — compact */}
        <View style={[styles.tile, { marginTop: 0 }]}>
          <View style={styles.insightHeader}>
            <View style={[styles.insightIcon, { backgroundColor: '#3B82F622' }]}>
              <PdfMessagesSquare size={12} color="#3B82F6" />
            </View>
            <View style={{ alignItems: 'flex-end', flex: 1 }}>
              <Text style={styles.eyebrow}>איך לעבוד איתך</Text>
              <Text style={[styles.bigTitle, { fontSize: 13, marginTop: 1 }]}>
                סגנון תקשורת
              </Text>
            </View>
          </View>
          <Text style={[styles.proseRtl, { marginTop: 4, fontSize: 9.5 }]}>
            {insights.communication_style ?? ''}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

// ─── insight tile ─────────────────────────────────────────────────────

function InsightTile({
  label,
  accent,
  Icon,
  items,
  numbered,
}: {
  label: string;
  accent: string;
  Icon: IconCmp;
  items: string[];
  numbered?: boolean;
}) {
  return (
    <View style={styles.insightTile}>
      <View style={styles.insightHeader}>
        <View style={[styles.insightIcon, { backgroundColor: `${accent}22` }]}>
          <Icon size={12} color={accent} />
        </View>
        <View style={{ alignItems: 'flex-end', flex: 1 }}>
          <Text style={styles.eyebrow}>תובנה</Text>
          <Text
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: C.ink,
              marginTop: 1,
              textAlign: 'right',
              lineHeight: 1.1,
            }}
          >
            {label}
          </Text>
        </View>
      </View>
      <View>
        {items.map((item, i) => (
          <View key={i} style={styles.insightItem}>
            {numbered ? (
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: accent,
                  width: 13,
                  textAlign: 'left',
                }}
              >
                {(i + 1).toString().padStart(2, '0')}
              </Text>
            ) : (
              <View style={[styles.bullet, { backgroundColor: accent }]} />
            )}
            <Text
              style={{
                fontSize: 9,
                color: C.ink2,
                lineHeight: 1.45,
                flex: 1,
                textAlign: 'right',
              }}
            >
              {item}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

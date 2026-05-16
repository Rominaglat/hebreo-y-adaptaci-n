// Apple Watch-style three-nested-rings visualization for the 3 entrepreneurial roles.
// Pure SVG; theme-aware track color; supports hover-highlight via `hoveredKey`.

import { motion, AnimatePresence } from 'framer-motion';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useCountUp } from './useCountUp';

export interface RingDatum {
  /** Stable key */
  key: string;
  /** Percentage 0–100 (drives the arc length) */
  value: number;
  /** Solid hex color */
  color: string;
  /** Optional darker shade for the gradient start (auto-derived if omitted) */
  colorDark?: string;
  /** Hebrew label, shown next to the ring */
  label: string;
}

interface ActivityRingsProps {
  /** Rings rendered outer-to-inner. Pass exactly 3 entries. */
  rings: RingDatum[];
  /** Outer diameter in px. Default 320. */
  size?: number;
  /** Stroke width per ring. Default 32. */
  thickness?: number;
  /** Gap between rings. Default 8. */
  gap?: number;
  /** Disable entry animation (used in PDF). */
  animated?: boolean;
  /** Optional key whose ring is currently hovered/active — used to dim the others. */
  hoveredKey?: string | null;
  className?: string;
}

export function ActivityRings({
  rings,
  size = 320,
  thickness = 32,
  gap = 8,
  animated = true,
  hoveredKey,
  className,
}: ActivityRingsProps) {
  if (rings.length !== 3) {
    throw new Error('ActivityRings expects exactly 3 rings');
  }

  // Determine the focused ring: hovered one if set, else the dominant.
  const dominant = useMemo(() => [...rings].sort((a, b) => b.value - a.value)[0], [rings]);
  const focused = hoveredKey
    ? rings.find((r) => r.key === hoveredKey) ?? dominant
    : dominant;

  const ringSpec = rings.map((r, i) => {
    const radius = size / 2 - thickness / 2 - i * (thickness + gap);
    const circumference = 2 * Math.PI * radius;
    const arcLength = (Math.max(0, Math.min(100, r.value)) / 100) * circumference;
    return { ...r, radius, circumference, arcLength, index: i };
  });

  // The label should fit inside the innermost ring's hole. Compute that
  // padding from the geometry so center text never collides with strokes.
  const innerEdgeRadius = ringSpec[ringSpec.length - 1].radius - thickness / 2;
  const labelPadding = Math.max(0, size / 2 - innerEdgeRadius + 4);

  const focusedValue = useCountUp(focused.value, 1300, animated ? 200 : 0);

  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // Rotate so arcs start at 12 o'clock and grow clockwise.
        style={{ transform: 'rotate(-90deg)' }}
      >
        <defs>
          {ringSpec.map((r) => {
            const dark = r.colorDark ?? mixWithBlack(r.color, 0.35);
            return (
              <linearGradient
                key={`grad-${r.key}`}
                id={`ring-grad-${r.key}`}
                gradientUnits="userSpaceOnUse"
                x1="0" y1="0"
                x2={size} y2={size}
              >
                <stop offset="0%" stopColor={dark} />
                <stop offset="100%" stopColor={r.color} />
              </linearGradient>
            );
          })}
        </defs>

        {ringSpec.map((r) => {
          const cx = size / 2;
          const cy = size / 2;
          const isFaded = !!hoveredKey && hoveredKey !== r.key;
          return (
            <motion.g
              key={r.key}
              animate={{ opacity: isFaded ? 0.3 : 1 }}
              transition={{ duration: 0.25 }}
            >
              {/* Track */}
              <circle
                cx={cx}
                cy={cy}
                r={r.radius}
                fill="none"
                stroke={r.color}
                strokeOpacity={0.13}
                strokeWidth={thickness}
              />
              {/* Filled arc */}
              <motion.circle
                cx={cx}
                cy={cy}
                r={r.radius}
                fill="none"
                stroke={`url(#ring-grad-${r.key})`}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={`${r.circumference} ${r.circumference}`}
                initial={
                  animated
                    ? { strokeDashoffset: r.circumference }
                    : { strokeDashoffset: r.circumference - r.arcLength }
                }
                animate={{ strokeDashoffset: r.circumference - r.arcLength }}
                transition={{
                  duration: animated ? 1.2 : 0,
                  delay: animated ? r.index * 0.18 : 0,
                  ease: [0.33, 1, 0.68, 1],
                }}
              />
            </motion.g>
          );
        })}
      </svg>

      {/* Center label — sized & positioned to fit inside the inner ring's hole. */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none leading-none"
        style={{ padding: labelPadding }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={focused.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center justify-center"
          >
            <div
              className="text-base sm:text-lg font-semibold tracking-tight"
              style={{ color: focused.color }}
            >
              {focused.label}
            </div>
            <div className="dash-display-num text-[56px] sm:text-[68px] font-light tracking-tight text-foreground mt-1">
              <span className="relative inline-block">
                <span className="tabular-nums">{focusedValue}</span>
                <span
                  className="absolute font-normal opacity-50 leading-none"
                  style={{
                    left: '100%',
                    top: '0.18em',
                    fontSize: '0.36em',
                    marginLeft: '0.08em',
                  }}
                >%</span>
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────

function mixWithBlack(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const m = (c: number) => Math.round(c * (1 - amount));
  return `#${[m(r), m(g), m(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

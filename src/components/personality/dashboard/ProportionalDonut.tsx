// Single-ring proportional donut for the 4 communication-style colors.
// Theme-aware track. Supports hover-highlight via `hoveredKey`.

import { Fragment, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useCountUp } from './useCountUp';

export interface DonutSegment {
  key: string;
  value: number;
  color: string;
  label: string;
  /** Optional caption, e.g. "משימתי" */
  caption?: string;
}

interface ProportionalDonutProps {
  segments: DonutSegment[];
  /** Diameter in px. Default 240. */
  size?: number;
  /** Stroke width. Default 36. */
  thickness?: number;
  /** The segment to highlight in the center. Defaults to the largest value. */
  primaryKey?: string;
  /** Optional key whose segment is currently hovered/active — dims the others. */
  hoveredKey?: string | null;
  /** Disable entry animation */
  animated?: boolean;
  className?: string;
}

const GAP_DEG = 3;

export function ProportionalDonut({
  segments,
  size = 240,
  thickness = 36,
  primaryKey,
  hoveredKey,
  animated = true,
  className,
}: ProportionalDonutProps) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const gapLength = (GAP_DEG / 360) * circumference;

  const largest = useMemo(
    () => [...segments].sort((a, b) => b.value - a.value)[0],
    [segments],
  );
  const baseFocus = primaryKey
    ? segments.find((s) => s.key === primaryKey) ?? largest
    : largest;
  const focused = hoveredKey
    ? segments.find((s) => s.key === hoveredKey) ?? baseFocus
    : baseFocus;
  const focusedValue = useCountUp(focused.value, 1100, animated ? 200 : 0);

  let offset = 0;

  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Track — theme-aware via currentColor on a wrapper */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.06}
          strokeWidth={thickness}
        />
        {total > 0 && segments.map((seg, i) => {
          const value = Math.max(0, seg.value);
          const fraction = value / total;
          const arcLength = Math.max(0, fraction * circumference - gapLength);
          if (arcLength <= 0) return null;
          const dasharray = `${arcLength} ${circumference - arcLength}`;
          const dashoffset = -offset;
          offset += fraction * circumference;
          const isFaded = !!hoveredKey && hoveredKey !== seg.key;
          return (
            <Fragment key={seg.key}>
              <motion.circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
                strokeLinecap="butt"
                initial={animated ? { opacity: 0 } : { opacity: 1 }}
                animate={{ opacity: isFaded ? 0.25 : 1 }}
                transition={{ duration: 0.4, delay: animated && !hoveredKey ? 0.3 + i * 0.08 : 0 }}
              />
            </Fragment>
          );
        })}
      </svg>

      {/* Center label — fits inside the donut hole. */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none leading-none"
        style={{ padding: thickness + 4 }}
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
              className="text-sm font-semibold tracking-tight"
              style={{ color: focused.color }}
            >
              {focused.label}
            </div>
            <div className="dash-display-num text-[40px] sm:text-[48px] font-light tracking-tight text-foreground mt-0.5">
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
            {focused.caption && (
              <div className="dash-eyebrow text-muted-foreground mt-1.5 uppercase">
                {focused.caption}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

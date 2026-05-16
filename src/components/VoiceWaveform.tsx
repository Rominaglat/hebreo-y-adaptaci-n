import { cn } from '@/lib/utils';

interface VoiceWaveformProps {
  /** Array of audio levels in 0..1 range. Length determines bar count. */
  levels: number[];
  /** Optional className for the container */
  className?: string;
  /** Bar color (CSS color or hsl(var(--...))). Defaults to current text color. */
  color?: string;
  /** Minimum bar height as a fraction of container height (0..1). */
  minHeight?: number;
}

/**
 * Renders an animated waveform from an array of audio levels.
 * Bars resize smoothly via CSS transitions; the array updates ~20 times/sec
 * from useVoiceInput's analyser.
 */
export function VoiceWaveform({
  levels,
  className,
  color = 'currentColor',
  minHeight = 0.12,
}: VoiceWaveformProps) {
  return (
    <div
      className={cn('flex items-center justify-center gap-[3px] w-full h-full', className)}
      aria-hidden
    >
      {levels.map((level, i) => {
        const h = Math.max(minHeight, Math.min(1, level));
        return (
          <span
            key={i}
            className="block w-[3px] rounded-full transition-[height] duration-75 ease-out"
            style={{
              height: `${h * 100}%`,
              backgroundColor: color,
              opacity: 0.85,
            }}
          />
        );
      })}
    </div>
  );
}

/** Format milliseconds as M:SS */
export function formatRecordingTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

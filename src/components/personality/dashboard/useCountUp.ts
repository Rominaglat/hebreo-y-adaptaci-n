import { useEffect, useRef, useState } from 'react';

/**
 * Counts a number up from 0 to `target` over `duration` ms with an ease-out-quart curve.
 * Resets and re-counts whenever `target` changes.
 */
export function useCountUp(target: number, duration = 1400, delay = 0): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    let cancelled = false;
    const startCount = () => {
      const start = performance.now();
      const tick = (t: number) => {
        if (cancelled) return;
        const elapsed = t - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4); // easeOutQuart
        setValue(Math.round(target * eased));
        if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const timeoutId = window.setTimeout(startCount, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, delay]);

  return value;
}

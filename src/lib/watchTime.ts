// Measures how long a lesson video actually plays. No I/O — the player hook
// (useWatchTime) feeds it play/pause events and sends what take() returns to
// the record_lesson_watch_time() RPC.

/** How often the player reports watch time while a video plays. */
export const FLUSH_INTERVAL_MS = 30_000;

/**
 * The longest stretch a single take() can credit. Takes happen every
 * FLUSH_INTERVAL_MS while playing, so a longer segment means the device slept
 * or the tab was frozen mid-play — not time anyone spent watching.
 */
export const MAX_SEGMENT_MS = 40_000;

/**
 * A playing video whose position moved less than this between two reports is
 * frozen (an error screen, a dead stream), however its player labels it.
 */
export const MIN_PROGRESS_S = 0.5;

export class WatchClock {
  private startedAt: number | null = null;
  private pendingMs = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get playing(): boolean {
    return this.startedAt !== null;
  }

  play(): void {
    if (this.startedAt === null) this.startedAt = this.now();
  }

  pause(): void {
    if (this.startedAt === null) return;
    this.closeSegment();
    this.startedAt = null;
  }

  /** Whole seconds played since the last take. The sub-second rest carries over. */
  take(): number {
    if (this.startedAt !== null) {
      this.closeSegment();
      this.startedAt = this.now();
    }
    const seconds = Math.floor(this.pendingMs / 1000);
    this.pendingMs -= seconds * 1000;
    return seconds;
  }

  /**
   * Drops the open stretch — the video's position didn't move, so nobody was
   * watching it — and keeps timing from now, in case playback recovers
   * without the player saying so. Time already closed by a pause is kept.
   */
  discardSegment(): void {
    if (this.startedAt !== null) this.startedAt = this.now();
  }

  /** Puts back seconds from a take whose send failed, so the next send retries them. */
  restore(seconds: number): void {
    if (seconds > 0) this.pendingMs += seconds * 1000;
  }

  private closeSegment(): void {
    const elapsed = this.now() - (this.startedAt as number);
    this.pendingMs += Math.min(Math.max(0, elapsed), MAX_SEGMENT_MS);
  }
}

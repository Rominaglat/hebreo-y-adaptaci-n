import { useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { WatchClock, FLUSH_INTERVAL_MS, MIN_PROGRESS_S } from '@/lib/watchTime';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// A pause shorter than this keeps its seconds for the next send instead of
// firing a request — seeking and buffering toggle play state constantly.
const MIN_SEND_ON_PAUSE_S = 5;

/** The video's current time in seconds, or null if the player can't say. */
export type ReadPosition = () => number | null | Promise<number | null>;

/**
 * Reports how long a lesson video actually plays, so rewatching a lesson
 * counts toward the student's weekly study time.
 *
 * The player calls playing() / stopped() from its state events. Time is sent
 * every 30 s while playing, on pause, when the tab is hidden and when the
 * lesson changes. Writes go through record_lesson_watch_time(), which never
 * credits more than the real time elapsed — this hook only reports.
 *
 * A 30 s stretch in which readPosition didn't move is not credited: a player
 * stuck on an error screen can stay "playing" without ever sending a pause.
 */
export function useWatchTime(lessonId: string, readPosition?: ReadPosition) {
  const { user, session } = useAuth();
  const userId = user?.id;

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = session?.access_token ?? null;

  const readPositionRef = useRef(readPosition);
  readPositionRef.current = readPosition;
  // Video position at the last report (or at play), to spot a frozen video.
  const lastPositionRef = useRef<number | null>(null);
  // The last report found the video frozen: time since then isn't credited
  // on pause or on the way out either, until the video moves or plays again.
  const stalledRef = useRef(false);

  const clockRef = useRef<WatchClock | null>(null);
  const sendRef = useRef<((minSeconds: number) => void) | null>(null);

  const currentPosition = useCallback(async (): Promise<number | null> => {
    try {
      const p = await readPositionRef.current?.();
      return typeof p === 'number' && Number.isFinite(p) ? p : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!userId || !lessonId) return;
    const clock = new WatchClock();
    clockRef.current = clock;
    let sending = false;

    const send = async (minSeconds: number) => {
      if (sending) return;
      const seconds = clock.take();
      if (seconds < minSeconds) { clock.restore(seconds); return; }
      sending = true;
      const { error } = await supabase.rpc('record_lesson_watch_time', { p_lesson_id: lessonId, p_seconds: seconds });
      sending = false;
      if (error) clock.restore(seconds);
    };
    sendRef.current = (minSeconds) => { void send(minSeconds); };

    // For a page that may be going away: keepalive lets the request outlive
    // the tab, which a normal supabase-js call does not.
    const sendNow = () => {
      const seconds = clock.take();
      if (seconds < 1) return;
      if (DEMO_MODE || !SUPABASE_URL || !tokenRef.current) { clock.restore(seconds); void send(1); return; }
      void fetch(`${SUPABASE_URL}/rest/v1/rpc/record_lesson_watch_time`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ p_lesson_id: lessonId, p_seconds: seconds }),
      }).then((r) => { if (!r.ok) clock.restore(seconds); }, () => clock.restore(seconds));
    };

    const tick = async () => {
      if (!clock.playing) return;
      const position = await currentPosition();
      if (!clock.playing) return;
      const last = lastPositionRef.current;
      lastPositionRef.current = position;
      if (position !== null && last !== null && Math.abs(position - last) < MIN_PROGRESS_S) {
        clock.discardSegment();
        stalledRef.current = true;
        return;
      }
      stalledRef.current = false;
      void send(1);
    };
    const timer = window.setInterval(() => { void tick(); }, FLUSH_INTERVAL_MS);
    const flushNow = () => {
      if (stalledRef.current) clock.discardSegment();
      sendNow();
    };
    const onVisibility = () => {
      // Audio keeps playing in a background tab, so hiding doesn't pause the
      // clock — it only makes sure the time so far is not lost.
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
      flushNow();
      clock.pause();
      if (clockRef.current === clock) { clockRef.current = null; sendRef.current = null; }
      lastPositionRef.current = null;
      stalledRef.current = false;
    };
  }, [lessonId, userId, currentPosition]);

  const playing = useCallback(() => {
    const clock = clockRef.current;
    if (!clock || clock.playing) return;
    clock.play();
    lastPositionRef.current = null;
    stalledRef.current = false;
    void currentPosition().then((p) => { if (clockRef.current === clock) lastPositionRef.current = p; });
  }, [currentPosition]);
  const stopped = useCallback(() => {
    if (stalledRef.current) clockRef.current?.discardSegment();
    clockRef.current?.pause();
    sendRef.current?.(MIN_SEND_ON_PAUSE_S);
  }, []);

  return useMemo(() => ({ playing, stopped }), [playing, stopped]);
}

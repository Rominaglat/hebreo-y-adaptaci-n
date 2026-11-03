import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'student-1' }, session: { access_token: 'token-1' } }),
}));
vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'anon-key');
vi.stubEnv('VITE_DEMO_MODE', '');

const { useWatchTime } = await import('./useWatchTime');

type Api = ReturnType<typeof useWatchTime>;
let api: Api;
// Playback position the fake player reports; null = player can't say.
let position: () => number | null = () => null;
function Probe({ lessonId }: { lessonId: string }) {
  api = useWatchTime(lessonId, () => position());
  return null;
}

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const sentSeconds = () => rpc.mock.calls.map(([, args]) => (args as { p_seconds: number }).p_seconds);
const beaconBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

beforeEach(() => {
  vi.useFakeTimers();
  position = () => null;
  rpc.mockReset().mockResolvedValue({ data: 0, error: null });
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(<Probe lessonId="lesson-1" />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useWatchTime', () => {
  it('reports watch time every 30 s while the video plays', async () => {
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(sentSeconds()).toEqual([30, 30, 30]);
    expect(rpc).toHaveBeenCalledWith('record_lesson_watch_time', { p_lesson_id: 'lesson-1', p_seconds: 30 });
  });

  it('credits nothing while the video is frozen, and resumes when it moves again', async () => {
    let pos = 0;
    let frozen = false;
    position = () => pos;
    const tick = setInterval(() => { if (!frozen) pos += 1; }, 1000);
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(29_500); }); // moving
    frozen = true; // e.g. the player shows an error screen and sends no event
    await act(async () => { await vi.advanceTimersByTimeAsync(60_500); }); // reports at 30 s, 60 s, 90 s
    frozen = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    clearInterval(tick);
    expect(sentSeconds()).toEqual([30, 30]);
  });

  it('does not credit a frozen stretch on the way out either', async () => {
    position = () => 12; // never moves
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); // frozen from the start
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    act(() => root.render(<Probe lessonId="lesson-2" />)); // student leaves the lesson
    expect(sentSeconds()).toEqual([]);
    expect(beaconBodies()).toEqual([]);
  });

  it('sends nothing while paused', async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends on pause, but keeps a brief play for later', async () => {
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    act(() => api.stopped());
    expect(rpc).not.toHaveBeenCalled(); // 3 s: carried, not sent
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    await act(async () => { api.stopped(); });
    expect(sentSeconds()).toEqual([7]);
  });

  it('retries seconds whose send failed', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(sentSeconds()).toEqual([30, 60]);
  });

  it('flushes with a keepalive request when the tab is hidden, and keeps counting', async () => {
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    expect(beaconBodies()).toEqual([{ p_lesson_id: 'lesson-1', p_seconds: 12 }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/rest/v1/rpc/record_lesson_watch_time');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');

    await act(async () => { await vi.advanceTimersByTimeAsync(18_000); });
    expect(sentSeconds()).toEqual([18]); // the 30 s tick sends only what came after the flush
  });

  it('sends the rest when the student moves to another lesson', async () => {
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    act(() => root.render(<Probe lessonId="lesson-2" />));
    expect(beaconBodies()).toEqual([{ p_lesson_id: 'lesson-1', p_seconds: 20 }]);

    // The new lesson starts from zero and is attributed to itself.
    act(() => api.playing());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc).toHaveBeenLastCalledWith('record_lesson_watch_time', { p_lesson_id: 'lesson-2', p_seconds: 30 });
  });
});

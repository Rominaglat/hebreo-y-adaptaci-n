// Recovering from stale lazy-loaded chunks. After a deploy the hashed chunk
// filenames change; a tab left open on the old HTML fails to import any route
// chunk that no longer exists, which would otherwise leave a blank page. We
// reload once to pick up the fresh HTML + chunks.

const CHUNK_RELOAD_KEY = '__chunk_reload_at__';

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /dynamically imported module/i.test(msg)
  );
}

/**
 * Reload the page once (guarded to at most one reload per 30s so a genuinely
 * broken build can't loop) when the error is a stale-chunk failure.
 * Returns true if a reload was triggered.
 */
export function reloadOnceForChunk(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0');
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage can throw in private mode / blocked storage — reload anyway.
  }
  window.location.reload();
  return true;
}

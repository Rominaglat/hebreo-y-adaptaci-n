import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// After a Vercel deploy, the chunk file names change. Users who keep an old
// HTML page open will fail to lazy-load any chunk that no longer exists,
// and the page would just stop responding. Detect that specific error and
// force a one-time reload to pick up the fresh HTML + chunks.
const CHUNK_RELOAD_KEY = "__chunk_reload_at__";

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

function maybeReload(err: unknown) {
  if (!isChunkLoadError(err)) return;
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
  // Don't reload-loop: only one reload per 30s.
  if (Date.now() - last < 30_000) return;
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

window.addEventListener("error", (e) => maybeReload(e.error));
window.addEventListener("unhandledrejection", (e) => maybeReload(e.reason));

createRoot(document.getElementById("root")!).render(<App />);

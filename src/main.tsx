import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { reloadOnceForChunk } from "@/lib/chunkReload";

// Backstop for stale-chunk errors that surface as window events (e.g. a failed
// module *preload* that never reaches the React error boundary). The
// AppErrorBoundary below handles the ones thrown during render.
window.addEventListener("error", (e) => reloadOnceForChunk(e.error));
window.addEventListener("unhandledrejection", (e) => reloadOnceForChunk(e.reason));
// Vite's dedicated signal for a failed dynamic-import preload (the cleanest
// stale-chunk hook). preventDefault() so it doesn't also log as uncaught.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  reloadOnceForChunk(new Error("Failed to fetch dynamically imported module"));
});

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

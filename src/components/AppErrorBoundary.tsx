import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { isChunkLoadError, reloadOnceForChunk } from '@/lib/chunkReload';
import { report } from '@/lib/observability';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  isChunk: boolean;
}

// Top-level safety net. Without it, ANY uncaught render error (a stale chunk
// after a deploy, a null embed from RLS, a transient data shape) unmounts the
// whole React tree and leaves a blank page that only a manual refresh fixes.
// Here we auto-reload for stale chunks and show a clear retry screen for
// everything else, and report the real error to Sentry.
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunk: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, isChunk: isChunkLoadError(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // Stale chunk after a deploy → reload once to fetch the fresh build.
    if (reloadOnceForChunk(error)) return;
    // Anything else: log to Sentry so the real cause is visible.
    void report(
      error instanceof Error ? error.message : String(error),
      { componentStack: info?.componentStack, kind: 'render-crash' },
      'error',
    );
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // A chunk error triggers a reload; show a spinner in the brief interim so
    // the user never sees a blank frame.
    if (this.state.isChunk) {
      return (
        <div style={fullScreen}>
          <RefreshCw className="w-8 h-8 animate-spin" style={{ color: '#C4582A' }} />
        </div>
      );
    }

    // Non-chunk crash: a clear, dependency-free retry screen (bilingual —
    // the app is Spanish-facing, Hebrew-authored). Uses inline styles so it
    // renders even if the crash was inside a styling/theme provider.
    return (
      <div style={fullScreen}>
        <div style={{ maxWidth: 420, textAlign: 'center', padding: '0 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            Algo salió mal · משהו השתבש
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: '0 0 20px', lineHeight: 1.5 }}>
            No pudimos cargar esta página. Vuelve a intentarlo.
            <br />
            לא הצלחנו לטעון את הדף — נסו שוב.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => window.location.reload()} style={primaryBtn}>
              <RefreshCw className="w-4 h-4" style={{ display: 'inline', verticalAlign: 'middle', marginInlineEnd: 6 }} />
              Recargar · רענון
            </button>
            <a href="/" style={secondaryBtn}>Inicio · דף הבית</a>
          </div>
        </div>
      </div>
    );
  }
}

const fullScreen: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#FBF4DE',
  color: '#1a1a1a',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const primaryBtn: React.CSSProperties = {
  background: '#C4582A',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#C4582A',
  border: '1px solid #C4582A',
  borderRadius: 10,
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

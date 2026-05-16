// Lightweight observability shim — Wave 3.
//
// Acts as a no-op until VITE_SENTRY_DSN is set, at which point we lazy-load
// @sentry/react and forward events. Designed so the rest of the app can call
// `report(...)` unconditionally without paying the Sentry bundle cost during
// development.

import type { ReactNode } from 'react';

type Severity = 'info' | 'warning' | 'error' | 'fatal';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
let initialized = false;
let sentry: typeof import('@sentry/react') | null = null;

async function ensureSentry(): Promise<typeof import('@sentry/react') | null> {
  if (!dsn) return null;
  if (initialized) return sentry;
  initialized = true;
  try {
    // Defeat Rollup's static analysis with a variable specifier so the import
    // isn't resolved at build time. Sentry stays opt-in via DSN; no dependency
    // on it is shipped unless the package is actually installed at runtime.
    const pkg = '@sentry/' + 'react';
    // @ts-expect-error — runtime-only optional dep; type stub may be missing.
    const mod = await import(/* @vite-ignore */ pkg);
    mod.init({
      dsn,
      environment: import.meta.env.MODE,
      release: (import.meta.env.VITE_RELEASE as string) || 'dev',
      tracesSampleRate: 0.05,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.5,
      sendDefaultPii: false,
      beforeSend(event) {
        // Strip query strings & paths that look like UUIDs to avoid logging
        // tenant-scoped paths verbatim in error trails.
        if (event.request?.url) {
          event.request.url = event.request.url.replace(/[?].*$/, '');
        }
        return event;
      },
    });
    sentry = mod;
    return mod;
  } catch (e) {
    console.warn('[obs] Sentry init failed, falling back to console:', e);
    return null;
  }
}

export async function report(
  message: string,
  data: Record<string, unknown> = {},
  severity: Severity = 'error',
): Promise<void> {
  const s = await ensureSentry();
  if (s) {
    s.captureMessage(message, {
      level: severity === 'fatal' ? 'fatal' : severity,
      extra: data,
    });
  } else {
    // eslint-disable-next-line no-console
    console[severity === 'info' ? 'info' : severity === 'warning' ? 'warn' : 'error'](
      `[obs:${severity}] ${message}`,
      data,
    );
  }
}

export async function setUser(
  user: { id: string; email?: string | null } | null,
): Promise<void> {
  const s = await ensureSentry();
  if (!s) return;
  if (user) {
    // Email is PII — only include if you've opted-in for it.
    s.setUser({ id: user.id });
  } else {
    s.setUser(null);
  }
}

/** Optional React error boundary; falls back to passthrough when Sentry is off. */
export async function getErrorBoundary(): Promise<
  ((props: { children: ReactNode }) => ReactNode) | null
> {
  const s = await ensureSentry();
  if (!s) return null;
  return s.ErrorBoundary as unknown as (props: { children: ReactNode }) => ReactNode;
}

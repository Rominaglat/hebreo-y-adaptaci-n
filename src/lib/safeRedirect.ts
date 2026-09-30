// Where to send a user after login. ProtectedRoute stores the page they were
// trying to open in `location.state.from`; honouring it is what lets a dedicated
// link (e.g. the monthly survey) survive the login screen.
//
// Only same-origin paths are accepted — anything that could leave the site
// ("//host", "/\host", "https:", "javascript:") falls back, so the state can't
// be turned into an open redirect.

type LocationLike = { pathname?: unknown; search?: unknown; hash?: unknown };

export function safeRedirectPath(from: unknown, fallback = '/dashboard'): string {
  let path = '';
  if (typeof from === 'string') {
    path = from;
  } else if (from && typeof from === 'object') {
    const loc = from as LocationLike;
    if (typeof loc.pathname === 'string') {
      path = loc.pathname
        + (typeof loc.search === 'string' ? loc.search : '')
        + (typeof loc.hash === 'string' ? loc.hash : '');
    }
  }

  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
  if (path === '/login' || path.startsWith('/login?') || path.startsWith('/login#') || path.startsWith('/login/')) return fallback;
  return path;
}

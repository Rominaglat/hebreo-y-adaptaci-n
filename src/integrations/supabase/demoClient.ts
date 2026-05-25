// Demo / mock Supabase client used when VITE_DEMO_MODE=true.
// Lets you walk through the UI without a real backend by faking auth,
// returning sensible defaults for table queries, and no-op-ing edge
// functions / RPC / realtime channels.

import type { Database } from './types';

export const DEMO_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'demo@learning.local',
  password: 'demo1234',
  full_name: 'Romina Glatstein',
  role: 'super_admin' as const,
};

const STORAGE_KEY = 'demo-supabase-session';

type AuthListener = (event: string, session: unknown) => void;

function buildSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'demo-access-token',
    refresh_token: 'demo-refresh-token',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: now + 60 * 60 * 24 * 365,
    token_type: 'bearer',
    user: {
      id: DEMO_USER.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: DEMO_USER.email,
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'demo', providers: ['demo'] },
      user_metadata: { full_name: DEMO_USER.full_name },
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

const demoProfile = {
  id: DEMO_USER.id,
  email: DEMO_USER.email,
  phone: null,
  full_name: DEMO_USER.full_name,
  avatar_url: null,
  bio: 'Usuaria demo · Hebreo y Adaptación',
  social_links: {},
  join_date: new Date().toISOString(),
};

const demoTenantSettings = {
  primary_color: '#C4582A',
  brand_name: 'Hebreo y Adaptación',
};

// Table → default row(s). Anything not listed resolves to an empty list / null.
const TABLE_DATA: Record<string, unknown> = {
  profiles: demoProfile,
  user_roles: [{ user_id: DEMO_USER.id, role: DEMO_USER.role }],
  tenant_settings: demoTenantSettings,
};

function dataFor(table: string, mode: 'single' | 'many') {
  const seed = TABLE_DATA[table];
  if (mode === 'single') {
    if (Array.isArray(seed)) return seed[0] ?? null;
    return seed ?? null;
  }
  if (Array.isArray(seed)) return seed;
  return seed ? [seed] : [];
}

// A chainable query builder that ignores filters but resolves to demo data.
function makeQuery(table: string) {
  let mode: 'single' | 'many' = 'many';

  const result = () => ({ data: dataFor(table, mode), error: null, count: null });

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    upsert: () => builder,
    delete: () => builder,
    eq: () => builder,
    neq: () => builder,
    gt: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    like: () => builder,
    ilike: () => builder,
    is: () => builder,
    in: () => builder,
    contains: () => builder,
    containedBy: () => builder,
    range: () => builder,
    order: () => builder,
    limit: () => builder,
    or: () => builder,
    filter: () => builder,
    match: () => builder,
    not: () => builder,
    returns: () => builder,
    single: () => {
      mode = 'single';
      return Promise.resolve(result());
    },
    maybeSingle: () => {
      mode = 'single';
      return Promise.resolve(result());
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result()).catch(reject),
    finally: (cb: () => void) => Promise.resolve(result()).finally(cb),
  };

  return builder;
}

let listeners: AuthListener[] = [];

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session: unknown) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

function emit(event: string, session: unknown) {
  listeners.forEach((l) => {
    try { l(event, session); } catch { /* ignore */ }
  });
}

export const demoSupabase = {
  auth: {
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      // Accept the documented demo creds OR any credentials in demo mode —
      // the goal is to let people poke around, not gate the gate.
      const matchesDemo = email.trim() === DEMO_USER.email && password === DEMO_USER.password;
      const anyCredsOk = email.includes('@') && password.length >= 6;
      if (!matchesDemo && !anyCredsOk) {
        return { data: { user: null, session: null }, error: new Error('Invalid login credentials') };
      }
      const session = buildSession();
      saveSession(session);
      setTimeout(() => emit('SIGNED_IN', session), 0);
      return { data: { user: session.user, session }, error: null };
    },
    async signOut() {
      saveSession(null);
      setTimeout(() => emit('SIGNED_OUT', null), 0);
      return { error: null };
    },
    async getSession() {
      return { data: { session: loadSession() }, error: null };
    },
    async getUser() {
      const session = loadSession();
      return { data: { user: session?.user ?? null }, error: null };
    },
    onAuthStateChange(cb: AuthListener) {
      listeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners = listeners.filter((l) => l !== cb);
            },
          },
        },
      };
    },
    async refreshSession() {
      return { data: { session: loadSession(), user: loadSession()?.user ?? null }, error: null };
    },
    async updateUser() {
      return { data: { user: loadSession()?.user ?? null }, error: null };
    },
  },
  from(table: string) {
    return makeQuery(table);
  },
  rpc(_fn: string, _args?: unknown) {
    return Promise.resolve({ data: null, error: null });
  },
  functions: {
    async invoke(_name: string, _opts?: unknown) {
      return { data: null, error: null };
    },
  },
  channel(_name: string) {
    const ch = {
      on: () => ch,
      subscribe: () => ch,
      unsubscribe: () => Promise.resolve('ok' as const),
      send: () => Promise.resolve('ok' as const),
    };
    return ch;
  },
  removeChannel() {
    return Promise.resolve('ok' as const);
  },
  storage: {
    from() {
      return {
        upload: async () => ({ data: null, error: null }),
        download: async () => ({ data: null, error: null }),
        remove: async () => ({ data: null, error: null }),
        list: async () => ({ data: [], error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
        createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      };
    },
  },
} as unknown as import('@supabase/supabase-js').SupabaseClient<Database>;

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'admin' | 'instructor' | 'student' | 'super_admin';

interface Profile {
  id: string;
  email: string;
  phone: string | null;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  social_links: Record<string, string>;
  join_date: string;
}

// Tenant-specific profile from tenant_memberships
interface TenantProfile {
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  bio: string | null;
  role: AppRole;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isAdmin: boolean;
  isInstructor: boolean;
  isAdminOrInstructor: boolean;
  isSuperAdmin: boolean;
  // New: tenant-specific profile and role
  tenantProfile: TenantProfile | null;
  tenantRole: AppRole | null;
  setCurrentTenantId: (tenantId: string | null) => void;
  refreshTenantProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Tenant-specific state
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);
  const [tenantProfile, setTenantProfile] = useState<TenantProfile | null>(null);
  const [tenantRole, setTenantRole] = useState<AppRole | null>(null);

  const logActivity = async (userId: string, activityType: string, description: string, action?: string, metadata?: object) => {
    try {
      await supabase.from('user_activities').insert([{
        user_id: userId,
        activity_type: activityType,
        description,
        action,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : {}
      }]);
    } catch (error) {
      console.error('Error logging activity:', error);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          // Log auth events
          if (event === 'SIGNED_IN') {
            setTimeout(() => {
              logActivity(session.user.id, 'auth', 'התחברות למערכת', 'login', {
                email: session.user.email,
                provider: session.user.app_metadata?.provider
              });
            }, 0);
          }
          
          setTimeout(() => {
            fetchUserData(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setRole(null);
          setTenantProfile(null);
          setTenantRole(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchUserData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch tenant-specific profile when tenant changes
  useEffect(() => {
    if (user && currentTenantId) {
      fetchTenantProfile(user.id, currentTenantId);
    } else {
      setTenantProfile(null);
      setTenantRole(null);
    }
  }, [user, currentTenantId]);

  const fetchUserData = async (userId: string) => {
    try {
      // Fetch global profile (basic info)
      const profileResult = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileResult.data) {
        setProfile(profileResult.data as Profile);
      }

      // Single-tenant mode: roles live in user_roles. Pick the highest
      // role the user holds (super_admin > admin > instructor > student).
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      const roleHierarchy: AppRole[] = ['super_admin', 'admin', 'instructor', 'student'];
      let highestRole: AppRole = 'student';
      for (const row of roleRows ?? []) {
        const r = row.role as AppRole;
        if (roleHierarchy.indexOf(r) < roleHierarchy.indexOf(highestRole)) {
          highestRole = r;
        }
      }
      setRole(highestRole);
      // Mirror to tenantRole so legacy consumers (DashboardLayout) keep
      // working — the distinction between global and tenant role no
      // longer exists.
      setTenantRole(highestRole);
      // The profile-row fields are now the single source of truth; the
      // tenant_memberships override is gone.
      if (profileResult.data) {
        setTenantProfile({
          full_name: profileResult.data.full_name,
          avatar_url: profileResult.data.avatar_url,
          phone: profileResult.data.phone,
          bio: profileResult.data.bio,
          role: highestRole,
        });
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Single-tenant: no per-tenant profile concept. Kept as a no-op for
  // compatibility with `refreshTenantProfile` callers.
  const fetchTenantProfile = async (_userId: string, _tenantId: string) => {
    // intentional no-op
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    if (user) {
      await logActivity(user.id, 'auth', 'התנתקות מהמערכת', 'logout');
    }
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
    setTenantProfile(null);
    setTenantRole(null);
    setCurrentTenantId(null);
  };

  const refreshProfile = async () => {
    if (user) {
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) {
        setProfile(data as Profile);
      }
    }
  };

  const refreshTenantProfile = async () => {
    if (user && currentTenantId) {
      await fetchTenantProfile(user.id, currentTenantId);
    }
  };

  // Use tenant role if available, otherwise use global role
  const effectiveRole = tenantRole || role;
  const isSuperAdmin = role === 'super_admin'; // Super admin is a global check
  const isAdmin = effectiveRole === 'admin' || isSuperAdmin;
  const isInstructor = effectiveRole === 'instructor';
  const isAdminOrInstructor = isAdmin || isInstructor;

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      role,
      loading,
      signIn,
      signOut,
      refreshProfile,
      isAdmin,
      isInstructor,
      isAdminOrInstructor,
      isSuperAdmin,
      tenantProfile,
      tenantRole,
      setCurrentTenantId,
      refreshTenantProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

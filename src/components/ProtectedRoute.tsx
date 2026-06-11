import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { getMfaStatus, mfaRedirectFor } from '@/lib/mfaGate';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireAdminOrInstructor?: boolean;
  /** When true, redirect leads away from this route (they only see Courses). */
  denyLead?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireAdminOrInstructor = false,
  denyLead = false,
}: ProtectedRouteProps) {
  const { user, loading, isAdmin, isAdminOrInstructor, isSuperAdmin, isLead } = useAuth();
  const location = useLocation();

  // SEC-013 — hard-enforce AAL2 for admins when the env flag is on. This
  // runs ONLY for admin/super_admin users to avoid an extra round trip on
  // every student page load.
  const [mfaCheck, setMfaCheck] = useState<{ done: boolean; redirect: string | null }>({
    done: false,
    redirect: null,
  });
  const isAnyAdmin = isAdmin || isSuperAdmin;
  useEffect(() => {
    let cancelled = false;
    if (!user || !isAnyAdmin) {
      setMfaCheck({ done: true, redirect: null });
      return;
    }
    (async () => {
      const status = await getMfaStatus();
      const redirect = mfaRedirectFor(status, location.pathname);
      if (!cancelled) setMfaCheck({ done: true, redirect });
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, isAnyAdmin, location.pathname]);

  if (loading || !mfaCheck.done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Lead tier: the only authenticated route they can reach is /courses
  // (and its nested course-detail pages). Everything else — including
  // /dashboard, calendar, community, study rooms, learning path — sends
  // them straight to /courses so they never see content they shouldn't.
  if (isLead && denyLead && !location.pathname.startsWith('/courses')) {
    return <Navigate to="/courses" replace />;
  }

  if (requireAdmin && !isAdmin) {
    // Leads can't read /dashboard either, fall through to /courses.
    return <Navigate to={isLead ? '/courses' : '/dashboard'} replace />;
  }

  if (requireAdminOrInstructor && !isAdminOrInstructor) {
    return <Navigate to={isLead ? '/courses' : '/dashboard'} replace />;
  }

  if (mfaCheck.redirect) {
    return <Navigate to={mfaCheck.redirect} replace />;
  }

  return <>{children}</>;
}

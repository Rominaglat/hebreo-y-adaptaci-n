import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { getMfaStatus, mfaRedirectFor } from '@/lib/mfaGate';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireAdminOrInstructor?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireAdminOrInstructor = false,
}: ProtectedRouteProps) {
  const { user, loading, isAdmin, isAdminOrInstructor, isSuperAdmin } = useAuth();
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

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireAdminOrInstructor && !isAdminOrInstructor) {
    return <Navigate to="/dashboard" replace />;
  }

  if (mfaCheck.redirect) {
    return <Navigate to={mfaCheck.redirect} replace />;
  }

  return <>{children}</>;
}

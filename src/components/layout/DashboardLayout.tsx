import { ReactNode, Suspense, useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, BookOpen, Video, Calendar, User, LogOut, Menu, X, Bell, Settings, Megaphone, UserPlus, Sun, Moon, CheckCheck, Gift, UsersRound, GraduationCap, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { startSessionGuard, stopSessionGuard } from '@/lib/sessionGuard';
import { setUser as setObsUser } from '@/lib/observability';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePlatform } from '@/contexts/PlatformContext';
import { useTenant } from '@/contexts/TenantContext';
import { LanguageSelector } from '@/components/LanguageSelector';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { FloatingAiChat } from '@/components/FloatingAiChat';
import { OnboardingFlow } from '@/components/OnboardingFlow';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { AchievementToast } from '@/components/AchievementBadge';
import { CommandPalette } from '@/components/CommandPalette';
import { useSmartNotifications } from '@/hooks/useSmartNotifications';
import { format } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import brandLogo from '@/assets/logo.svg';

interface Announcement {
  id: string;
  title: string;
  content: string;
  created_at: string;
  is_pinned: boolean;
}

interface DashboardLayoutProps {
  children?: ReactNode;
}

// Page-level loading spinner (shown inside layout, not full page)
const PageSpinner = () => (
  <div className="flex items-center justify-center py-24">
    <div className="relative">
      <div className="w-10 h-10 rounded-full border-2 border-primary/20" />
      <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  </div>
);

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<Set<string>>(() => {
    const stored = localStorage.getItem('readAnnouncementIds');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, role, signOut, isAdmin, isSuperAdmin, isInstructor, tenantRole, tenantProfile } = useAuth();
  const { currentTenant, tenantSettings, loading: tenantsLoading, settingsLoading } = useTenant();
  const { t, language } = useLanguage();
  const { settings, theme, setTheme } = usePlatform();

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  // SEC — idle session timeout. Admins/super_admins get tighter limits.
  useEffect(() => {
    const idleMin = isSuperAdmin ? 10 : isAdmin ? 15 : 30;
    startSessionGuard({ idleTimeoutMin: idleMin });
    return () => stopSessionGuard();
  }, [isAdmin, isSuperAdmin]);

  // SEC — Sentry user tag (anonymous id only, never email).
  useEffect(() => {
    if (profile?.id) void setObsUser({ id: profile.id });
    else void setObsUser(null);
  }, [profile?.id]);

  const fetchAnnouncements = async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    if (data) setAnnouncements(data);
  };

  const unreadAnnouncements = announcements.filter(a => !readAnnouncementIds.has(a.id));
  const { notifications: smartNotifications, dismiss: dismissSmartNotification } = useSmartNotifications();
  const totalUnread = unreadAnnouncements.length + smartNotifications.length;

  const markAllAsRead = () => {
    const allIds = announcements.map(a => a.id);
    const newReadIds = new Set([...readAnnouncementIds, ...allIds]);
    setReadAnnouncementIds(newReadIds);
    localStorage.setItem('readAnnouncementIds', JSON.stringify([...newReadIds]));
  };

  const markAsRead = (id: string) => {
    const newReadIds = new Set([...readAnnouncementIds, id]);
    setReadAnnouncementIds(newReadIds);
    localStorage.setItem('readAnnouncementIds', JSON.stringify([...newReadIds]));
  };

  // Falls back to the bundled brand logo (H&A monogram) when the tenant has
  // no custom logo configured — keeps the sidebar in sync with the login screen.
  const getTenantLogo = () => tenantSettings?.logo_url || currentTenant?.logo_url || brandLogo;
  const getTenantInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Single-tenant mode: there is no "main tenant" branch any more — every
  // user (super-admin included) gets the same nav baseline.
  const navItems = [
    { icon: Home, label: t('nav.dashboard'), path: '/dashboard' },
    { icon: BookOpen, label: t('nav.courses'), path: '/courses' },
    { icon: GraduationCap, label: t('nav.learningPath'), path: '/learning-path' },
    { icon: Video, label: t('nav.studyRooms'), path: '/study-rooms' },
    { icon: Calendar, label: t('nav.calendar'), path: '/calendar' },
    { icon: Megaphone, label: t('nav.announcements'), path: '/announcements' },
    { icon: Gift, label: t('nav.communityBenefits'), path: '/community-benefits' },
    { icon: UsersRound, label: t('nav.communityMembers'), path: '/community-members' },
  ];

  const isAdminInCurrentTenant = tenantRole === 'admin' || tenantRole === 'super_admin' || isAdmin;
  const isInstructorInCurrentTenant = tenantRole === 'instructor' || isInstructor;
  const isInstructorOrHigherInCurrentTenant = isAdminInCurrentTenant || isInstructorInCurrentTenant;

  // Items visible to instructors AND admins (read-only access for instructors).
  const instructorPlusNavItems = [
    { icon: UserPlus, label: t('nav.manageUsers'), path: '/admin/users' },
  ];

  // Items visible only to admins/super_admins.
  const adminOnlyNavItems = [
    { icon: Settings, label: t('nav.settings'), path: '/admin/settings' },
  ];

  const handleSignOut = async () => { await signOut(); navigate('/login'); };
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  const getCurrentPageLabel = () => {
    const pathLabels: Record<string, string> = {
      '/dashboard': t('nav.dashboard'),
      '/courses': t('nav.courses'),
      '/study-rooms': t('nav.studyRooms'),
      '/calendar': t('nav.calendar'),
      '/announcements': t('nav.announcements'),
      '/admin/users': t('nav.manageUsers'),
      '/admin/settings': t('nav.settings'),
      '/profile': t('nav.profile'),
    };
    for (const [path, label] of Object.entries(pathLabels)) {
      if (location.pathname === path || (path !== '/dashboard' && location.pathname.startsWith(path))) return label;
    }
    return t('nav.dashboard');
  };

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const allNavItems = [
    ...navItems,
    ...(isInstructorOrHigherInCurrentTenant ? instructorPlusNavItems : []),
    ...(isAdminInCurrentTenant ? adminOnlyNavItems : []),
  ];

  return (
    <div className="h-screen bg-background flex w-full overflow-hidden">
      {/* Skip link for keyboard users (a11y) */}
      <a href="#main-content" className="skip-link">
        {t('a11y.skipToMain')}
      </a>

      {/* Mobile overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden transition-opacity duration-300",
          sidebarOpen ? "bg-foreground/20 backdrop-blur-sm opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar — pinned to the inline-start edge (right in RTL, left in LTR) */}
      <aside className={cn(
        "fixed inset-y-0 z-50 w-64 bg-sidebar text-sidebar-foreground transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-xl",
        language === 'he' ? 'right-0' : 'left-0',
        sidebarOpen
          ? "translate-x-0"
          : language === 'he'
            ? "translate-x-full lg:translate-x-0"
            : "-translate-x-full lg:translate-x-0"
      )}>
        {/* Subtle decorative gradient */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />
        <div className="flex flex-col h-full relative">
          {/* Tenant header — single-tenant mode renders a static brand
              header (logo + name). The dropdown switcher was removed when
              multi-tenancy was disabled; the dropdown shell is gone too. */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border/50">
            <div className="flex items-center gap-3 w-full">
              <Avatar className="w-10 h-10 rounded-xl flex-shrink-0 ring-1 ring-white/10">
                <AvatarImage src={getTenantLogo()} className="object-contain" />
                <AvatarFallback className="rounded-xl bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
                  {currentTenant?.name ? getTenantInitials(currentTenant.name) : 'HA'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-start min-w-0">
                <span className="font-bold text-sm block truncate">
                  {tenantsLoading || settingsLoading ? '' : (currentTenant?.name || settings.branding.name)}
                </span>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden text-sidebar-foreground hover:bg-sidebar-accent" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            {allNavItems.map(item => {
              const isActive = location.pathname === item.path || (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-sidebar-foreground/70 hover:bg-white/10 hover:text-sidebar-foreground"
                  )}
                >
                  {isActive && (
                    <span className="absolute inset-y-2 start-0 w-1 rounded-r-full bg-white" />
                  )}
                  <item.icon className={cn(
                    "w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110",
                    isActive ? "text-white" : ""
                  )} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Theme Toggle */}
          <div className="p-4 border-t border-sidebar-border">
            <button onClick={toggleTheme} className="flex items-center justify-center w-full p-3 rounded-xl bg-sidebar-accent/50 hover:bg-sidebar-accent transition-all duration-200">
              <div className="w-14 h-7 rounded-full bg-sidebar-accent flex items-center px-1 transition-colors relative" dir="ltr">
                <Sun className={cn("w-4 h-4 absolute left-1.5 transition-opacity text-warning", theme === 'light' ? "opacity-100" : "opacity-40")} />
                <Moon className={cn("w-4 h-4 absolute right-1.5 transition-opacity text-sidebar-foreground", theme === 'dark' ? "opacity-100" : "opacity-40")} />
                <div className={cn("w-5 h-5 rounded-full bg-accent shadow-md transition-all duration-200 z-10 absolute", theme === 'dark' ? "left-1" : "right-1")} />
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className={cn("flex-1 flex flex-col min-w-0 overflow-hidden", language === 'he' ? 'lg:mr-64' : 'lg:ml-64')}>
        {/* Header — fixed height, flex-shrink-0 */}
        <header className="h-16 bg-card/80 backdrop-blur-xl border-b border-border/60 flex items-center justify-between px-4 lg:px-6 z-30 flex-shrink-0">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label={t('a11y.openMenu')}
            >
              <Menu className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-semibold tracking-tight hidden sm:block">{getCurrentPageLabel()}</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* ⌘K hint button — desktop only */}
            <button
              type="button"
              onClick={() => {
                const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
                document.dispatchEvent(event);
              }}
              className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border/60 bg-muted/40 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              aria-label={t('a11y.openQuickSearch')}
            >
              <Search className="w-3.5 h-3.5" />
              <span>{t('common.search')}</span>
              <kbd className="hidden lg:inline-flex items-center gap-0.5 ms-1 px-1.5 py-0.5 rounded bg-background border border-border/60 text-[10px] font-mono">
                ⌘K
              </kbd>
            </button>
            <LanguageSelector />

            <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  aria-label={totalUnread > 0 ? `${t('notifications.title')} (${totalUnread})` : t('notifications.title')}
                >
                  <Bell className="w-5 h-5" />
                  {totalUnread > 0 && (
                    <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="p-3 border-b border-border">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold text-sm">{t('notifications.title')}</h4>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => { setNotificationsOpen(false); navigate('/install'); }}>
                        {t('notifications.enable')}
                      </Button>
                      {unreadAnnouncements.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllAsRead}>
                          <CheckCheck className="w-3 h-3 ml-1" />
                          {t('notifications.markAllRead')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <ScrollArea className="h-[340px]">
                  {/* Smart notifications (Phase 4 — context-aware) */}
                  {smartNotifications.length > 0 && (
                    <div className="divide-y divide-border border-b border-border">
                      {smartNotifications.map((n) => {
                        const Wrapper = n.link ? Link : 'div';
                        const wrapperProps = n.link
                          ? { to: n.link, onClick: () => { dismissSmartNotification(n.id); setNotificationsOpen(false); } }
                          : {};
                        return (
                          <div key={n.id} className="relative group">
                            <Wrapper
                              {...(wrapperProps as any)}
                              className={cn(
                                "block p-3 transition-colors",
                                n.priority === 'high'
                                  ? "bg-gradient-to-r from-orange-500/[0.06] to-transparent hover:from-orange-500/[0.10]"
                                  : "hover:bg-muted/50"
                              )}
                            >
                              <div className="flex items-start gap-3 pe-7">
                                <span className="text-xl flex-shrink-0 leading-none">{n.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm">{n.title}</p>
                                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                                </div>
                              </div>
                            </Wrapper>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                dismissSmartNotification(n.id);
                              }}
                              className="absolute top-2 end-2 w-6 h-6 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted flex items-center justify-center transition-opacity"
                              aria-label={t('common.close')}
                            >
                              <X className="w-3 h-3 text-muted-foreground" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {announcements.length === 0 && smartNotifications.length === 0 ? (
                    <div className="p-6 text-center text-muted-foreground">
                      <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">{t('notifications.empty')}</p>
                    </div>
                  ) : announcements.length === 0 ? null : (
                    <div className="divide-y divide-border">
                      {announcements.map(announcement => {
                        const isRead = readAnnouncementIds.has(announcement.id);
                        return (
                          <Link
                            key={announcement.id}
                            to="/announcements"
                            onClick={() => { markAsRead(announcement.id); setNotificationsOpen(false); }}
                            className={cn("block p-3 hover:bg-muted/50 transition-colors", isRead && "opacity-60")}
                          >
                            <div className="flex items-start gap-3">
                              <div className={cn("w-2 h-2 mt-2 rounded-full flex-shrink-0", isRead ? "bg-muted-foreground/30" : "bg-primary")} />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{announcement.title}</p>
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{announcement.content}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {format(new Date(announcement.created_at), language === 'he' ? 'd בMMM' : 'd MMM', { locale: language === 'he' ? he : language === 'es' ? es : enUS })}
                                </p>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
                <div className="p-2 border-t border-border">
                  <Button variant="ghost" className="w-full text-sm" onClick={() => { setNotificationsOpen(false); navigate('/announcements'); }}>
                    {t('notifications.viewAll')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 max-w-[16rem] min-w-0">
                  <span className="hidden sm:inline text-sm font-medium truncate min-w-0">
                    {(tenantProfile?.full_name && tenantProfile.full_name.trim()) || profile?.full_name || t('common.loading')}
                  </span>
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarImage src={tenantProfile?.avatar_url || profile?.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {((tenantProfile?.full_name && tenantProfile.full_name.trim()) || profile?.full_name) ? getInitials((tenantProfile?.full_name && tenantProfile.full_name.trim()) || profile?.full_name || '') : 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 z-50 bg-popover">
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {t('nav.profile')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="w-4 h-4 ml-2" />
                  {t('auth.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 p-4 lg:p-6 overflow-y-auto overflow-x-hidden min-w-0 relative">
          <div className="max-w-7xl mx-auto w-full min-w-0">
            {children || (
              <Suspense fallback={<PageSpinner />}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={location.pathname}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.22, ease: [0.33, 1, 0.68, 1] }}
                  >
                    <Outlet />
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            )}
          </div>
        </main>
      </div>
      <FloatingAiChat />
      <OnboardingFlow />
      <OnboardingChecklist />
      <AchievementToast />
      <CommandPalette />
    </div>
  );
}

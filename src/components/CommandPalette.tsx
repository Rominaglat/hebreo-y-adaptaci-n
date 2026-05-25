import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home,
  BookOpen,
  Video,
  Calendar,
  Megaphone,
  User,
  UsersRound,
  Gift,
  Settings,
  UserPlus,
  Building2,
  LogOut,
  Sun,
  Moon,
  Bookmark,
  GraduationCap,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePlatform } from '@/contexts/PlatformContext';
import { supabase } from '@/integrations/supabase/client';

interface SearchedCourse {
  id: string;
  title: string;
}

interface SearchedMember {
  id: string;
  full_name: string | null;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState<SearchedCourse[]>([]);
  const [members, setMembers] = useState<SearchedMember[]>([]);
  const navigate = useNavigate();
  const { signOut, isAdmin, isSuperAdmin } = useAuth();
  const { t } = useLanguage();
  const { currentTenant } = useTenant();
  const { theme, setTheme } = usePlatform();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [coursesRes, membersRes] = await Promise.all([
          supabase.from('courses').select('id, title').eq('is_published', true).limit(20),
          supabase.from('profiles').select('id, full_name').eq('show_in_community', true).limit(20),
        ]);
        if (cancelled) return;
        setCourses((coursesRes.data || []) as SearchedCourse[]);
        setMembers((membersRes.data || []) as SearchedMember[]);
      } catch (e) {
        console.error('Command palette fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const runAction = (fn: () => void) => {
    setOpen(false);
    setTimeout(fn, 50);
  };

  const isMainTenant = currentTenant?.slug === 'main';

  const navItems = useMemo(() => {
    if (isMainTenant && isSuperAdmin) {
      return [
        { icon: Home, label: t('nav.dashboard'), path: '/dashboard' },
        { icon: Megaphone, label: t('announcements.title'), path: '/announcements' },
        { icon: Building2, label: t('commandPalette.manageTenants'), path: '/admin/tenants' },
        { icon: UserPlus, label: t('nav.manageUsers'), path: '/admin/users' },
        { icon: Settings, label: t('nav.settings'), path: '/admin/settings' },
      ];
    }
    return [
      { icon: Home, label: t('nav.dashboard'), path: '/dashboard' },
      { icon: BookOpen, label: t('nav.courses'), path: '/courses' },
      { icon: Bookmark, label: t('courseDetail.favorites'), path: '/courses/favorites' },
      { icon: Video, label: t('nav.studyRooms'), path: '/study-rooms' },
      { icon: Calendar, label: t('nav.calendar'), path: '/calendar' },
      { icon: Megaphone, label: t('nav.announcements'), path: '/announcements' },
      { icon: Gift, label: t('nav.communityBenefits'), path: '/community-benefits' },
      { icon: UsersRound, label: t('nav.communityMembers'), path: '/community-members' },
      { icon: GraduationCap, label: t('nav.learningPath'), path: '/learning-path' },
      ...(isAdmin
        ? [
            { icon: UserPlus, label: t('nav.manageUsers'), path: '/admin/users' },
            { icon: Settings, label: t('nav.settings'), path: '/admin/settings' },
          ]
        : []),
      { icon: User, label: t('commandPalette.myProfile'), path: '/profile' },
    ];
  }, [t, isMainTenant, isSuperAdmin, isAdmin]);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={t('commandPalette.searchPlaceholder')}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>

        <CommandGroup heading={t('commandPalette.groupPages')}>
          {navItems.map((item) => (
            <CommandItem
              key={item.path}
              value={`page ${item.label}`}
              onSelect={() => runAction(() => navigate(item.path))}
            >
              <item.icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {courses.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('nav.courses')}>
              {courses.map((course) => (
                <CommandItem
                  key={course.id}
                  value={`course ${course.title}`}
                  onSelect={() => runAction(() => navigate(`/courses/${course.id}`))}
                >
                  <BookOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{course.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {members.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('nav.communityMembers')}>
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`member ${m.full_name || ''}`}
                  onSelect={() => runAction(() => navigate('/community-members'))}
                >
                  <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{m.full_name || t('commandPalette.userFallback')}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading={t('commandPalette.groupActions')}>
          <CommandItem
            value="action toggle theme"
            onSelect={() => runAction(() => setTheme(theme === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? (
              <Moon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <Sun className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span>
              {theme === 'light' ? t('commandPalette.switchDark') : t('commandPalette.switchLight')}
            </span>
          </CommandItem>
          <CommandItem value="action logout" onSelect={() => runAction(handleLogout)}>
            <LogOut className="h-4 w-4 text-destructive flex-shrink-0" />
            <span className="text-destructive">{t('auth.logout')}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

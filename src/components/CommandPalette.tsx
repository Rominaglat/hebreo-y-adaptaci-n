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
  Sparkles,
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
  const { language } = useLanguage();
  const { currentTenant } = useTenant();
  const { theme, setTheme } = usePlatform();

  // Toggle on Cmd+K / Ctrl+K
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

  // Reset query when opening
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Fetch courses + members for search
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [coursesRes, membersRes] = await Promise.all([
          supabase
            .from('courses')
            .select('id, title')
            .eq('is_published', true)
            .limit(20),
          supabase
            .from('profiles')
            .select('id, full_name')
            .eq('show_in_community', true)
            .limit(20),
        ]);
        if (cancelled) return;
        setCourses((coursesRes.data || []) as SearchedCourse[]);
        setMembers((membersRes.data || []) as SearchedMember[]);
      } catch (e) {
        console.error('Command palette fetch failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const runAction = (fn: () => void) => {
    setOpen(false);
    setTimeout(fn, 50);
  };

  const isMainTenant = currentTenant?.slug === 'main';

  const navItems = useMemo(() => {
    if (isMainTenant && isSuperAdmin) {
      return [
        { icon: Home, label: language === 'he' ? 'לוח בקרה' : 'Dashboard', path: '/dashboard' },
        { icon: Megaphone, label: language === 'he' ? 'הודעות' : 'Announcements', path: '/announcements' },
        { icon: Sparkles, label: language === 'he' ? 'ספריית סקילים' : 'Skills Library', path: '/skills' },
        { icon: Building2, label: language === 'he' ? 'ניהול ארגונים' : 'Manage Tenants', path: '/admin/tenants' },
        { icon: UserPlus, label: language === 'he' ? 'ניהול משתמשים' : 'Manage Users', path: '/admin/users' },
        { icon: Settings, label: language === 'he' ? 'הגדרות' : 'Settings', path: '/admin/settings' },
      ];
    }
    return [
      { icon: Home, label: language === 'he' ? 'לוח בקרה' : 'Dashboard', path: '/dashboard' },
      { icon: BookOpen, label: language === 'he' ? 'קורסים' : 'Courses', path: '/courses' },
      { icon: Bookmark, label: language === 'he' ? 'מועדפים' : 'Favorites', path: '/courses/favorites' },
      { icon: Video, label: language === 'he' ? 'חדרי לימוד' : 'Study Rooms', path: '/study-rooms' },
      { icon: Calendar, label: language === 'he' ? 'לוח שנה' : 'Calendar', path: '/calendar' },
      { icon: Megaphone, label: language === 'he' ? 'הודעות' : 'Announcements', path: '/announcements' },
      { icon: Gift, label: language === 'he' ? 'הטבות לקהילה' : 'Benefits', path: '/community-benefits' },
      { icon: UsersRound, label: language === 'he' ? 'חברי הקהילה' : 'Members', path: '/community-members' },
      { icon: GraduationCap, label: language === 'he' ? 'מסלול הלמידה שלי' : 'My Learning Path', path: '/learning-path' },
      ...(isAdmin
        ? [
            { icon: Sparkles, label: language === 'he' ? 'ספריית סקילים' : 'Skills Library', path: '/skills' },
            { icon: UserPlus, label: language === 'he' ? 'ניהול משתמשים' : 'Manage Users', path: '/admin/users' },
            { icon: Settings, label: language === 'he' ? 'הגדרות' : 'Settings', path: '/admin/settings' },
          ]
        : []),
      { icon: User, label: language === 'he' ? 'הפרופיל שלי' : 'My Profile', path: '/profile' },
    ];
  }, [language, isMainTenant, isSuperAdmin, isAdmin]);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={language === 'he' ? 'חפש דפים, קורסים, חברים, פעולות...' : 'Search pages, courses, members, actions...'}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{language === 'he' ? 'לא נמצאו תוצאות' : 'No results found'}</CommandEmpty>

        {/* Pages */}
        <CommandGroup heading={language === 'he' ? 'דפים' : 'Pages'}>
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

        {/* Courses */}
        {courses.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={language === 'he' ? 'קורסים' : 'Courses'}>
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

        {/* Members */}
        {members.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={language === 'he' ? 'חברי הקהילה' : 'Members'}>
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`member ${m.full_name || ''}`}
                  onSelect={() => runAction(() => navigate('/community-members'))}
                >
                  <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{m.full_name || (language === 'he' ? 'משתמש' : 'User')}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Actions */}
        <CommandSeparator />
        <CommandGroup heading={language === 'he' ? 'פעולות' : 'Actions'}>
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
              {theme === 'light'
                ? language === 'he'
                  ? 'עבור למצב כהה'
                  : 'Switch to dark mode'
                : language === 'he'
                ? 'עבור למצב בהיר'
                : 'Switch to light mode'}
            </span>
          </CommandItem>
          <CommandItem value="action logout" onSelect={() => runAction(handleLogout)}>
            <LogOut className="h-4 w-4 text-destructive flex-shrink-0" />
            <span className="text-destructive">{language === 'he' ? 'התנתק' : 'Log out'}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

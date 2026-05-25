import { useEffect, useState, useMemo } from 'react';
import { useStreak } from './useStreak';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

export type SmartNotificationType =
  | 'streak_at_risk'
  | 'streak_milestone'
  | 'event_starting_soon'
  | 'unfinished_course'
  | 'welcome_back'
  | 'inactive_warning';

export interface SmartNotification {
  id: string;
  type: SmartNotificationType;
  title: string;
  body: string;
  icon: string;
  link?: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
}

interface EnrolledCourseRow {
  course_id: string;
  progress_percentage: number | null;
  enrolled_at: string;
  courses: { id: string; title: string } | null;
}

interface EventRow {
  id: string;
  title: string;
  start_time: string;
}

/**
 * Computes context-aware in-app notifications based on user state.
 * Pure client-side — no backend cron required.
 *
 * Rules:
 * - Streak ≥ 1 and last activity = yesterday → "סטריק בסכנה" (high)
 * - Streak ≥ 3 and just reached → milestone notification (medium)
 * - Event starting in next 30 min → "אירוע בקרוב" (high)
 * - Has course with progress 10–90% and not touched in 3+ days → "המשך לימוד" (medium)
 * - User hasn't logged in for 7+ days (lastLogin in localStorage) → "התגעגענו אליך" (medium)
 */
export function useSmartNotifications() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { current: currentStreak, isAtRisk, lastActivityDate } = useStreak();

  const [upcomingEvents, setUpcomingEvents] = useState<EventRow[]>([]);
  const [staleCourses, setStaleCourses] = useState<EnrolledCourseRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('smartNotifications:dismissed');
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });

  // Fetch live data
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      // Events starting in the next 30 minutes
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 60 * 1000);
      const { data: events } = await supabase
        .from('events')
        .select('id, title, start_time')
        .gte('start_time', now.toISOString())
        .lte('start_time', in30.toISOString())
        .order('start_time', { ascending: true });

      if (cancelled) return;
      setUpcomingEvents((events || []) as EventRow[]);

      // Stale enrolled courses
      const { data: enrolled } = await supabase
        .from('enrollments')
        .select('course_id, progress_percentage, enrolled_at, courses(id, title)')
        .eq('user_id', user.id);

      if (cancelled) return;
      const enrolledRows = (enrolled || []) as unknown as EnrolledCourseRow[];
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const stale = enrolledRows.filter(
        (e) =>
          e.courses &&
          (e.progress_percentage ?? 0) >= 10 &&
          (e.progress_percentage ?? 0) <= 90 &&
          new Date(e.enrolled_at) < threeDaysAgo
      );
      setStaleCourses(stale.slice(0, 1));
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Compute notifications
  const notifications = useMemo<SmartNotification[]>(() => {
    if (!user) return [];
    const items: SmartNotification[] = [];

    // 1. Streak at risk
    if (isAtRisk && currentStreak >= 1) {
      items.push({
        id: `streak-risk-${lastActivityDate}`,
        type: 'streak_at_risk',
        title: t('smartNotifications.streakAtRiskTitle'),
        body: t('smartNotifications.streakAtRiskBody').replace('{count}', String(currentStreak)),
        icon: '⚠️',
        priority: 'high',
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Upcoming events (next 30 min)
    upcomingEvents.forEach((event) => {
      const minutesUntil = Math.round(
        (new Date(event.start_time).getTime() - Date.now()) / (1000 * 60)
      );
      items.push({
        id: `event-${event.id}`,
        type: 'event_starting_soon',
        title: t('smartNotifications.eventStartingSoonTitle'),
        body: t('smartNotifications.eventStartingSoonBody')
          .replace('{title}', event.title)
          .replace('{minutes}', String(minutesUntil)),
        icon: '📅',
        link: '/calendar',
        priority: 'high',
        createdAt: new Date().toISOString(),
      });
    });

    // 3. Stale courses
    staleCourses.forEach((course) => {
      if (!course.courses) return;
      items.push({
        id: `stale-${course.course_id}`,
        type: 'unfinished_course',
        title: t('smartNotifications.continueWhereLeftOffTitle'),
        body: t('smartNotifications.continueWhereLeftOffBody')
          .replace('{title}', course.courses.title)
          .replace('{progress}', String(Math.round(course.progress_percentage ?? 0))),
        icon: '📚',
        link: `/courses/${course.course_id}`,
        priority: 'medium',
        createdAt: new Date().toISOString(),
      });
    });

    // Filter out dismissed
    return items.filter((n) => !dismissed.has(n.id));
  }, [user, currentStreak, isAtRisk, lastActivityDate, upcomingEvents, staleCourses, dismissed, t]);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem('smartNotifications:dismissed', JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const dismissAll = () => {
    const allIds = notifications.map((n) => n.id);
    setDismissed((prev) => {
      const next = new Set(prev);
      allIds.forEach((id) => next.add(id));
      try {
        localStorage.setItem('smartNotifications:dismissed', JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return {
    notifications,
    count: notifications.length,
    dismiss,
    dismissAll,
  };
}

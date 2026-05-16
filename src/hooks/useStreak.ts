import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export interface StreakData {
  current: number;
  longest: number;
  lastActivityDate: string | null; // ISO date string YYYY-MM-DD
  activityDates: string[]; // List of all dates with activity
}

const DEFAULT_STREAK: StreakData = {
  current: 0,
  longest: 0,
  lastActivityDate: null,
  activityDates: [],
};

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Tracks user's daily streak in localStorage. Increments on first activity each day.
 * If yesterday was the last activity, streak continues. Otherwise resets to 1.
 */
export function useStreak() {
  const { user } = useAuth();
  const storageKey = user ? `streak:${user.id}` : null;

  const [streak, setStreak] = useState<StreakData>(DEFAULT_STREAK);

  // Load from localStorage
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw) as StreakData;
        setStreak(data);
      }
    } catch (e) {
      console.error('Failed to load streak', e);
    }
  }, [storageKey]);

  // Record activity for today
  const recordActivity = useCallback(() => {
    if (!storageKey) return;
    const today = getTodayKey();

    setStreak((prev) => {
      // Already recorded today — no change
      if (prev.lastActivityDate === today) return prev;

      let newCurrent = 1;
      const yesterday = getYesterdayKey();

      if (prev.lastActivityDate === yesterday) {
        // Continuing streak
        newCurrent = prev.current + 1;
      } else if (prev.lastActivityDate) {
        const gap = daysBetween(prev.lastActivityDate, today);
        if (gap === 0) {
          newCurrent = prev.current; // same day (defensive)
        } else if (gap === 1) {
          newCurrent = prev.current + 1;
        } else {
          newCurrent = 1; // reset
        }
      }

      const newLongest = Math.max(prev.longest, newCurrent);
      const newDates = [...prev.activityDates, today].slice(-365); // keep last year

      const next: StreakData = {
        current: newCurrent,
        longest: newLongest,
        lastActivityDate: today,
        activityDates: newDates,
      };

      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save streak', e);
      }
      return next;
    });
  }, [storageKey]);

  // Auto-record on mount when user is present
  useEffect(() => {
    if (user) recordActivity();
  }, [user, recordActivity]);

  const isAtRisk = (() => {
    if (!streak.lastActivityDate) return false;
    const today = getTodayKey();
    const yesterday = getYesterdayKey();
    return streak.current > 0 && streak.lastActivityDate === yesterday && getTodayKey() !== today;
  })();

  return {
    current: streak.current,
    longest: streak.longest,
    lastActivityDate: streak.lastActivityDate,
    activityDates: streak.activityDates,
    isAtRisk,
    recordActivity,
  };
}

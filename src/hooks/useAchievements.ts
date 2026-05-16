import { useEffect, useState, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { useAuth } from '@/contexts/AuthContext';
import { useStreak } from './useStreak';

export type AchievementCode =
  | 'first_login'
  | 'profile_complete'
  | 'first_course'
  | 'first_lesson'
  | 'streak_3'
  | 'streak_7'
  | 'streak_30'
  | 'aria_first_chat'
  | 'study_room_join'
  | 'community_hello';

export interface Achievement {
  code: AchievementCode;
  name: string;
  description: string;
  icon: string; // emoji
  color: string; // tailwind gradient classes
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    code: 'first_login',
    name: 'ברוכים הבאים! 👋',
    description: 'התחברת בפעם הראשונה',
    icon: '🎉',
    color: 'from-purple-500 to-pink-500',
    rarity: 'common',
  },
  {
    code: 'profile_complete',
    name: 'פרופיל מלא',
    description: 'השלמת את הפרופיל שלך',
    icon: '👤',
    color: 'from-violet-500 to-purple-500',
    rarity: 'common',
  },
  {
    code: 'first_course',
    name: 'יוצאים לדרך',
    description: 'נרשמת לקורס הראשון שלך',
    icon: '📚',
    color: 'from-indigo-500 to-blue-500',
    rarity: 'common',
  },
  {
    code: 'first_lesson',
    name: 'התחלה טובה',
    description: 'השלמת את השיעור הראשון',
    icon: '🎯',
    color: 'from-cyan-500 to-blue-500',
    rarity: 'common',
  },
  {
    code: 'streak_3',
    name: 'בלהט',
    description: '3 ימים של למידה רצופה',
    icon: '🔥',
    color: 'from-orange-500 to-red-500',
    rarity: 'rare',
  },
  {
    code: 'streak_7',
    name: 'שבוע מושלם',
    description: '7 ימי למידה ברצף',
    icon: '⚡',
    color: 'from-yellow-500 to-orange-500',
    rarity: 'rare',
  },
  {
    code: 'streak_30',
    name: 'אגדה',
    description: '30 ימים של התמדה!',
    icon: '👑',
    color: 'from-amber-400 via-yellow-500 to-amber-600',
    rarity: 'legendary',
  },
  {
    code: 'aria_first_chat',
    name: 'נעים מאוד',
    description: 'שוחחת עם העוזר בפעם הראשונה',
    icon: '🤖',
    color: 'from-fuchsia-500 to-purple-500',
    rarity: 'common',
  },
  {
    code: 'study_room_join',
    name: 'חלק מהקהילה',
    description: 'הצטרפת לחדר לימוד',
    icon: '🎓',
    color: 'from-emerald-500 to-teal-500',
    rarity: 'common',
  },
  {
    code: 'community_hello',
    name: 'חבר חדש',
    description: 'גילית חברי קהילה',
    icon: '🤝',
    color: 'from-rose-500 to-pink-500',
    rarity: 'common',
  },
];

const RARITY_COLORS = {
  common: '#a78bfa',
  rare: '#60a5fa',
  epic: '#f472b6',
  legendary: '#fbbf24',
};

function fireConfetti(rarity: Achievement['rarity']) {
  // Only fire confetti for rare or above — common achievements just show the toast
  if (rarity === 'common') return;

  const color = RARITY_COLORS[rarity];

  // Single subtle burst from the top center
  confetti({
    particleCount: rarity === 'legendary' ? 80 : 40,
    spread: rarity === 'legendary' ? 90 : 60,
    startVelocity: 35,
    origin: { x: 0.5, y: 0.1 },
    colors: [color, '#ffffff', '#a78bfa'],
    disableForReducedMotion: true,
    ticks: 150,
  });
}

interface UnlockedRecord {
  code: AchievementCode;
  unlockedAt: string; // ISO
}

export function useAchievements() {
  const { user } = useAuth();
  const { current: currentStreak } = useStreak();
  const storageKey = user ? `achievements:${user.id}` : null;

  const [unlocked, setUnlocked] = useState<UnlockedRecord[]>([]);
  const [recentUnlock, setRecentUnlock] = useState<Achievement | null>(null);

  // Load from localStorage
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setUnlocked(JSON.parse(raw));
    } catch (e) {
      console.error('Failed to load achievements', e);
    }
  }, [storageKey]);

  const persist = useCallback(
    (records: UnlockedRecord[]) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(records));
      } catch (e) {
        console.error('Failed to save achievements', e);
      }
    },
    [storageKey]
  );

  const isUnlocked = useCallback(
    (code: AchievementCode) => unlocked.some((u) => u.code === code),
    [unlocked]
  );

  const unlock = useCallback(
    (code: AchievementCode) => {
      if (!storageKey) return;
      if (isUnlocked(code)) return;

      const achievement = ACHIEVEMENTS.find((a) => a.code === code);
      if (!achievement) return;

      const record: UnlockedRecord = { code, unlockedAt: new Date().toISOString() };
      setUnlocked((prev) => {
        const next = [...prev, record];
        persist(next);
        return next;
      });

      // Trigger celebration
      setRecentUnlock(achievement);
      fireConfetti(achievement.rarity);

      // Auto-clear toast after 5s
      setTimeout(() => setRecentUnlock(null), 5000);
    },
    [storageKey, isUnlocked, persist]
  );

  const dismissRecentUnlock = useCallback(() => setRecentUnlock(null), []);

  // Auto-unlock streak achievements (rare/legendary — only these get confetti)
  useEffect(() => {
    if (!user) return;
    if (currentStreak >= 3 && !isUnlocked('streak_3')) unlock('streak_3');
    if (currentStreak >= 7 && !isUnlocked('streak_7')) unlock('streak_7');
    if (currentStreak >= 30 && !isUnlocked('streak_30')) unlock('streak_30');
  }, [currentStreak, user, isUnlocked, unlock]);

  return {
    achievements: ACHIEVEMENTS,
    unlocked,
    recentUnlock,
    isUnlocked,
    unlock,
    dismissRecentUnlock,
  };
}

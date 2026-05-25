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
  nameKey: string;
  descriptionKey: string;
  icon: string; // emoji
  color: string; // tailwind gradient classes
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export const ACHIEVEMENTS: Achievement[] = [
  { code: 'first_login', nameKey: 'achievements.firstLogin.name', descriptionKey: 'achievements.firstLogin.description', icon: '🎉', color: 'from-orange-500 to-amber-600', rarity: 'common' },
  { code: 'profile_complete', nameKey: 'achievements.profileComplete.name', descriptionKey: 'achievements.profileComplete.description', icon: '👤', color: 'from-amber-500 to-orange-600', rarity: 'common' },
  { code: 'first_course', nameKey: 'achievements.firstCourse.name', descriptionKey: 'achievements.firstCourse.description', icon: '📚', color: 'from-indigo-500 to-blue-500', rarity: 'common' },
  { code: 'first_lesson', nameKey: 'achievements.firstLesson.name', descriptionKey: 'achievements.firstLesson.description', icon: '🎯', color: 'from-cyan-500 to-blue-500', rarity: 'common' },
  { code: 'streak_3', nameKey: 'achievements.streak3.name', descriptionKey: 'achievements.streak3.description', icon: '🔥', color: 'from-orange-500 to-red-500', rarity: 'rare' },
  { code: 'streak_7', nameKey: 'achievements.streak7.name', descriptionKey: 'achievements.streak7.description', icon: '⚡', color: 'from-yellow-500 to-orange-500', rarity: 'rare' },
  { code: 'streak_30', nameKey: 'achievements.streak30.name', descriptionKey: 'achievements.streak30.description', icon: '👑', color: 'from-amber-400 via-yellow-500 to-amber-600', rarity: 'legendary' },
  { code: 'aria_first_chat', nameKey: 'achievements.assistantChat.name', descriptionKey: 'achievements.assistantChat.description', icon: '🤖', color: 'from-blue-600 to-indigo-700', rarity: 'common' },
  { code: 'study_room_join', nameKey: 'achievements.studyRoomJoin.name', descriptionKey: 'achievements.studyRoomJoin.description', icon: '🎓', color: 'from-emerald-500 to-teal-500', rarity: 'common' },
  { code: 'community_hello', nameKey: 'achievements.communityHello.name', descriptionKey: 'achievements.communityHello.description', icon: '🤝', color: 'from-rose-500 to-pink-500', rarity: 'common' },
];

const RARITY_COLORS = {
  common: '#C4582A',
  rare: '#1E40AF',
  epic: '#A14823',
  legendary: '#F5C99A',
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
    colors: [color, '#FBF4DE', '#C4582A'],
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

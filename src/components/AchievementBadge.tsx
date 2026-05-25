import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAchievements, type Achievement } from '@/hooks/useAchievements';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface AchievementBadgeProps {
  achievement: Achievement;
  unlocked: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function AchievementBadge({ achievement, unlocked, size = 'md' }: AchievementBadgeProps) {
  const { t } = useLanguage();
  const sizeClasses = {
    sm: 'w-12 h-12 text-2xl',
    md: 'w-16 h-16 text-3xl',
    lg: 'w-20 h-20 text-4xl',
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative inline-flex flex-col items-center">
            <div
              className={cn(
                'relative rounded-2xl flex items-center justify-center transition-all duration-300',
                sizeClasses[size],
                unlocked
                  ? `bg-gradient-to-br ${achievement.color} shadow-md hover:scale-110 hover:rotate-3 cursor-default`
                  : 'bg-muted grayscale opacity-50'
              )}
            >
              {unlocked ? (
                <span className="drop-shadow-md">{achievement.icon}</span>
              ) : (
                <Lock className="w-1/2 h-1/2 text-muted-foreground" />
              )}
              {unlocked && achievement.rarity === 'legendary' && (
                <span className="absolute inset-0 rounded-2xl ring-2 ring-amber-400 ring-offset-2 ring-offset-background animate-pulse" />
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <div className="space-y-1">
            <p className="font-semibold">{t(achievement.nameKey)}</p>
            <p className="text-xs opacity-80">{t(achievement.descriptionKey)}</p>
            {!unlocked && <p className="text-xs italic mt-1">🔒 {t('achievements.locked')}</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AchievementsGrid({ className }: { className?: string }) {
  const { achievements, isUnlocked, unlocked } = useAchievements();
  const { t } = useLanguage();
  const totalUnlocked = unlocked.length;

  return (
    <Card className={cn('overflow-hidden border-border/60', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-lg tracking-tight">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
            <Trophy className="w-5 h-5 text-white" />
          </div>
          {t('achievements.title')}
        </CardTitle>
        <CardDescription>
          {t('achievements.unlockedCount')
            .replace('{done}', String(totalUnlocked))
            .replace('{total}', String(achievements.length))}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 sm:grid-cols-5 gap-3">
          {achievements.map((a) => (
            <div key={a.code} className="flex justify-center">
              <AchievementBadge achievement={a} unlocked={isUnlocked(a.code)} size="md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Floating toast that pops in when an achievement is unlocked.
 * Mount this once at app level (e.g. in DashboardLayout).
 */
export function AchievementToast() {
  const { recentUnlock, dismissRecentUnlock } = useAchievements();
  const { t } = useLanguage();

  return (
    <AnimatePresence>
      {recentUnlock && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[10000]"
        >
          <Card className="overflow-hidden border-primary/40 shadow-2xl shadow-primary/20 backdrop-blur-xl bg-card/95 min-w-[320px]">
            <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />
            <CardContent className="p-4 flex items-center gap-4">
              <motion.div
                initial={{ rotate: -180, scale: 0 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
                className={cn(
                  'flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-md bg-gradient-to-br',
                  recentUnlock.color
                )}
              >
                <span className="drop-shadow-md">{recentUnlock.icon}</span>
              </motion.div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                  {t('achievements.newAchievement')}
                </p>
                <p className="font-bold tracking-tight truncate">{t(recentUnlock.nameKey)}</p>
                <p className="text-xs text-muted-foreground truncate">{t(recentUnlock.descriptionKey)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={dismissRecentUnlock}
              >
                <X className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

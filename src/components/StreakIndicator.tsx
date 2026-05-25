import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { useStreak } from '@/hooks/useStreak';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface StreakIndicatorProps {
  variant?: 'card' | 'compact' | 'pill';
  className?: string;
}

export function StreakIndicator({ variant = 'card', className }: StreakIndicatorProps) {
  const { current, longest, isAtRisk } = useStreak();
  const { t } = useLanguage();

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Flame className={cn('w-4 h-4', current > 0 ? 'text-orange-500 fill-orange-500/20' : 'text-muted-foreground')} />
        <span className="text-sm font-semibold tabular-nums">{current}</span>
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border',
          current > 0
            ? 'bg-gradient-to-r from-orange-500/15 to-red-500/15 border-orange-500/30 text-orange-700 dark:text-orange-300'
            : 'bg-muted border-border text-muted-foreground',
          className
        )}
      >
        <Flame className={cn('w-4 h-4', current > 0 && 'fill-orange-500/40')} />
        <span className="tabular-nums">{current}</span>
        <span className="text-xs opacity-80">{t('streak.daysInARow')}</span>
      </div>
    );
  }

  // Card variant
  return (
    <Card className={cn('overflow-hidden border-border/60 relative', className)}>
      {/* Decorative flame glow */}
      <div className="absolute -top-8 -end-8 w-32 h-32 bg-orange-500/10 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-8 -start-8 w-32 h-32 bg-red-500/5 rounded-full blur-2xl pointer-events-none" />

      <CardContent className="p-5 relative">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('streak.currentStreak')}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight">
                {current}
              </span>
              <span className="text-sm text-muted-foreground">{current === 1 ? t('streak.day') : t('streak.days')}</span>
            </div>
            {longest > 0 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {t('streak.best')}: <span className="font-semibold text-foreground">{longest}</span>
              </p>
            )}
          </div>

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="relative flex-shrink-0"
          >
            {current > 0 && (
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-orange-500 to-red-500 blur-lg opacity-40 animate-pulse" />
            )}
            <div
              className={cn(
                'relative w-14 h-14 rounded-2xl flex items-center justify-center shadow-md',
                current > 0
                  ? 'bg-gradient-to-br from-orange-400 via-orange-500 to-red-500'
                  : 'bg-muted'
              )}
            >
              <Flame
                className={cn(
                  'w-7 h-7',
                  current > 0 ? 'text-white drop-shadow-md' : 'text-muted-foreground'
                )}
              />
            </div>
          </motion.div>
        </div>

        {isAtRisk && current > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">
              ⚠️ {t('streak.atRisk')}
            </p>
          </div>
        )}

        {current === 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              {t('streak.startToday')} 🚀
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

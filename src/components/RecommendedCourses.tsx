import { Link } from 'react-router-dom';
import { Sparkles, ArrowLeft, ArrowRight, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecommendations, RecommendedCourse } from '@/hooks/useRecommendations';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface RecommendedCoursesProps {
  className?: string;
}

export function RecommendedCourses({ className }: RecommendedCoursesProps) {
  const { recommendations, loading } = useRecommendations(4);
  const { language, t } = useLanguage();
  const ArrowIcon = language === 'he' ? ArrowLeft : ArrowRight;

  const reasonLabel = (course: RecommendedCourse): string => {
    if (course.reasonType === 'unfinished') {
      return t('recommendations.continueProgress').replace(
        '{progress}',
        String(course.reasonData?.progress ?? 0)
      );
    }
    if (course.reasonType === 'kg_similar') {
      if (course.reasonData?.kgSource === 'concept_overlap') {
        return t('recommendations.sharedConcepts').replace(
          '{count}',
          String(course.reasonData?.sharedConcepts ?? 0)
        );
      }
      return t('recommendations.relatedContent');
    }
    if (course.reasonType === 'new') {
      return t('recommendations.newOnPlatform');
    }
    // Fallback to the raw reason field (legacy/edge cases)
    return course.reason;
  };

  // Hide entirely if not loading and no recommendations
  if (!loading && recommendations.length === 0) return null;

  return (
    <Card className={cn('overflow-hidden border-border/60 relative', className)}>
      {/* Decorative corner glow */}
      <div className="absolute top-0 end-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />

      <CardHeader className="pb-3 relative">
        <CardTitle className="flex items-center gap-2.5 text-lg tracking-tight">
          <div className="relative">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary to-accent blur-md opacity-40" />
            <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
          </div>
          {t('recommendations.title')}
        </CardTitle>
        <CardDescription>
          {t('recommendations.subtitle')}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-xl border border-border/50">
                <Skeleton className="w-16 h-16 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recommendations.map((course, index) => (
              <motion.div
                key={course.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.06, ease: [0.33, 1, 0.68, 1] }}
              >
                <Link
                  to={`/courses/${course.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border/50 hover:bg-primary/5 hover:border-primary/30 transition-all duration-200 group h-full"
                >
                  {/* Thumbnail or icon fallback */}
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-primary/10 to-accent/10 group-hover:scale-105 transition-transform">
                    {course.thumbnail_url ? (
                      <img
                        src={course.thumbnail_url}
                        alt={course.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookOpen className="w-7 h-7 text-primary/40" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                      {course.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={cn(
                          'inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full',
                          course.reasonType === 'unfinished'
                            ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                            : course.reasonType === 'new'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-primary/15 text-primary'
                        )}
                      >
                        {reasonLabel(course)}
                      </span>
                    </div>
                  </div>

                  <ArrowIcon className="w-4 h-4 text-primary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all flex-shrink-0" />
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

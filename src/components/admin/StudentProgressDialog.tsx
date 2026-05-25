import { useState, useEffect } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronLeft, Circle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { he, enUS } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';

interface StudentProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    id: string;
    full_name: string;
    email: string;
  } | null;
}

interface Enrollment {
  course_id: string;
  progress_percentage: number;
  enrolled_at: string;
  course: {
    id: string;
    title: string;
    thumbnail_url: string | null;
    order_index: number | null;
  };
}

interface Lesson {
  id: string;
  title: string;
  order_index: number;
  lesson_type: string;
}

interface Module {
  id: string;
  title: string;
  order_index: number;
  lessons: Lesson[];
}

export function StudentProgressDialog({ open, onOpenChange, user }: StudentProgressDialogProps) {
  const { t, language } = useLanguage();

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Course detail view
  const [selectedCourse, setSelectedCourse] = useState<Enrollment | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(new Set());
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open && user) {
      fetchEnrollments();
    }
  }, [open, user]);

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setSelectedCourse(null);
      setModules([]);
      setCompletedLessons(new Set());
      setExpandedModules(new Set());
    }
  }, [open]);

  const fetchEnrollments = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('enrollments')
        .select(`
          course_id,
          progress_percentage,
          enrolled_at,
          courses (
            id,
            title,
            thumbnail_url,
            order_index
          )
        `)
        .eq('user_id', user.id);

      if (error) throw error;

      // Transform data to match our interface and sort by course order_index
      const transformedData: Enrollment[] = (data || [])
        .filter(e => e.courses)
        .map(e => ({
          course_id: e.course_id,
          progress_percentage: e.progress_percentage,
          enrolled_at: e.enrolled_at,
          course: e.courses as unknown as Enrollment['course']
        }))
        .sort((a, b) => (a.course.order_index ?? 999) - (b.course.order_index ?? 999));

      setEnrollments(transformedData);
    } catch (error) {
      console.error('Error fetching enrollments:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCourseDetails = async (courseId: string) => {
    if (!user) return;
    
    setLoadingDetails(true);
    try {
      // Fetch modules with lessons
      const { data: modulesData, error: modulesError } = await supabase
        .from('modules')
        .select(`
          id,
          title,
          order_index,
          lessons (
            id,
            title,
            order_index,
            lesson_type
          )
        `)
        .eq('course_id', courseId)
        .order('order_index');

      if (modulesError) throw modulesError;

      // Sort lessons within each module
      const sortedModules = (modulesData || []).map(module => ({
        ...module,
        lessons: (module.lessons || []).sort((a, b) => a.order_index - b.order_index)
      }));

      setModules(sortedModules);

      // Expand all modules by default
      setExpandedModules(new Set(sortedModules.map(m => m.id)));

      // Fetch completed lessons for this user
      const allLessonIds = sortedModules.flatMap(m => m.lessons.map(l => l.id));
      
      if (allLessonIds.length > 0) {
        const { data: completionsData, error: completionsError } = await supabase
          .from('lesson_completions')
          .select('lesson_id')
          .eq('user_id', user.id)
          .in('lesson_id', allLessonIds);

        if (completionsError) throw completionsError;

        setCompletedLessons(new Set((completionsData || []).map(c => c.lesson_id)));
      } else {
        setCompletedLessons(new Set());
      }
    } catch (error) {
      console.error('Error fetching course details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleCourseClick = (enrollment: Enrollment) => {
    setSelectedCourse(enrollment);
    fetchCourseDetails(enrollment.course_id);
  };

  const handleBack = () => {
    setSelectedCourse(null);
    setModules([]);
    setCompletedLessons(new Set());
    setExpandedModules(new Set());
  };

  const toggleModule = (moduleId: string) => {
    const newExpanded = new Set(expandedModules);
    if (newExpanded.has(moduleId)) {
      newExpanded.delete(moduleId);
    } else {
      newExpanded.add(moduleId);
    }
    setExpandedModules(newExpanded);
  };

  const getLessonTypeIcon = (type: string) => {
    switch (type) {
      case 'video': return '🎬';
      case 'file': return '📄';
      case 'exam': return '📝';
      case 'embed': return '🌐';
      default: return '📖';
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col" dir="rtl">
        <DialogHeader>
          {selectedCourse ? (
            <div className="flex items-center gap-2 flex-row-reverse">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                className="shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div className="min-w-0 flex-1 text-right">
                <DialogTitle className="truncate">{selectedCourse.course.title}</DialogTitle>
                <DialogDescription>
                  {Math.round(selectedCourse.progress_percentage)}% {t('admin.completed')}
                </DialogDescription>
              </div>
            </div>
          ) : (
            <>
              <DialogTitle>
                {t('admin.studentProgress')}: {user.full_name}
              </DialogTitle>
              <DialogDescription>
                {t('admin.enrolledCoursesList')}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6 max-h-[60vh] overflow-y-auto">
          {selectedCourse ? (
            // Course detail view - modules and lessons
            <div className="space-y-3 py-2">
              {loadingDetails ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : modules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t('studentProgress.noLessons')}
                </div>
              ) : (
                modules.map(module => (
                  <Collapsible
                    key={module.id}
                    open={expandedModules.has(module.id)}
                    onOpenChange={() => toggleModule(module.id)}
                  >
                    <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted/50 rounded-lg transition-colors flex-row-reverse text-right">
                      {expandedModules.has(module.id) ? (
                        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronLeft className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-medium text-sm truncate flex-1">{module.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {module.lessons.filter(l => completedLessons.has(l.id)).length}/{module.lessons.length}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pe-6 space-y-1 mt-1">
                      {module.lessons.map(lesson => {
                        const isCompleted = completedLessons.has(lesson.id);
                        return (
                          <div
                            key={lesson.id}
                            className={`flex items-center gap-2 p-2 rounded-md text-sm flex-row-reverse text-right ${
                              isCompleted ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {isCompleted ? (
                              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <Circle className="w-4 h-4 shrink-0" />
                            )}
                            <span className="shrink-0">{getLessonTypeIcon(lesson.lesson_type)}</span>
                            <span className="truncate flex-1">{lesson.title}</span>
                          </div>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                ))
              )}
            </div>
          ) : (
            // Course list view
            <div className="space-y-3 py-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : enrollments.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">{t('admin.noEnrollments')}</p>
                </div>
              ) : (
                enrollments.map(enrollment => (
                  <button
                    key={enrollment.course_id}
                    onClick={() => handleCourseClick(enrollment)}
                    className="w-full text-right p-3 rounded-lg border hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-2 flex-row-reverse">
                      <div className="flex items-center gap-2 min-w-0 flex-row-reverse">
                        <BookOpen className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-medium truncate">{enrollment.course.title}</span>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                    </div>
                    <Progress value={enrollment.progress_percentage} className="h-2 mb-2" dir="ltr" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground flex-row-reverse">
                      <span>{Math.round(enrollment.progress_percentage)}%</span>
                      <span>
                        {t('admin.enrolledAt')}: {format(new Date(enrollment.enrolled_at), language === 'he' ? 'd בMMM yyyy' : 'd MMM yyyy', {
                          locale: language === 'he' ? he : enUS
                        })}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

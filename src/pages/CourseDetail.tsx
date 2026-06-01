import { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { BookOpen, Play, Pause, CheckCircle, Clock, Download, ChevronDown, ChevronRight, ArrowRight, ArrowLeft, StickyNote, FileText, ClipboardList, Lock, FileInput, File, ExternalLink, Calendar, Star, EyeOff, Info } from 'lucide-react';
import { format } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import DOMPurify from 'dompurify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import ExamTaker from '@/components/ExamTaker';
import LessonVideoPlayer from '@/components/LessonVideoPlayer';
import { useVideoDuration } from '@/hooks/useVideoDuration';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Label } from '@/components/ui/label';
import { NewBadge } from '@/components/NewBadge';
import { useLessonBookmarks } from '@/hooks/useLessonBookmarks';

interface Course {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  instructor_name: string;
  payment_url: string | null;
  is_published: boolean;
  created_at: string;
  order_index: number | null;
}
interface Module {
  id: string;
  title: string;
  description: string | null;
  order_index: number;
  lessons: Lesson[];
  created_at: string;
}
interface Lesson {
  id: string;
  title: string;
  video_url: string | null;
  content_text: string | null;
  resources_url: string | null;
  order_index: number;
  duration_minutes: number | null;
  is_completed: boolean;
  is_hidden: boolean;
  lesson_type: string;
  file_url: string | null;
  exam_id: string | null;
  embed_url: string | null;
  updated_at: string;
  created_at: string;
}
interface Note {
  id: string;
  note_text: string;
  video_timestamp: number | null;
  created_at: string;
}
interface Note {
  id: string;
  note_text: string;
  video_timestamp: number | null;
  created_at: string;
}
export default function CourseDetail() {
  const {
    id
  } = useParams<{
    id: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    user,
    isAdminOrInstructor
  } = useAuth();
  const navigate = useNavigate();
  const {
    t,
    language
  } = useLanguage();
  const {
    toast
  } = useToast();
  const { completeStep } = useOnboarding();

  // Auto-mark first_lesson onboarding step on visit
  useEffect(() => {
    completeStep('first_lesson');
  }, [completeStep]);

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [openModules, setOpenModules] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [nextCourse, setNextCourse] = useState<{ id: string; title: string } | null>(null);
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState<boolean>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('lessonAutoAdvance') : null;
    return stored === null ? true : stored === 'true';
  });
  const [shouldAutoplay, setShouldAutoplay] = useState(false);

  useEffect(() => {
    localStorage.setItem('lessonAutoAdvance', String(autoAdvanceEnabled));
  }, [autoAdvanceEnabled]);
  // Get all video lessons for duration calculation
  const allLessons = useMemo(() => {
    return modules.flatMap(m => m.lessons);
  }, [modules]);

  const videoDurations = useVideoDuration(allLessons);

  const allLessonIds = useMemo(() => allLessons.map(l => l.id), [allLessons]);
  const { isBookmarked, toggleBookmark } = useLessonBookmarks(allLessonIds);

  // Sequential unlock: each lesson is gated by completion of the previous
  // one in the course (ordered by module.order_index then lesson.order_index).
  // The first lesson is always open. Admins / instructors bypass entirely.
  // Server-side mirror of this lives in is_lesson_unlocked() (migration
  // 20260601100000) so completion writes are validated for tampering too.
  const lockedLessonIds = useMemo(() => {
    const locked = new Set<string>();
    if (isAdminOrInstructor) return locked;
    const ordered = [...modules]
      .sort((a, b) => a.order_index - b.order_index)
      .flatMap(m =>
        [...m.lessons].sort((a, b) => a.order_index - b.order_index),
      );
    let prevCompleted = true; // virtual "lesson 0" is complete
    for (const lesson of ordered) {
      if (!prevCompleted) locked.add(lesson.id);
      prevCompleted = lesson.is_completed;
    }
    return locked;
  }, [modules, isAdminOrInstructor]);

  const isLessonLocked = (lessonId: string) => lockedLessonIds.has(lessonId);

  const handleSelectLesson = (lesson: Lesson, opts?: { autoplay?: boolean }) => {
    if (isLessonLocked(lesson.id)) {
      toast({
        title: t('courseDetail.lessonLocked'),
        description: t('courseDetail.lessonLockedDesc'),
        variant: 'destructive',
      });
      return;
    }
    if (opts?.autoplay) setShouldAutoplay(true);
    setSelectedLesson(lesson);
  };

  useEffect(() => {
    if (id) {
      fetchCourseData();
    }
  }, [id, user]);
  const fetchCourseData = async () => {
    try {
      const {
        data: courseData
      } = await supabase.from('courses').select('*').eq('id', id).single();
      
      if (courseData) {
        let instructorName = t('courses.instructor');
        if (courseData.instructor_id) {
          // Profiles are the single source of truth post tenant_memberships drop.
          const { data: instructorData } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', courseData.instructor_id)
            .single();
          instructorName = instructorData?.full_name || t('courses.instructor');
        }
        setCourse({
          ...courseData,
          instructor_name: instructorName,
          payment_url: (courseData as any).payment_url || null,
          order_index: courseData.order_index ?? null,
        });
        
        // Check if user has access to this course
        if (user) {
          if (isAdminOrInstructor) {
            setHasAccess(true);
          } else {
            const { data: enrollment } = await supabase
              .from('enrollments')
              .select('id')
              .eq('user_id', user.id)
              .eq('course_id', id)
              .single();
            setHasAccess(!!enrollment);
          }
        } else {
          setHasAccess(false);
        }
      }
      
      const {
        data: modulesData
      } = await supabase.from('modules').select(`*, lessons(*)`).eq('course_id', id).order('order_index');
      let completedLessonIds: string[] = [];
      if (user) {
        const {
          data: completions
        } = await supabase.from('lesson_completions').select('lesson_id').eq('user_id', user.id);
        completedLessonIds = completions?.map(c => c.lesson_id) || [];
      }
      if (modulesData) {
        const processedModules = modulesData.map((m: any) => ({
          ...m,
          lessons: (m.lessons || [])
            .filter((l: any) => isAdminOrInstructor || !l.is_hidden)
            .sort((a: any, b: any) => a.order_index - b.order_index)
            .map((l: any) => ({
              ...l,
              is_completed: completedLessonIds.includes(l.id)
            }))
        }));
        setModules(processedModules);
        if (processedModules.length > 0 && openModules.length === 0) {
          setOpenModules([processedModules[0].id]);
        }
        const totalLessons = processedModules.reduce((acc: number, m: Module) => acc + m.lessons.length, 0);
        const completedCount = processedModules.reduce((acc: number, m: Module) => acc + m.lessons.filter(l => l.is_completed).length, 0);
        setProgress(totalLessons > 0 ? Math.round(completedCount / totalLessons * 100) : 0);
        
        // Compute lock state once for this fetch so initial selection
        // (URL param, "first uncompleted", or fallback) can skip locked
        // lessons — same rule as the lockedLessonIds memo, just inlined
        // because the memo depends on the modules state we're about to set.
        const orderedAll = [...processedModules]
          .sort((a: Module, b: Module) => a.order_index - b.order_index)
          .flatMap((m: Module) =>
            [...m.lessons].sort((a, b) => a.order_index - b.order_index),
          );
        const lockedNow = new Set<string>();
        if (!isAdminOrInstructor) {
          let prevDone = true;
          for (const l of orderedAll) {
            if (!prevDone) lockedNow.add(l.id);
            prevDone = l.is_completed;
          }
        }

        // Only auto-select lesson on initial load, not on refreshes
        if (!selectedLesson) {
          const lessonIdFromUrl = searchParams.get('lesson');
          let targetLesson: Lesson | undefined;
          if (lessonIdFromUrl) {
            const candidate = processedModules.flatMap((m: Module) => m.lessons).find((l: Lesson) => l.id === lessonIdFromUrl);
            // Reject deep-linked locked lessons (e.g. from bot citations
            // or stale tabs) — fall through to first-unlocked instead of
            // landing on a paywall page.
            if (candidate && !lockedNow.has(candidate.id)) {
              targetLesson = candidate;
              setSearchParams({}, { replace: true });
              const parentModule = processedModules.find((m: Module) => m.lessons.some((l: Lesson) => l.id === lessonIdFromUrl));
              if (parentModule && !openModules.includes(parentModule.id)) {
                setOpenModules(prev => [...prev, parentModule.id]);
              }
            } else if (candidate && lockedNow.has(candidate.id)) {
              // Drop the URL param so a refresh doesn't re-trigger the
              // locked-target landing.
              setSearchParams({}, { replace: true });
            }
          }
          if (!targetLesson) {
            // First lesson that's not completed AND not locked — for a
            // fresh enrollee this is always the very first lesson.
            targetLesson = orderedAll.find((l: Lesson) => !l.is_completed && !lockedNow.has(l.id));
          }
          setSelectedLesson(targetLesson || processedModules[0]?.lessons[0] || null);
        } else {
          // Update the current lesson's completion status
          const updatedLesson = processedModules.flatMap((m: Module) => m.lessons).find((l: Lesson) => l.id === selectedLesson.id);
          if (updatedLesson) {
            setSelectedLesson(updatedLesson);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching course:', error);
    } finally {
      setLoading(false);
    }
  };
  const fetchNotes = async (lessonId: string) => {
    if (!user) return;
    const {
      data
    } = await supabase.from('user_notes').select('*').eq('user_id', user.id).eq('lesson_id', lessonId).order('created_at', {
      ascending: false
    });
    setNotes(data || []);
  };
  // Handle ?lesson= param changes (e.g. from AI chat source clicks)
  useEffect(() => {
    const lessonIdFromUrl = searchParams.get('lesson');
    if (lessonIdFromUrl && modules.length > 0) {
      const targetLesson = modules.flatMap(m => m.lessons).find(l => l.id === lessonIdFromUrl);
      if (targetLesson && targetLesson.id !== selectedLesson?.id) {
        if (isLessonLocked(targetLesson.id)) {
          // Locked deep-link — surface a toast instead of silently swapping.
          toast({
            title: t('courseDetail.lessonLocked'),
            description: t('courseDetail.lessonLockedDesc'),
            variant: 'destructive',
          });
          setSearchParams({}, { replace: true });
          return;
        }
        setSelectedLesson(targetLesson);
        const parentModule = modules.find(m => m.lessons.some(l => l.id === lessonIdFromUrl));
        if (parentModule && !openModules.includes(parentModule.id)) {
          setOpenModules(prev => [...prev, parentModule.id]);
        }
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, modules, lockedLessonIds]);

  useEffect(() => {
    if (selectedLesson) {
      fetchNotes(selectedLesson.id);
    }
  }, [selectedLesson]);
  const handleMarkComplete = async () => {
    if (!user || !selectedLesson) return;
    
    const wasCompleted = selectedLesson.is_completed;
    
    try {
      if (wasCompleted) {
        await supabase.from('lesson_completions').delete().eq('user_id', user.id).eq('lesson_id', selectedLesson.id);
      } else {
        await supabase.from('lesson_completions').insert({
          user_id: user.id,
          lesson_id: selectedLesson.id
        });
      }
      
      // Calculate the new progress based on current state
      const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);
      
      // Count currently completed lessons excluding the current one, then add/subtract based on action
      const otherCompletedCount = modules.reduce((acc, m) => 
        acc + m.lessons.filter(l => l.is_completed && l.id !== selectedLesson.id).length, 0
      );
      
      // If we just marked it complete, add 1. If we unmarked it, add 0.
      const newCompletedCount = otherCompletedCount + (wasCompleted ? 0 : 1);
      const newProgress = totalLessons > 0 ? Math.round((newCompletedCount / totalLessons) * 100) : 0;
      
      const { error: updateError } = await supabase.from('enrollments').update({
        progress_percentage: newProgress
      }).eq('user_id', user.id).eq('course_id', id);
      
      if (updateError) {
        console.error('Error updating enrollment progress:', updateError);
      }
      
      await fetchCourseData();
      
      toast({
        title: wasCompleted ? t('courseDetail.lessonUnmarked') : t('courseDetail.lessonCompleted'),
        description: wasCompleted ? t('courseDetail.lessonUnmarkedDesc') : t('courseDetail.lessonCompletedDesc')
      });
    } catch (error) {
      console.error('Error updating completion:', error);
    }
  };
  const handleVideoEnded = async () => {
    if (!autoAdvanceEnabled || !selectedLesson || !user) return;

    const lessonId = selectedLesson.id;
    const wasCompleted = selectedLesson.is_completed;
    const next = getNextLesson;

    if (!wasCompleted) {
      try {
        await supabase.from('lesson_completions').insert({
          user_id: user.id,
          lesson_id: lessonId,
        });

        const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);
        const otherCompletedCount = modules.reduce(
          (acc, m) => acc + m.lessons.filter(l => l.is_completed && l.id !== lessonId).length,
          0
        );
        const newCompletedCount = otherCompletedCount + 1;
        const newProgress = totalLessons > 0 ? Math.round((newCompletedCount / totalLessons) * 100) : 0;

        setModules(prev => prev.map(m => ({
          ...m,
          lessons: m.lessons.map(l => l.id === lessonId ? { ...l, is_completed: true } : l),
        })));
        setProgress(newProgress);
        setSelectedLesson(prev => prev && prev.id === lessonId ? { ...prev, is_completed: true } : prev);

        await supabase.from('enrollments').update({
          progress_percentage: newProgress,
        }).eq('user_id', user.id).eq('course_id', id);
      } catch (error) {
        console.error('Error auto-marking lesson complete:', error);
      }
    }

    if (next) {
      // Safety: after marking the current lesson complete the next one is
      // unlocked, but if anything is off (admin re-ordered mid-watch,
      // duplicate order_index, etc.) refuse to auto-jump into a locked
      // lesson — better to stop than to send the user to a blocked page.
      if (!isAdminOrInstructor && lockedLessonIds.has(next.id)) return;
      setShouldAutoplay(true);
      setSelectedLesson(next);
      if ('moduleId' in next) {
        const moduleId = (next as any).moduleId;
        setOpenModules(prev => prev.includes(moduleId) ? prev : [...prev, moduleId]);
      }
    }
  };

  const handleAddNote = async () => {
    if (!user || !selectedLesson || !newNote.trim()) return;
    try {
      await supabase.from('user_notes').insert({
        user_id: user.id,
        lesson_id: selectedLesson.id,
        note_text: newNote.trim()
      });
      setNewNote('');
      fetchNotes(selectedLesson.id);
      toast({
        title: t('courseDetail.noteSaved'),
        description: t('courseDetail.noteSavedDesc')
      });
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };
  const toggleModule = (moduleId: string) => {
    setOpenModules(prev => prev.includes(moduleId) ? prev.filter(id => id !== moduleId) : [...prev, moduleId]);
  };

  // Get the next lesson across all modules
  const getNextLesson = useMemo(() => {
    if (!selectedLesson || modules.length === 0) return null;
    const allOrderedLessons = modules
      .sort((a, b) => a.order_index - b.order_index)
      .flatMap(m => m.lessons.sort((a, b) => a.order_index - b.order_index).map(l => ({ ...l, moduleId: m.id })));
    const currentIndex = allOrderedLessons.findIndex(l => l.id === selectedLesson.id);
    if (currentIndex === -1 || currentIndex >= allOrderedLessons.length - 1) return null;
    return allOrderedLessons[currentIndex + 1];
  }, [selectedLesson, modules]);

  // Fetch next course when there's no next lesson
  useEffect(() => {
    const fetchNextCourse = async () => {
      if (getNextLesson || !course || !user) {
        setNextCourse(null);
        return;
      }
      try {
        const currentOrderIndex = course.order_index ?? 0;
        // Get next published course with higher order_index
        const { data: candidates } = await supabase
          .from('courses')
          .select('id, title, order_index')
          .eq('is_published', true)
          .gt('order_index', currentOrderIndex)
          .order('order_index', { ascending: true })
          .limit(10);
        if (!candidates || candidates.length === 0) {
          setNextCourse(null);
          return;
        }
        
        // Check which ones the user is enrolled in
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('course_id')
          .eq('user_id', user.id)
          .in('course_id', candidates.map(c => c.id));
        
        const enrolledIds = new Set(enrollments?.map(e => e.course_id) || []);
        const next = candidates.find(c => enrolledIds.has(c.id));
        setNextCourse(next ? { id: next.id, title: next.title } : null);
      } catch (error) {
        console.error('Error fetching next course:', error);
        setNextCourse(null);
      }
    };
    fetchNextCourse();
  }, [getNextLesson, course, user]);
  const getYouTubeEmbedUrl = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? `https://www.youtube.com/embed/${match[2]}` : url;
  };
  if (loading) {
    return (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
    );
  }
  if (!course) {
    return (
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">{t('courseDetail.courseNotFound')}</h2>
          <Button asChild>
            <Link to="/courses">{t('courseDetail.backToCourses')}</Link>
          </Button>
        </div>
    );
  }

  // Show access denied if user is not enrolled
  if (hasAccess === false) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
            <Lock className="w-10 h-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold mb-2">{t('courseDetail.accessDenied')}</h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            {t('courseDetail.accessDeniedDesc')}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" asChild>
              <Link to="/courses">{t('courseDetail.backToCourses')}</Link>
            </Button>
            {course.payment_url && (
              <Button asChild>
                <a href={course.payment_url} target="_blank" rel="noopener noreferrer">
                  {t('courseDetail.enrollNow')}
                </a>
              </Button>
            )}
          </div>
        </div>
    );
  }
  return (
      <div className="space-y-6">
        {/* Premium Course Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/15 via-card to-accent/10 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-56 h-56 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-56 h-56 bg-accent/15 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="rounded-xl bg-card/60 backdrop-blur-sm hover:bg-card border border-border/50">
              <Link to="/courses">
                <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{course.title}</h1>
              <p className="text-muted-foreground mt-1 truncate">{course.instructor_name}</p>
            </div>
            <div className="hidden sm:flex flex-col items-end gap-1.5">
              <span className="text-sm font-semibold text-primary">{progress}{t('courseDetail.complete')}</span>
              <Progress value={progress} className="w-36 h-2" />
            </div>
          </div>
        </div>


        {/* Next Lesson / Next Course Navigation */}
        {selectedLesson && (
          <div className="flex justify-start">
            {getNextLesson ? (
              <Button
                variant="outline"
                className="gap-2"
                disabled={!isAdminOrInstructor && lockedLessonIds.has(getNextLesson.id)}
                onClick={() => {
                  const next = getNextLesson;
                  if (!isAdminOrInstructor && lockedLessonIds.has(next.id)) {
                    toast({
                      title: t('courseDetail.lessonLocked'),
                      description: t('courseDetail.lessonLockedDesc'),
                      variant: 'destructive',
                    });
                    return;
                  }
                  setShouldAutoplay(true);
                  setSelectedLesson(next);
                  // Open the module containing the next lesson
                  if ('moduleId' in next) {
                    setOpenModules(prev => prev.includes((next as any).moduleId) ? prev : [...prev, (next as any).moduleId]);
                  }
                }}
              >
                {`${t('courseDetail.nextLessonLabel')}: ${getNextLesson.title}`}
                <ArrowLeft className="w-4 h-4" />
              </Button>
            ) : nextCourse ? (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => navigate(`/courses/${nextCourse.id}`)}
              >
                {`${t('courseDetail.nextCourseLabel')}: ${nextCourse.title}`}
                <ArrowLeft className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                variant="outline"
                className="gap-2"
                asChild
              >
                <Link to="/courses">
                  {t('courseDetail.backToCourses')}
                  <ArrowLeft className="w-4 h-4" />
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {selectedLesson && <>
                {/* Video Player - for video lessons */}
                {selectedLesson.lesson_type === 'video' && selectedLesson.video_url && <div className="aspect-video bg-secondary rounded-lg overflow-hidden">
                    <LessonVideoPlayer
                      videoUrl={selectedLesson.video_url}
                      lessonId={selectedLesson.id}
                      autoplay={shouldAutoplay}
                      onEnded={handleVideoEnded}
                    />
                  </div>}

                {/* File Preview - for file lessons */}
                {selectedLesson.lesson_type === 'file' && selectedLesson.file_url && <Card>
                    <CardContent className="p-6">
                      <div className="space-y-4">
                        <iframe 
                          key={`file-viewer-${selectedLesson.id}`}
                          src={`https://docs.google.com/viewer?url=${encodeURIComponent(selectedLesson.file_url)}&embedded=true&timestamp=${selectedLesson.id}`} 
                          className="w-full h-[600px] rounded-lg border bg-white" 
                          title={selectedLesson.title} 
                        />
                        <div className="flex gap-2">
                          <Button variant="outline" asChild className="flex-1">
                            <a href={selectedLesson.file_url} target="_blank" rel="noopener noreferrer">
                              {t('courseDetail.openInNewTab')}
                            </a>
                          </Button>
                          <Button variant="outline" asChild className="flex-1">
                            <a href={selectedLesson.file_url} download>
                              <Download className="w-4 h-4 ml-2" />
                              {t('courseDetail.downloadFile')}
                            </a>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>}

                {/* Exam - for exam lessons */}
                {selectedLesson.lesson_type === 'exam' && selectedLesson.exam_id && <ExamTaker examId={selectedLesson.exam_id} onComplete={() => {
              if (!selectedLesson.is_completed) {
                handleMarkComplete();
              }
            }} />}

                {/* Embed - for Fillout and other embedded content */}
                {selectedLesson.lesson_type === 'embed' && selectedLesson.embed_url && <Card>
                    <CardContent className="p-6">
                      <div className="space-y-4">
                        <iframe 
                          src={selectedLesson.embed_url} 
                          className="w-full min-h-[600px] rounded-lg border" 
                          title={selectedLesson.title}
                          allow="camera; microphone; autoplay; encrypted-media"
                        />
                      </div>
                    </CardContent>
                  </Card>}

                {/* Last Updated Date - shown between content and description card */}
                {selectedLesson.updated_at && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>
                      {t('courseDetail.lastUpdated')}{' '}
                      {format(new Date(selectedLesson.updated_at), language === 'he' ? 'd בMMM yyyy' : 'd MMM yyyy', { locale: language === 'he' ? he : language === 'es' ? es : enUS })}
                    </span>
                  </div>
                )}

                {/* Lesson Info - for video lessons with tabs */}
                {selectedLesson.lesson_type === 'video' && <Card>
                    <CardHeader className="pb-3">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="break-words">{selectedLesson.title}</CardTitle>
                          {selectedLesson.duration_minutes && <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="w-3 h-3" />
                              {selectedLesson.duration_minutes} {t('common.min')}
                            </p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:flex-shrink-0">
                          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5">
                            <SwitchPrimitives.Root
                              id="auto-advance-switch"
                              checked={autoAdvanceEnabled}
                              onCheckedChange={setAutoAdvanceEnabled}
                              dir="ltr"
                              className="peer relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <SwitchPrimitives.Thumb className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0">
                                {autoAdvanceEnabled
                                  ? <Play className="w-3 h-3 text-primary fill-primary" />
                                  : <Pause className="w-3 h-3 text-muted-foreground fill-muted-foreground" />}
                              </SwitchPrimitives.Thumb>
                            </SwitchPrimitives.Root>
                            <Label htmlFor="auto-advance-switch" className="text-sm cursor-pointer select-none">
                              {t('courseDetail.autoAdvanceLabel')}
                            </Label>
                            <Tooltip delayDuration={100}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  aria-label={t('courseDetail.autoAdvanceTooltip')}
                                >
                                  <Info className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-xs text-right">
                                {t('courseDetail.autoAdvanceTooltip')}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Button variant={selectedLesson.is_completed ? "secondary" : "default"} onClick={handleMarkComplete}>
                            {selectedLesson.is_completed ? <>
                                <CheckCircle className="w-4 h-4 ml-2" />
                                {t('courseDetail.completed')}
                              </> : t('courseDetail.markComplete')}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue="description" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="description">{t('courseDetail.description')}</TabsTrigger>
                          <TabsTrigger value="resources">{t('courseDetail.usefulResources')}</TabsTrigger>
                        </TabsList>
                        <TabsContent value="description" className="mt-4">
                          {selectedLesson.content_text ? (
                            <div
                              className="rich-content text-muted-foreground"
                              dir={language === 'he' ? 'rtl' : 'ltr'}
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedLesson.content_text) }}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground">{t('courseDetail.noDescription')}</p>
                          )}
                        </TabsContent>
                        <TabsContent value="resources" className="mt-4">
                          {selectedLesson.resources_url ? (
                            <div className="space-y-3">
                              {(() => {
                                // Parse resources - try JSON first, fallback to comma-separated
                                let resourceList: { name: string; url: string }[] = [];
                                try {
                                  const parsed = JSON.parse(selectedLesson.resources_url);
                                  if (Array.isArray(parsed)) resourceList = parsed;
                                } catch {
                                  resourceList = selectedLesson.resources_url.split(',').map((url, i) => ({
                                    name: decodeURIComponent(url.trim().split('/').pop() || `${t('courseDetail.resource')} ${i + 1}`),
                                    url: url.trim()
                                  })).filter(r => r.url);
                                }
                                return resourceList.map((resource, index) => (
                                  <div key={index} className="flex items-center gap-3 p-3 rounded-lg border bg-secondary/30 hover:bg-secondary/50 transition-colors">
                                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                      <File className="w-5 h-5 text-primary" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{resource.name}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button variant="ghost" size="icon" asChild>
                                        <a href={resource.url} target="_blank" rel="noopener noreferrer">
                                          <ExternalLink className="w-4 h-4" />
                                        </a>
                                      </Button>
                                      <Button variant="ghost" size="icon" asChild>
                                        <a href={`${resource.url}?download=`} download={resource.name}>
                                          <Download className="w-4 h-4" />
                                        </a>
                                      </Button>
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          ) : (
                            <div className="text-center py-8">
                              <File className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                              <p className="text-sm text-muted-foreground">{t('courseDetail.noResources')}</p>
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>}

                {/* Lesson Info - for non-video, non-exam lessons */}
                {selectedLesson.lesson_type !== 'exam' && selectedLesson.lesson_type !== 'video' && <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle>{selectedLesson.title}</CardTitle>
                          {selectedLesson.duration_minutes && <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="w-3 h-3" />
                              {selectedLesson.duration_minutes} {t('common.min')}
                            </p>}
                        </div>
                        <Button variant={selectedLesson.is_completed ? "secondary" : "default"} onClick={handleMarkComplete}>
                          {selectedLesson.is_completed ? <>
                              <CheckCircle className="w-4 h-4 ml-2" />
                              {t('courseDetail.completed')}
                            </> : t('courseDetail.markComplete')}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                    {selectedLesson.content_text && (
                          <div
                            className="rich-content text-muted-foreground"
                            dir={language === 'he' ? 'rtl' : 'ltr'}
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedLesson.content_text) }}
                          />
                        )}
                      
                      {selectedLesson.resources_url && <div className="mt-4 pt-4 border-t">
                          <Button variant="outline" asChild>
                            <a href={selectedLesson.resources_url} target="_blank" rel="noopener noreferrer">
                              <Download className="w-4 h-4 ml-2" />
                              {t('courseDetail.downloadResources')}
                            </a>
                          </Button>
                        </div>}
                    </CardContent>
                  </Card>}
              </>}
          </div>

          {/* Sidebar - Course Content + Notes */}
          <div className="space-y-4 order-first lg:order-last">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('courseDetail.courseContent')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {modules.reduce((acc, m) => acc + m.lessons.length, 0)} {t('courseDetail.lessons')}
                </p>
              </CardHeader>
              {selectedLesson && (
                <div className="flex items-center gap-2 px-4 pb-3 border-b">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn("gap-1.5 flex-1", isBookmarked(selectedLesson.id, 'favorite') && "text-yellow-500")}
                    onClick={() => toggleBookmark(selectedLesson.id, 'favorite')}
                  >
                    <Star className={cn("w-4 h-4", isBookmarked(selectedLesson.id, 'favorite') && "fill-yellow-500")} />
                    <span className="text-xs">
                      {isBookmarked(selectedLesson.id, 'favorite') ? t('courseDetail.removeFromFavorites') : t('courseDetail.addToFavorites')}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn("gap-1.5 flex-1", isBookmarked(selectedLesson.id, 'watch_later') && "text-blue-500")}
                    onClick={() => toggleBookmark(selectedLesson.id, 'watch_later')}
                  >
                    <Clock className={cn("w-4 h-4", isBookmarked(selectedLesson.id, 'watch_later') && "fill-blue-500")} />
                    <span className="text-xs">
                      {isBookmarked(selectedLesson.id, 'watch_later') ? t('courseDetail.removeFromWatchLater') : t('courseDetail.addToWatchLater')}
                    </span>
                  </Button>
                </div>
              )}
              <CardContent className="p-0">
                <div className="max-h-[250px] lg:max-h-[600px] overflow-y-auto">
                  {modules.map(module => <Collapsible key={module.id} open={openModules.includes(module.id)} onOpenChange={() => toggleModule(module.id)}>
                      <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/50 border-b">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-start">{module.title}</span>
                          <NewBadge createdAt={module.created_at} />
                        </div>
                        {openModules.includes(module.id) ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {module.lessons.map(lesson => {
                      const locked = isLessonLocked(lesson.id);
                      const LessonIcon = locked ? Lock :
                        lesson.is_completed ? CheckCircle :
                        lesson.lesson_type === 'file' ? FileText :
                        lesson.lesson_type === 'exam' ? ClipboardList :
                        lesson.lesson_type === 'embed' ? FileInput : Play;
                      const lessonDuration = videoDurations[lesson.id];
                      return (
                        <button
                          key={lesson.id}
                          onClick={() => handleSelectLesson(lesson, { autoplay: true })}
                          aria-disabled={locked}
                          title={locked ? t('courseDetail.lessonLockedTooltip') : undefined}
                          className={cn(
                            "w-full px-4 py-2.5 flex items-center gap-3 text-start text-sm transition-colors",
                            locked
                              ? "opacity-50 cursor-not-allowed hover:bg-transparent"
                              : "hover:bg-secondary/50",
                            selectedLesson?.id === lesson.id && !locked && "bg-secondary",
                            lesson.is_hidden && "opacity-50",
                          )}
                        >
                          <LessonIcon
                            className={cn(
                              "w-4 h-4 flex-shrink-0",
                              locked
                                ? "text-muted-foreground"
                                : lesson.is_completed
                                  ? "text-success"
                                  : "text-muted-foreground",
                            )}
                          />
                          <span className="flex-1 truncate">{lesson.title}</span>
                          {lesson.is_hidden && <EyeOff className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                          <NewBadge createdAt={lesson.created_at} />
                          {lessonDuration && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {lessonDuration}
                            </span>
                          )}
                        </button>
                      );
                    })}
                      </CollapsibleContent>
                    </Collapsible>)}
                </div>
              </CardContent>
            </Card>

            {/* Notes Section - Below Course Content (hidden on mobile) */}
            {selectedLesson && <Card className="hidden lg:block">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <StickyNote className="w-4 h-4" />
                  {t('courseDetail.myNotes')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Textarea placeholder={t('courseDetail.addNotePlaceholder')} value={newNote} onChange={e => setNewNote(e.target.value)} className="min-h-[80px]" />
                </div>
                <Button onClick={handleAddNote} disabled={!newNote.trim()}>
                  {t('courseDetail.saveNote')}
                </Button>

                {notes.length > 0 && <div className="space-y-3 pt-4 border-t max-h-[300px] overflow-y-auto">
                    {notes.map(note => <div key={note.id} className="p-3 bg-secondary/50 rounded-lg">
                        <p className="text-sm whitespace-pre-wrap">{note.note_text}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(note.created_at).toLocaleDateString()}
                        </p>
                      </div>)}
                  </div>}
              </CardContent>
            </Card>}
          </div>
        </div>
      </div>
  );
}
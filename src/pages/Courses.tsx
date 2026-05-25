import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Search, Users, ChevronLeft, MoreVertical, Pencil, Trash2, Eye, EyeOff, Clock, GripVertical, Star, Lock } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useCourseDurations, formatCourseDuration } from '@/hooks/useCourseDurations';
import { NewBadge } from '@/components/NewBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CourseInstructor {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

interface Course {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  instructor_id: string | null;
  is_published: boolean;
  payment_url: string | null;
  instructors: CourseInstructor[];
  module_count?: number;
  order_index?: number;
  created_at: string;
}

interface EnrolledCourse extends Course {
  progress: number;
  enrolled_at: string;
}


// Sortable Course Card wrapper component
function SortableCourseCard({ 
  id, 
  children,
  showHandle 
}: { 
  id: string; 
  children: React.ReactNode;
  showHandle: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={`relative ${isDragging ? 'z-50 opacity-80 shadow-lg' : ''}`}>
      {showHandle && (
        <button
          type="button"
          className="absolute top-2 right-2 z-20 cursor-grab active:cursor-grabbing p-1.5 bg-background/80 hover:bg-background rounded-md shadow-sm touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </button>
      )}
      {children}
    </div>
  );
}

export default function Courses() {
  const { user, isAdmin, isInstructor, isAdminOrInstructor } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { completeStep } = useOnboarding();
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [coursesWithLessons, setCoursesWithLessons] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Mark first_course onboarding step on visit
  useEffect(() => {
    completeStep('first_course');
  }, [completeStep]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [courseToDelete, setCourseToDelete] = useState<string | null>(null);

  // Calculate durations from Vimeo API
  const courseDurations = useCourseDurations(coursesWithLessons);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    fetchCourses();
  }, [user, isAdminOrInstructor]);

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const fetchCourses = async () => {
    try {
      // Admins and instructors can see all courses (including unpublished),
      // others only published courses
      let query = supabase
        .from('courses')
        .select('*, modules(id, lessons(id, video_url, lesson_type))')
        .order('order_index', { ascending: true });

      if (!isAdminOrInstructor) {
        // Regular users only see published courses
        query = query.eq('is_published', true);
      }

      const { data: courses } = await query;

      if (courses) {
        // Store courses with lessons for duration calculation
        setCoursesWithLessons(courses.map((c: any) => ({
          id: c.id,
          modules: c.modules?.map((m: any) => ({
            id: m.id,
            lessons: m.lessons?.map((l: any) => ({
              id: l.id,
              video_url: l.video_url,
              lesson_type: l.lesson_type || 'video'
            })) || []
          })) || []
        })));

        // Fetch instructors for all courses
        const courseIds = courses.map(c => c.id);
        const { data: courseInstructors } = await supabase
          .from('course_instructors')
          .select('course_id, instructor_id')
          .in('course_id', courseIds);

        // Get unique instructor IDs and fetch their profile data
        const instructorIds = [...new Set(courseInstructors?.map(ci => ci.instructor_id) || [])];

        // Fetch instructor profile data (single source of truth post tenant_memberships drop)
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', instructorIds);

        const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

        const instructorsMap: Record<string, CourseInstructor[]> = {};
        if (courseInstructors) {
          courseInstructors.forEach((ci: any) => {
            if (!instructorsMap[ci.course_id]) {
              instructorsMap[ci.course_id] = [];
            }
            const profile = profileMap.get(ci.instructor_id);
            if (profile) {
              instructorsMap[ci.course_id].push({
                id: ci.instructor_id,
                full_name: profile.full_name || '',
                avatar_url: profile.avatar_url || null,
              });
            }
          });
        }

        setAllCourses(
          courses.map((c: any) => ({
            ...c,
            instructors: instructorsMap[c.id] || [],
            module_count: c.modules?.length || 0
          }))
        );
      }

      if (user) {
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('*, courses(*, modules(id, lessons(id, video_url, lesson_type)))')
          .eq('user_id', user.id);

        if (enrollments) {
          const enrolledCourseIds = enrollments.map((e: any) => e.courses?.id).filter(Boolean);
          const { data: courseInstructors } = await supabase
            .from('course_instructors')
            .select('course_id, instructor_id')
            .in('course_id', enrolledCourseIds);

          // Get unique instructor IDs and fetch their profile data
          const enrolledInstructorIds = [...new Set(courseInstructors?.map(ci => ci.instructor_id) || [])];

          // Fetch instructor profile data (single source of truth post tenant_memberships drop)
          const { data: enrolledProfiles } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url')
            .in('id', enrolledInstructorIds);

          const enrolledProfileMap = new Map(enrolledProfiles?.map(p => [p.id, p]) || []);

          const instructorsMap: Record<string, CourseInstructor[]> = {};
          if (courseInstructors) {
            courseInstructors.forEach((ci: any) => {
              if (!instructorsMap[ci.course_id]) {
                instructorsMap[ci.course_id] = [];
              }
              const profile = enrolledProfileMap.get(ci.instructor_id);
              if (profile) {
                instructorsMap[ci.course_id].push({
                  id: ci.instructor_id,
                  full_name: profile.full_name || '',
                  avatar_url: profile.avatar_url || null,
                });
              }
            });
          }

          const enrolledWithDetails = enrollments.map((e: any) => ({
            ...e.courses,
            progress: Number(e.progress_percentage),
            enrolled_at: e.enrolled_at,
            instructors: instructorsMap[e.courses?.id] || [],
            module_count: e.courses?.modules?.length || 0
          }));
          
          // Sort by order_index to match the browse tab order
          enrolledWithDetails.sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
          
          setEnrolledCourses(enrolledWithDetails);
        }
      }
    } catch (error) {
      console.error('Error fetching courses:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEnroll = async (courseId: string) => {
    if (!user) return;

    // Find the course to check for payment_url
    const course = allCourses.find(c => c.id === courseId);
    
    if (course?.payment_url) {
      // Redirect to payment page
      window.open(course.payment_url, '_blank');
      return;
    } else {
      // No payment URL - show alert to contact admin
      toast.error(t('courses.contactAdmin'));
      return;
    }
  };

  const isEnrolled = (courseId: string) => {
    return enrolledCourses.some(c => c.id === courseId);
  };

  const handlePublishToggle = async (courseId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('courses')
        .update({ is_published: !currentStatus })
        .eq('id', courseId);

      if (error) throw error;
      
      toast.success(currentStatus ? t('courses.unpublished') : t('courses.published'));
      fetchCourses();
    } catch (error) {
      console.error('Error updating course:', error);
    }
  };

  const handleDeleteCourse = async () => {
    if (!courseToDelete) return;

    try {
      // Delete lessons first
      const { data: modules } = await supabase
        .from('modules')
        .select('id')
        .eq('course_id', courseToDelete);

      if (modules) {
        for (const module of modules) {
          await supabase.from('lessons').delete().eq('module_id', module.id);
        }
      }

      // Delete modules
      await supabase.from('modules').delete().eq('course_id', courseToDelete);
      
      // Delete enrollments
      await supabase.from('enrollments').delete().eq('course_id', courseToDelete);
      
      // Delete course
      const { error } = await supabase.from('courses').delete().eq('id', courseToDelete);

      if (error) throw error;
      
      toast.success(t('courses.deleted'));
      setDeleteDialogOpen(false);
      setCourseToDelete(null);
      fetchCourses();
    } catch (error) {
      console.error('Error deleting course:', error);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = allCourses.findIndex(c => c.id === active.id);
      const newIndex = allCourses.findIndex(c => c.id === over.id);
      const newOrder = arrayMove(allCourses, oldIndex, newIndex);
      setAllCourses(newOrder);

      // Update order_index in database
      try {
        for (let i = 0; i < newOrder.length; i++) {
          await supabase
            .from('courses')
            .update({ order_index: i })
            .eq('id', newOrder[i].id);
        }
        toast.success(t('coursesPage.orderSaved'));
      } catch (error) {
        console.error('Error saving order:', error);
        toast.error(t('common.error'));
        fetchCourses(); // Revert on error
      }
    }
  };

  // Check if the current user can edit a specific course.
  // Admins can edit everything; instructors only their assigned courses.
  const canEditCourse = (course: Course) => {
    if (isAdmin) return true;
    if (isInstructor && user) {
      return course.instructors?.some(i => i.id === user.id) ?? false;
    }
    return false;
  };

  const filteredAllCourses = allCourses.filter(course =>
    course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    course.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredEnrolledCourses = enrolledCourses.filter(course =>
    course.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
      <div className="space-y-6">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                {t('courses.title')}
              </h1>
              <p className="text-muted-foreground mt-1.5">
                {t('coursesPage.headerSubtitle')}
              </p>
            </div>
            {isAdmin && (
              <Button asChild size="lg" className="shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all">
                <Link to="/courses/create">{t('courses.createCourse')}</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Search + Bookmark buttons */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t('courses.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10 h-11 bg-card border-border/60 focus-visible:ring-primary/30 focus-visible:border-primary/50"
            />
          </div>
          <div className="flex items-center gap-1.5 mr-auto">
            <Button variant="outline" size="icon" asChild title={t('courseDetail.favorites')} className="h-11 w-11 border-border/60 hover:border-primary/50 hover:text-primary transition-colors">
              <Link to="/courses/favorites">
                <Star className="w-4 h-4" />
              </Link>
            </Button>
            <Button variant="outline" size="icon" asChild title={t('courseDetail.watchLater')} className="h-11 w-11 border-border/60 hover:border-primary/50 hover:text-primary transition-colors">
              <Link to="/courses/watch-later">
                <Clock className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Course Grid */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="border-border/60 overflow-hidden">
                <Skeleton className="aspect-video w-full rounded-none" />
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="w-6 h-6 rounded-full" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isAdminOrInstructor ? (
          filteredAllCourses.length === 0 ? (
            <Card className="border-border/60">
              <CardContent className="py-16 text-center">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                  <BookOpen className="w-10 h-10 text-primary/60" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{t('courses.noCourses')}</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">{t('courses.noCoursesDesc')}</p>
              </CardContent>
            </Card>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredAllCourses.map(c => c.id)} strategy={rectSortingStrategy}>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredAllCourses.map((course) => {
                    const editable = canEditCourse(course);
                    return (
                    <SortableCourseCard key={course.id} id={course.id} showHandle={isAdmin}>
                      <Card className="group hover:shadow-lg hover:-translate-y-1 transition-all duration-300 ease-out-cubic border-border/60 overflow-hidden">
                        {editable && (
                        <div className="absolute top-2 left-2 z-10">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="secondary" size="icon" className="h-8 w-8 backdrop-blur-md bg-background/80 hover:bg-background border border-border/50">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {isAdmin && (
                              <DropdownMenuItem onClick={() => handlePublishToggle(course.id, course.is_published)}>
                                {course.is_published ? (
                                  <>
                                    <EyeOff className="w-4 h-4 ml-2" />
                                    {t('courses.unpublish')}
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-4 h-4 ml-2" />
                                    {t('courses.publish')}
                                  </>
                                )}
                              </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => navigate(`/courses/${course.id}/edit`)}>
                                <Pencil className="w-4 h-4 ml-2" />
                                {t('courses.editCourse')}
                              </DropdownMenuItem>
                              {isAdmin && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  setCourseToDelete(course.id);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="w-4 h-4 ml-2" />
                                {t('courses.deleteCourse')}
                              </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        )}
                        <Link to={`/courses/${course.id}`}>
                          <div className="aspect-video bg-gradient-to-br from-primary/10 to-accent/5 rounded-t-lg overflow-hidden relative">
                            {course.thumbnail_url ? (
                              <>
                                <img
                                  src={course.thumbnail_url}
                                  alt={course.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                                />
                                {/* Subtle gradient overlay for text legibility */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                              </>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <BookOpen className="w-14 h-14 text-primary/40 group-hover:text-primary/60 group-hover:scale-110 transition-all duration-300" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold truncate group-hover:text-primary transition-colors">{course.title}</h3>
                              <NewBadge createdAt={course.created_at} />
                              {!course.is_published && (
                                <span className="text-xs bg-warning/15 text-warning-foreground px-2 py-0.5 rounded-full font-medium border border-warning/20">
                                  {t('courses.draft')}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {course.description || t('courses.noDescription')}
                            </p>
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                              {course.instructors && course.instructors.length > 0 ? (
                                <>
                                  <div className="flex flex-shrink-0 ml-2">
                                    {course.instructors.slice(0, 3).map((instructor, index) => (
                                      <Avatar 
                                        key={instructor.id} 
                                        className="w-6 h-6 border-2 border-background -mr-3 rtl:-ml-3 rtl:mr-0"
                                        style={{ zIndex: course.instructors.length - index }}
                                      >
                                        <AvatarImage src={instructor.avatar_url || undefined} />
                                        <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                                          {getInitials(instructor.full_name)}
                                        </AvatarFallback>
                                      </Avatar>
                                    ))}
                                  </div>
                                  <span className="text-xs text-muted-foreground truncate flex-1">
                                    {course.instructors.map(i => i.full_name).join(', ')}
                                  </span>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">{t('courses.noInstructor')}</span>
                              )}
                              <div className="flex items-center gap-2 mr-auto">
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <BookOpen className="w-3 h-3" />
                                  {course.module_count} {t('courses.modules')}
                                </span>
                                {courseDurations[course.id] && courseDurations[course.id] > 0 && (
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="w-3 h-3" />
                                    {formatCourseDuration(courseDurations[course.id], t)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Link>
                      </Card>
                    </SortableCourseCard>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )
        ) : (
          filteredAllCourses.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                  <BookOpen className="w-10 h-10 text-primary/60" />
                </div>
                <h3 className="text-lg font-medium mb-2">{t('courses.noCourses')}</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">{t('courses.noCoursesDesc')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAllCourses.map((course) => {
                const enrolled = enrolledCourses.find(c => c.id === course.id);
                const isLocked = !enrolled;
                const progress = enrolled?.progress ?? 0;

                const cardInner = (
                  <>
                    <div className="aspect-video bg-gradient-to-br from-primary/10 to-accent/5 rounded-t-lg overflow-hidden relative">
                      {course.thumbnail_url ? (
                        <>
                          <img
                            src={course.thumbnail_url}
                            alt={course.title}
                            className={cn(
                              "w-full h-full object-cover transition-transform duration-500 ease-out",
                              isLocked ? "scale-105" : "group-hover:scale-105"
                            )}
                          />
                          {!isLocked && progress > 0 && (
                            <div className="absolute top-2 end-2 backdrop-blur-md bg-background/90 rounded-full px-2.5 py-1 text-xs font-semibold text-primary border border-border/50 shadow-sm z-[1]">
                              {progress}%
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="w-14 h-14 text-primary/40 group-hover:text-primary/60 group-hover:scale-110 transition-all duration-300" />
                        </div>
                      )}

                    </div>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <h3 className={cn(
                          "font-semibold truncate transition-colors",
                          isLocked ? "text-muted-foreground" : "group-hover:text-primary"
                        )}>
                          {course.title}
                        </h3>
                        <NewBadge createdAt={course.created_at} />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {course.description || t('courses.noDescription')}
                      </p>
                      <div className="flex items-center gap-3 mt-3 overflow-hidden">
                        {course.instructors && course.instructors.length > 0 ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex flex-shrink-0 ml-2">
                              {course.instructors.slice(0, 3).map((instructor, index) => (
                                <Avatar
                                  key={instructor.id}
                                  className="w-6 h-6 border-2 border-background -mr-3 rtl:-ml-3 rtl:mr-0"
                                  style={{ zIndex: course.instructors.length - index }}
                                >
                                  <AvatarImage src={instructor.avatar_url || undefined} />
                                  <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                                    {getInitials(instructor.full_name)}
                                  </AvatarFallback>
                                </Avatar>
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground truncate">
                              {course.instructors.map(i => i.full_name).join(', ')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('courses.noInstructor')}</span>
                        )}
                        <div className="flex items-center gap-2 mr-auto flex-shrink-0">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <BookOpen className="w-3 h-3" />
                            {course.module_count} {t('courses.modules')}
                          </span>
                          {courseDurations[course.id] && courseDurations[course.id] > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {formatCourseDuration(courseDurations[course.id], t)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-4">
                        {isLocked ? (
                          <div className="h-[26px]" />
                        ) : (
                          <>
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-muted-foreground font-medium">{t('courses.progress')}</span>
                              <span className="font-semibold text-primary">{progress}%</span>
                            </div>
                            <Progress value={progress} className="h-1.5" />
                          </>
                        )}
                      </div>
                    </CardContent>
                  </>
                );

                return (
                  <Card
                    key={course.id}
                    className={cn(
                      "group border-border/60 overflow-hidden transition-all duration-300 ease-out-cubic",
                      isLocked
                        ? "cursor-not-allowed opacity-95"
                        : "hover:shadow-lg hover:-translate-y-1"
                    )}
                    aria-disabled={isLocked}
                  >
                    {isLocked ? (
                      <div
                        onClick={() => toast.error(t('courses.contactAdmin'))}
                        className="block relative"
                      >
                        {cardInner}
                        {/* Full-card lock overlay — sits above all content */}
                        <div className="absolute inset-0 z-[5] backdrop-blur-sm bg-background/60 flex flex-col items-center justify-center gap-2.5 pointer-events-none">
                          <div className="w-12 h-12 rounded-2xl bg-background/80 backdrop-blur-xl border border-border/60 shadow-lg flex items-center justify-center">
                            <Lock className="w-5 h-5 text-muted-foreground" strokeWidth={2.5} />
                          </div>
                          <span className="text-xs font-semibold text-muted-foreground">
                            {t('coursesPage.accessRequired')}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <Link to={`/courses/${course.id}`} className="block">
                        {cardInner}
                      </Link>
                    )}
                  </Card>
                );
              })}
            </div>
          )
        )}

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('courses.deleteConfirm')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('courses.deleteConfirmDesc')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteCourse} className="bg-destructive text-destructive-foreground">
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
}

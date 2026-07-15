import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Plus, Trash2, GripVertical, Upload, X, Check, ChevronsUpDown, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AnnounceContentButton from '@/components/admin/AnnounceContentButton';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ExamManager from '@/components/ExamManager';
import LessonForm, { LessonFormData, createEmptyLesson } from '@/components/LessonForm';
import RichTextEditor from '@/components/RichTextEditor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
interface ModuleForm {
  id?: string;
  title: string;
  description: string;
  lessons: (LessonFormData & { id?: string })[];
}

interface Instructor {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

// Sortable Module component
function SortableModule({ id, children }: { id: string; children: React.ReactNode }) {
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
    <div ref={setNodeRef} style={style} className={isDragging ? 'z-50 opacity-80 shadow-lg' : ''}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded touch-none mt-4"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

// Sortable Lesson component
function SortableLesson({ id, children }: { id: string; children: React.ReactNode }) {
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
    <div ref={setNodeRef} style={style} className={isDragging ? 'z-50 opacity-80 shadow-lg' : ''}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded touch-none mt-2"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function EditCourse() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAdmin, isInstructor } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [selectedInstructors, setSelectedInstructors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [courseData, setCourseData] = useState({
    title: '',
    description: '',
    thumbnail_url: '',
    payment_url: '',
    is_published: false,
    // Linear (default) = sequential lessons + optional prerequisite course.
    // Open = lessons in any order + standalone (no prerequisite).
    lessons_in_order: true,
    prerequisite_course_id: null as string | null,
  });

  // All other published courses (admin sees unpublished too) — the
  // candidate list for the prerequisite dropdown. Loaded once on mount,
  // self is filtered out at render time.
  const [otherCourses, setOtherCourses] = useState<{ id: string; title: string }[]>([]);

  const [modules, setModules] = useState<ModuleForm[]>([]);
  const [collapsedModules, setCollapsedModules] = useState<Set<number>>(new Set());
  const [showStickyButton, setShowStickyButton] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Handle scroll to show/hide sticky save button
  useEffect(() => {
    const handleScroll = () => {
      if (headerRef.current) {
        const headerBottom = headerRef.current.getBoundingClientRect().bottom;
        setShowStickyButton(headerBottom < 0);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleModuleCollapse = (index: number) => {
    setCollapsedModules(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const collapseAllModules = () => {
    setCollapsedModules(new Set(modules.map((_, i) => i)));
  };

  const expandAllModules = () => {
    setCollapsedModules(new Set());
  };

  useEffect(() => {
    fetchInstructors();
    if (id) {
      fetchCourse();
    }
  }, [id]);

  const fetchInstructors = async () => {
    // Fetch instructor/admin users from user_roles (post tenant_memberships drop)
    // and join profile fields.
    const { data: roles } = await supabase
      .from('user_roles')
      .select('user_id')
      .in('role', ['instructor', 'admin']);

    if (roles && roles.length > 0) {
      const userIds = Array.from(new Set(roles.map(r => r.user_id)));
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', userIds);

      if (profiles) {
        setInstructors(profiles as Instructor[]);
      }
    } else {
      setInstructors([]);
    }
  };

  const toggleInstructor = (instructorId: string) => {
    setSelectedInstructors(prev => 
      prev.includes(instructorId)
        ? prev.filter(id => id !== instructorId)
        : [...prev, instructorId]
    );
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const fetchCourse = async () => {
    try {
      const { data: course } = await supabase
        .from('courses')
        .select('*')
        .eq('id', id)
        .single();

      if (course) {
        setCourseData({
          title: course.title,
          description: course.description || '',
          thumbnail_url: course.thumbnail_url || '',
          payment_url: course.payment_url || '',
          is_published: course.is_published,
          // Default true if the column is missing (older row pre-migration).
          lessons_in_order: (course as any).lessons_in_order !== false,
          prerequisite_course_id: (course as any).prerequisite_course_id || null,
        });

        // Pull the candidate list for the prerequisite dropdown.
        const { data: candidates } = await supabase
          .from('courses')
          .select('id, title')
          .order('title');
        setOtherCourses(((candidates ?? []) as { id: string; title: string }[]).filter(c => c.id !== id));

        // Fetch course instructors
        const { data: courseInstructors } = await supabase
          .from('course_instructors')
          .select('instructor_id')
          .eq('course_id', id);

        if (courseInstructors) {
          setSelectedInstructors(courseInstructors.map(ci => ci.instructor_id));
        }

        // Authorization: instructors may only edit courses they are assigned to.
        if (isInstructor && !isAdmin && user) {
          const isAssigned = courseInstructors?.some(ci => ci.instructor_id === user.id);
          if (!isAssigned) {
            setUnauthorized(true);
            setFetching(false);
            return;
          }
        }

        const { data: modulesData } = await supabase
          .from('modules')
          .select('*, lessons(*)')
          .eq('course_id', id)
          .order('order_index');

        if (modulesData) {
          setModules(
            modulesData.map((m: any) => ({
              id: m.id,
              title: m.title,
              description: m.description || '',
              lessons: (m.lessons || [])
              .sort((a: any, b: any) => a.order_index - b.order_index)
                .map((l: any) => ({
                  id: l.id,
                  title: l.title,
                  lesson_type: l.lesson_type || 'video',
                  video_url: l.video_url || '',
                  file_url: l.file_url || '',
                  exam_id: l.exam_id || '',
                  content_text: l.content_text || '',
                  duration_minutes: l.duration_minutes || 0,
                  embed_url: l.embed_url || '',
                  resources_url: l.resources_url || '',
                  is_hidden: l.is_hidden || false,
                }))
            }))
          );
        }
      }
    } catch (error) {
      console.error('Error fetching course:', error);
    } finally {
      setFetching(false);
    }
  };

  const addModule = () => {
    setModules([...modules, { 
      title: '', 
      description: '', 
      lessons: [createEmptyLesson()] 
    }]);
  };

  const removeModule = (index: number) => {
    if (modules.length > 0) {
      setModules(modules.filter((_, i) => i !== index));
    }
  };

  const updateModule = (index: number, field: string, value: string) => {
    const updated = [...modules];
    (updated[index] as any)[field] = value;
    setModules(updated);
  };

  const addLesson = (moduleIndex: number, atIndex?: number) => {
    const updated = [...modules];
    if (atIndex !== undefined) {
      updated[moduleIndex].lessons.splice(atIndex, 0, createEmptyLesson());
    } else {
      updated[moduleIndex].lessons.push(createEmptyLesson());
    }
    setModules(updated);
  };

  const removeLesson = (moduleIndex: number, lessonIndex: number) => {
    const updated = [...modules];
    updated[moduleIndex].lessons = updated[moduleIndex].lessons.filter((_, i) => i !== lessonIndex);
    setModules(updated);
  };

  const updateLesson = (moduleIndex: number, lessonIndex: number, field: string, value: string | number | boolean) => {
    const updated = [...modules];
    (updated[moduleIndex].lessons[lessonIndex] as any)[field] = value;
    setModules(updated);
  };

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEndModules = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modules.findIndex((_, i) => `module-${i}` === active.id);
      const newIndex = modules.findIndex((_, i) => `module-${i}` === over.id);
      setModules(arrayMove(modules, oldIndex, newIndex));
    }
  };

  const handleDragEndLessons = (moduleIndex: number) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = parseInt(String(active.id).split('-').pop()!);
    const newIndex = parseInt(String(over.id).split('-').pop()!);

    const updated = [...modules];
    updated[moduleIndex].lessons = arrayMove(updated[moduleIndex].lessons, oldIndex, newIndex);
    setModules(updated);
  };

  const moveLessonToModule = (fromModule: number, lessonIndex: number, toModule: number) => {
    const updated = [...modules];
    const [movedLesson] = updated[fromModule].lessons.splice(lessonIndex, 1);
    updated[toModule].lessons.push(movedLesson);
    setModules(updated);
    toast.success(t('common.success'));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('course-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('course-images')
        .getPublicUrl(fileName);

      setCourseData({ ...courseData, thumbnail_url: publicUrl });
      toast.success(t('common.success'));
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !id) {
      toast.error(t('createCourse.loginRequired'));
      return;
    }

    if (!courseData.title.trim()) {
      toast.error(t('createCourse.nameRequired'));
      return;
    }

    setLoading(true);

    try {
      // Update course
      const { error: courseError } = await supabase
        .from('courses')
        .update({
          title: courseData.title,
          description: courseData.description || null,
          thumbnail_url: courseData.thumbnail_url || null,
          payment_url: courseData.payment_url || null,
          is_published: courseData.is_published,
          instructor_id: selectedInstructors[0] || null,
          lessons_in_order: courseData.lessons_in_order,
          // Open courses are standalone — prerequisite is meaningless
          // and we force-null it so a stale dropdown selection doesn't
          // ghost-gate a course the admin just flipped to Open.
          prerequisite_course_id: courseData.lessons_in_order
            ? (courseData.prerequisite_course_id || null)
            : null,
        } as any)
        .eq('id', id);

      if (courseError) throw courseError;

      // Update course instructors
      await supabase.from('course_instructors').delete().eq('course_id', id);
      if (selectedInstructors.length > 0) {
        const instructorInserts = selectedInstructors.map(instructorId => ({
          course_id: id,
          instructor_id: instructorId,
        }));
        await supabase.from('course_instructors').insert(instructorInserts);
      }

      // Get existing modules and lessons for comparison
      const { data: oldModules } = await supabase
        .from('modules')
        .select('id, lessons(id)')
        .eq('course_id', id);

      const existingModuleIds = new Set(oldModules?.map(m => m.id) || []);
      const existingLessonIds = new Set(
        oldModules?.flatMap(m => (m.lessons as any[])?.map(l => l.id) || []) || []
      );

      const updatedModuleIds = new Set<string>();
      const updatedLessonIds = new Set<string>();

      // Update or create modules and lessons
      for (let i = 0; i < modules.length; i++) {
        const module = modules[i];
        if (!module.title.trim()) continue;

        let moduleId: string;

        if (module.id && existingModuleIds.has(module.id)) {
          // Update existing module
          const { error: moduleError } = await supabase
            .from('modules')
            .update({
              title: module.title,
              description: module.description || null,
              order_index: i,
            })
            .eq('id', module.id);

          if (moduleError) throw moduleError;
          moduleId = module.id;
          updatedModuleIds.add(moduleId);
        } else {
          // Create new module
          const { data: moduleData, error: moduleError } = await supabase
            .from('modules')
            .insert({
              course_id: id,
              title: module.title,
              description: module.description || null,
              order_index: i,
            })
            .select()
            .single();

          if (moduleError) throw moduleError;
          moduleId = moduleData.id;
          updatedModuleIds.add(moduleId);
        }

        for (let j = 0; j < module.lessons.length; j++) {
          const lesson = module.lessons[j];
          if (!lesson.title.trim()) continue;

          const lessonData = {
            module_id: moduleId,
            title: lesson.title,
            lesson_type: lesson.lesson_type,
            video_url: lesson.video_url || null,
            file_url: lesson.file_url || null,
            exam_id: lesson.exam_id || null,
            content_text: lesson.content_text || null,
            duration_minutes: lesson.duration_minutes || null,
            embed_url: lesson.embed_url || null,
            resources_url: lesson.resources_url || null,
            is_hidden: lesson.is_hidden || false,
            order_index: j,
          };

          if (lesson.id && existingLessonIds.has(lesson.id)) {
            // Update existing lesson - only updates if data changed (trigger will update updated_at)
            const { error: lessonError } = await supabase
              .from('lessons')
              .update(lessonData)
              .eq('id', lesson.id);

            if (lessonError) throw lessonError;
            updatedLessonIds.add(lesson.id);
          } else {
            // Create new lesson
            const { data: newLesson, error: lessonError } = await supabase
              .from('lessons')
              .insert(lessonData)
              .select('id')
              .single();

            if (lessonError) throw lessonError;
            if (newLesson) updatedLessonIds.add(newLesson.id);
          }
        }
      }

      // Delete removed lessons and modules
      for (const lessonId of Array.from(existingLessonIds)) {
        if (!updatedLessonIds.has(lessonId as string)) {
          await supabase.from('lessons').delete().eq('id', lessonId as string);
        }
      }
      for (const moduleId of Array.from(existingModuleIds)) {
        if (!updatedModuleIds.has(moduleId as string)) {
          await supabase.from('modules').delete().eq('id', moduleId as string);
        }
      }

      // KG sync happens automatically via Postgres triggers → kg-sync edge function.
      // No frontend trigger needed.

      toast.success(t('common.success'));
      navigate(`/courses/${id}`);
    } catch (error: any) {
      console.error('Error updating course:', error);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (

        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>

    );
  }

  if (unauthorized) {
    return (
      <div className="text-center py-16 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <ArrowRight className="w-7 h-7 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold mb-2">
          {t('admin.accessDenied') || t('editCourse.noPermission')}
        </h2>
        <p className="text-muted-foreground mb-6">
          {t('editCourse.canOnlyEditAssigned')}
        </p>
        <Button onClick={() => navigate('/courses')}>
          {t('editCourse.backToCourses')}
        </Button>
      </div>
    );
  }

  return (
    
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div ref={headerRef} className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/courses')}>
              <ArrowRight className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{t('courses.editCourse')}</h1>
              <p className="text-muted-foreground">{courseData.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {id && <AnnounceContentButton courseId={id} courseName={courseData.title} />}
            <Button
              type="button"
              disabled={loading}
              onClick={() => formRef.current?.requestSubmit()}
            >
              <Save className="w-4 h-4 ml-2" />
              {loading ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>

        {/* Sticky Save Button */}
        <div 
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300",
            showStickyButton ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
          )}
        >
          <Button 
            type="button" 
            disabled={loading}
            onClick={() => formRef.current?.requestSubmit()}
            className="shadow-lg"
          >
            <Save className="w-4 h-4 ml-2" />
            {loading ? t('common.loading') : t('common.save')}
          </Button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          {/* Course Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t('createCourse.courseDetails')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">{t('createCourse.courseName')} *</Label>
                <Input
                  id="title"
                  value={courseData.title}
                  onChange={(e) => setCourseData({ ...courseData, title: e.target.value })}
                  placeholder={t('createCourse.courseNamePlaceholder')}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{t('createCourse.description')}</Label>
                <RichTextEditor
                  value={courseData.description}
                  onChange={(value) => setCourseData({ ...courseData, description: value })}
                  placeholder={t('createCourse.descriptionPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('createCourse.thumbnail')}</Label>
                <div className="space-y-3">
                  {courseData.thumbnail_url && (
                    <div className="aspect-video max-w-xs rounded-lg overflow-hidden bg-secondary">
                      <img 
                        src={courseData.thumbnail_url} 
                        alt="Course thumbnail" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? (
                        t('createCourse.uploading')
                      ) : (
                        <>
                          <Upload className="w-4 h-4 ml-2" />
                          {t('createCourse.uploadImage')}
                        </>
                      )}
                    </Button>
                    <span className="text-sm text-muted-foreground">{t('createCourse.orEnterUrl')}</span>
                  </div>
                  <Input
                    value={courseData.thumbnail_url}
                    onChange={(e) => setCourseData({ ...courseData, thumbnail_url: e.target.value })}
                    placeholder="https://example.com/image.jpg"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment_url">{t('createCourse.paymentUrl')}</Label>
                <Input
                  id="payment_url"
                  value={courseData.payment_url}
                  onChange={(e) => setCourseData({ ...courseData, payment_url: e.target.value })}
                  placeholder={t('createCourse.paymentUrlPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('createCourse.selectInstructor')}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedInstructors.length > 0
                        ? `${selectedInstructors.length} ${t('createCourse.instructorsSelected')}`
                        : t('createCourse.selectInstructorPlaceholder')}
                      <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full min-w-[300px] p-0 bg-popover border shadow-lg z-50" align="start">
                    <div className="max-h-60 overflow-y-auto p-1">
                      {instructors.map((instructor) => (
                        <div
                          key={instructor.id}
                          className="flex items-center gap-3 p-2 hover:bg-accent rounded-md cursor-pointer"
                          onClick={() => toggleInstructor(instructor.id)}
                        >
                          <div className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-sm border",
                            selectedInstructors.includes(instructor.id) 
                              ? "bg-primary border-primary text-primary-foreground" 
                              : "border-input"
                          )}>
                            {selectedInstructors.includes(instructor.id) && (
                              <Check className="h-3 w-3" />
                            )}
                          </div>
                          <Avatar className="w-6 h-6">
                            <AvatarImage src={instructor.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                              {getInitials(instructor.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{instructor.full_name}</span>
                        </div>
                      ))}
                      {instructors.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          {t('createCourse.noInstructors')}
                        </p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {selectedInstructors.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedInstructors.map(instId => {
                      const instructor = instructors.find(i => i.id === instId);
                      if (!instructor) return null;
                      return (
                        <div key={instId} className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">
                          <span>{instructor.full_name}</span>
                          <button type="button" onClick={() => toggleInstructor(instId)}>
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="published"
                  checked={courseData.is_published}
                  onCheckedChange={(checked) => setCourseData({ ...courseData, is_published: checked })}
                />
                <Label htmlFor="published">{t('createCourse.publishNow')}</Label>
              </div>

              {/* Gating mode: Linear (sequential + optional prerequisite)
                  vs Open (any order, standalone). The prereq dropdown is
                  hidden when Open since it can't apply there. */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="lessons-in-order" className="text-base">
                      {t('editCourse.linearLabel')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {courseData.lessons_in_order
                        ? t('editCourse.linearOnDesc')
                        : t('editCourse.linearOffDesc')}
                    </p>
                  </div>
                  <Switch
                    id="lessons-in-order"
                    checked={courseData.lessons_in_order}
                    onCheckedChange={(checked) =>
                      setCourseData({
                        ...courseData,
                        lessons_in_order: checked,
                        // Flipping to Open clears the prereq selection.
                        prerequisite_course_id: checked ? courseData.prerequisite_course_id : null,
                      })
                    }
                  />
                </div>

                {courseData.lessons_in_order && (
                  <div className="space-y-2">
                    <Label htmlFor="prerequisite">{t('editCourse.prerequisiteLabel')}</Label>
                    <select
                      id="prerequisite"
                      value={courseData.prerequisite_course_id ?? ''}
                      onChange={(e) =>
                        setCourseData({
                          ...courseData,
                          prerequisite_course_id: e.target.value || null,
                        })
                      }
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="">{t('editCourse.prerequisiteNone')}</option>
                      {otherCourses.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {t('editCourse.prerequisiteHint')}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Exams */}
          {id && <ExamManager courseId={id} />}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold">{t('createCourse.modulesAndLessons')}</h2>
              <div className="flex items-center gap-2">
                {modules.length > 0 && (
                  <>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm" 
                      onClick={collapseAllModules}
                      className="text-muted-foreground"
                    >
                      <ChevronUp className="w-4 h-4 ml-1" />
                      {t('editCourse.collapseAll')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={expandAllModules}
                      className="text-muted-foreground"
                    >
                      <ChevronDown className="w-4 h-4 ml-1" />
                      {t('editCourse.expandAll')}
                    </Button>
                  </>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addModule}>
                  <Plus className="w-4 h-4 ml-1" />
                  {t('createCourse.addModule')}
                </Button>
              </div>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndModules}>
              <SortableContext items={modules.map((_, i) => `module-${i}`)} strategy={verticalListSortingStrategy}>
                {modules.map((module, moduleIndex) => (
                  <SortableModule key={`module-${moduleIndex}`} id={`module-${moduleIndex}`}>
                    <Collapsible 
                      open={!collapsedModules.has(moduleIndex)}
                      onOpenChange={() => toggleModuleCollapse(moduleIndex)}
                    >
                      <Card>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CollapsibleTrigger asChild>
                              <button 
                                type="button"
                                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {collapsedModules.has(moduleIndex) ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronUp className="w-4 h-4" />
                                )}
                                <span>{t('createCourse.module')} {moduleIndex + 1}</span>
                                {module.title && (
                                  <span className="text-foreground font-normal">- {module.title}</span>
                                )}
                                <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                                  {module.lessons.length} {t('createCourse.lessons')}
                                </span>
                              </button>
                            </CollapsibleTrigger>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeModule(moduleIndex)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CollapsibleContent>
                          <CardContent className="space-y-4">
                            <div className="grid sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>{t('createCourse.moduleName')}</Label>
                                <Input
                                  value={module.title}
                                  onChange={(e) => updateModule(moduleIndex, 'title', e.target.value)}
                                  placeholder={t('createCourse.moduleNamePlaceholder')}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>{t('createCourse.moduleDescription')}</Label>
                                <Input
                                  value={module.description}
                                  onChange={(e) => updateModule(moduleIndex, 'description', e.target.value)}
                                  placeholder={t('createCourse.descriptionPlaceholder')}
                                />
                              </div>
                            </div>

                            {/* Lessons */}
                            <div className="border-t pt-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">{t('createCourse.lessons')}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => addLesson(moduleIndex)}
                                >
                                  <Plus className="w-3 h-3 ml-1" />
                                  {t('createCourse.addLesson')}
                                </Button>
                              </div>

                              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndLessons(moduleIndex)}>
                                <SortableContext items={module.lessons.map((_, i) => `lesson-${moduleIndex}-${i}`)} strategy={verticalListSortingStrategy}>
                                  {module.lessons.map((lesson, lessonIndex) => (
                                    <div key={`lesson-wrapper-${moduleIndex}-${lessonIndex}`}>
                                      {/* Add lesson button before each lesson */}
                                      <div className="flex justify-center py-1 group">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                          onClick={() => addLesson(moduleIndex, lessonIndex)}
                                        >
                                          <Plus className="w-3 h-3" />
                                        </Button>
                                      </div>
                                      <SortableLesson id={`lesson-${moduleIndex}-${lessonIndex}`}>
                                        <LessonForm
                                          lesson={lesson}
                                          lessonIndex={lessonIndex}
                                          moduleIndex={moduleIndex}
                                          canRemove={module.lessons.length > 1}
                                          courseId={id}
                                          onUpdate={updateLesson}
                                          onRemove={removeLesson}
                                          onMoveToModule={moveLessonToModule}
                                          availableModules={modules.map((m, i) => ({ index: i, title: m.title }))}
                                          defaultExpanded={!lesson.title}
                                        />
                                      </SortableLesson>
                                    </div>
                                  ))}
                                </SortableContext>
                              </DndContext>
                              
                              {/* Add lesson button at the end */}
                              <div className="flex justify-center py-2 group">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/30"
                                  onClick={() => addLesson(moduleIndex)}
                                >
                                  <Plus className="w-3 h-3 ml-1" />
                                  {t('createCourse.addLesson')}
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  </SortableModule>
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {/* Submit */}
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={() => navigate('/courses')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </form>
      </div>
  );
}

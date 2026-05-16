import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Plus, Trash2, GripVertical, Upload, X, Check, ChevronsUpDown } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import LessonForm, { LessonFormData, createEmptyLesson } from '@/components/LessonForm';
import RichTextEditor from '@/components/RichTextEditor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ModuleForm {
  title: string;
  description: string;
  lessons: LessonFormData[];
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

interface Instructor {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

export default function CreateCourse() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [courseData, setCourseData] = useState({
    title: '',
    description: '',
    thumbnail_url: '',
    payment_url: '',
    is_published: false,
  });
  const [selectedInstructors, setSelectedInstructors] = useState<string[]>([]);

  useEffect(() => {
    fetchInstructors();
  }, []);

  const fetchInstructors = async () => {
    const { data: roles } = await supabase
      .from('user_roles')
      .select('user_id')
      .in('role', ['instructor', 'admin']);
    
    if (roles && roles.length > 0) {
      const userIds = roles.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', userIds);
      
      if (profiles) {
        setInstructors(profiles);
      }
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

  const [modules, setModules] = useState<ModuleForm[]>([
    { title: '', description: '', lessons: [createEmptyLesson()] }
  ]);

  const addModule = () => {
    setModules([...modules, { 
      title: '', 
      description: '', 
      lessons: [createEmptyLesson()] 
    }]);
  };

  const removeModule = (index: number) => {
    if (modules.length > 1) {
      setModules(modules.filter((_, i) => i !== index));
    }
  };

  const updateModule = (index: number, field: string, value: string) => {
    const updated = [...modules];
    (updated[index] as any)[field] = value;
    setModules(updated);
  };

  const addLesson = (moduleIndex: number) => {
    const updated = [...modules];
    updated[moduleIndex].lessons.push(createEmptyLesson());
    setModules(updated);
  };

  const removeLesson = (moduleIndex: number, lessonIndex: number) => {
    if (modules[moduleIndex].lessons.length > 1) {
      const updated = [...modules];
      updated[moduleIndex].lessons = updated[moduleIndex].lessons.filter((_, i) => i !== lessonIndex);
      setModules(updated);
    }
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
    if (over && active.id !== over.id) {
      const oldIndex = modules[moduleIndex].lessons.findIndex((_, i) => `lesson-${moduleIndex}-${i}` === active.id);
      const newIndex = modules[moduleIndex].lessons.findIndex((_, i) => `lesson-${moduleIndex}-${i}` === over.id);
      const updated = [...modules];
      updated[moduleIndex].lessons = arrayMove(updated[moduleIndex].lessons, oldIndex, newIndex);
      setModules(updated);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast.error(t('createCourse.loginRequired'));
      return;
    }

    if (!courseData.title.trim()) {
      toast.error(t('createCourse.nameRequired'));
      return;
    }

    // Validate that modules with lessons have titles
    const modulesWithContent = modules.filter(m => 
      m.lessons.some(l => l.title.trim())
    );
    
    const modulesWithoutTitle = modulesWithContent.filter(m => !m.title.trim());
    if (modulesWithoutTitle.length > 0) {
      toast.error(t('createCourse.moduleTitleRequired'));
      return;
    }

    // Validate that all lessons in modules with title have lesson titles
    for (const module of modules) {
      if (module.title.trim()) {
        const lessonsWithoutTitle = module.lessons.filter(l => !l.title.trim());
        if (lessonsWithoutTitle.length > 0 && module.lessons.length > 1) {
          // Only show error if there are multiple lessons and some are missing titles
          toast.error(t('createCourse.lessonTitleRequired'));
          return;
        }
      }
    }

    setLoading(true);

    try {
      const { data: course, error: courseError } = await supabase
        .from('courses')
        .insert({
          title: courseData.title,
          description: courseData.description || null,
          thumbnail_url: courseData.thumbnail_url || null,
          payment_url: courseData.payment_url || null,
          is_published: courseData.is_published,
          instructor_id: selectedInstructors[0] || user.id,
        })
        .select()
        .single();

      if (courseError) throw courseError;

      // Add course instructors
      if (selectedInstructors.length > 0) {
        const instructorInserts = selectedInstructors.map(instructorId => ({
          course_id: course.id,
          instructor_id: instructorId,
        }));
        await supabase.from('course_instructors').insert(instructorInserts);
      }

      for (let i = 0; i < modules.length; i++) {
        const module = modules[i];
        if (!module.title.trim()) continue;

        const { data: moduleData, error: moduleError } = await supabase
          .from('modules')
          .insert({
            course_id: course.id,
            title: module.title,
            description: module.description || null,
            order_index: i,
          })
          .select()
          .single();

        if (moduleError) throw moduleError;

        for (let j = 0; j < module.lessons.length; j++) {
          const lesson = module.lessons[j];
          if (!lesson.title.trim()) continue;

          const { error: lessonError } = await supabase
            .from('lessons')
            .insert({
              module_id: moduleData.id,
              title: lesson.title,
              lesson_type: lesson.lesson_type,
              video_url: lesson.video_url || null,
              file_url: lesson.file_url || null,
              exam_id: lesson.exam_id || null,
              content_text: lesson.content_text || null,
              embed_url: lesson.embed_url || null,
              resources_url: lesson.resources_url || null,
              is_hidden: lesson.is_hidden || false,
              order_index: j,
            });

          if (lessonError) throw lessonError;
        }
      }

      // KG sync happens automatically via Postgres triggers → kg-sync edge function.
      // No frontend trigger needed.

      toast.success(t('createCourse.success'));
      navigate(`/courses/${course.id}`);
    } catch (error: any) {
      console.error('Error creating course:', error);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/courses')}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{t('createCourse.title')}</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
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
                    {selectedInstructors.map(id => {
                      const instructor = instructors.find(i => i.id === id);
                      if (!instructor) return null;
                      return (
                        <div key={id} className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">
                          <span>{instructor.full_name}</span>
                          <button type="button" onClick={() => toggleInstructor(id)}>
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
            </CardContent>
          </Card>

          {/* Modules */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('createCourse.modulesAndLessons')}</h2>
              <Button type="button" variant="outline" size="sm" onClick={addModule}>
                <Plus className="w-4 h-4 ml-1" />
                {t('createCourse.addModule')}
              </Button>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndModules}>
              <SortableContext items={modules.map((_, i) => `module-${i}`)} strategy={verticalListSortingStrategy}>
                {modules.map((module, moduleIndex) => (
                  <SortableModule key={`module-${moduleIndex}`} id={`module-${moduleIndex}`}>
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">
                            {t('createCourse.module')} {moduleIndex + 1}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeModule(moduleIndex)}
                            disabled={modules.length === 1}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>{t('createCourse.moduleName')} *</Label>
                            <Input
                              value={module.title}
                              onChange={(e) => updateModule(moduleIndex, 'title', e.target.value)}
                              placeholder={t('createCourse.moduleNamePlaceholder')}
                              className={!module.title.trim() && module.lessons.some(l => l.title.trim()) ? 'border-destructive' : ''}
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
                                <SortableLesson key={`lesson-${moduleIndex}-${lessonIndex}`} id={`lesson-${moduleIndex}-${lessonIndex}`}>
                                  <LessonForm
                                    lesson={lesson}
                                    lessonIndex={lessonIndex}
                                    moduleIndex={moduleIndex}
                                    canRemove={module.lessons.length > 1}
                                    onUpdate={updateLesson}
                                    onRemove={removeLesson}
                                  />
                                </SortableLesson>
                              ))}
                            </SortableContext>
                          </DndContext>
                        </div>
                      </CardContent>
                    </Card>
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
              {loading ? t('createCourse.creating') : t('createCourse.create')}
            </Button>
          </div>
        </form>
      </div>
  );
}

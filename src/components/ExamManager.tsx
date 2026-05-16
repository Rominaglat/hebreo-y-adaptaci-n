import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, GripVertical, Edit, Eye, Upload, ImageIcon, Sparkles, Loader2 } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface QuestionOption {
  text: string;
  image_url?: string;
  explanation?: string;
  is_correct: boolean;
}

interface Question {
  id?: string;
  question_text: string;
  image_url?: string;
  options: QuestionOption[];
  explanation?: string;
  points: number;
}

interface Exam {
  id: string;
  title: string;
  description: string | null;
  passing_score: number;
  time_limit_minutes: number | null;
  is_published: boolean;
}

interface ExamManagerProps {
  courseId: string;
}

// Sortable Question component
function SortableQuestion({ id, children }: { id: string; children: React.ReactNode }) {
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
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'z-50 opacity-80 shadow-lg' : ''}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded touch-none mt-3"
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

export default function ExamManager({ courseId }: ExamManagerProps) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiQuestionCount, setAiQuestionCount] = useState(5);
  const [loading, setLoading] = useState(true);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const questionImageRef = useRef<HTMLInputElement>(null);
  const optionImageRef = useRef<HTMLInputElement>(null);
  const [currentUploadTarget, setCurrentUploadTarget] = useState<{ questionIndex: number; optionIndex?: number } | null>(null);

  const [examForm, setExamForm] = useState({
    title: '',
    description: '',
    passing_score: 60,
    time_limit_minutes: 30,
    is_published: false,
  });

  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    fetchExams();
  }, [courseId]);

  const fetchExams = async () => {
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .eq('course_id', courseId)
      .order('order_index');

    if (data) {
      setExams(data);
    }
    setLoading(false);
  };

  const createEmptyQuestion = (): Question => ({
    question_text: '',
    options: [
      { text: '', is_correct: false, explanation: '' },
      { text: '', is_correct: false, explanation: '' },
      { text: '', is_correct: false, explanation: '' },
      { text: '', is_correct: false, explanation: '' },
    ],
    points: 1,
  });

  const openCreateDialog = () => {
    setEditingExam(null);
    setExamForm({
      title: '',
      description: '',
      passing_score: 60,
      time_limit_minutes: 30,
      is_published: false,
    });
    setQuestions([createEmptyQuestion()]);
    setIsDialogOpen(true);
  };

  const openEditDialog = async (exam: Exam) => {
    setEditingExam(exam);
    setExamForm({
      title: exam.title,
      description: exam.description || '',
      passing_score: exam.passing_score,
      time_limit_minutes: exam.time_limit_minutes || 30,
      is_published: exam.is_published,
    });

    const { data: questionsData } = await supabase
      .from('exam_questions')
      .select('*')
      .eq('exam_id', exam.id)
      .order('order_index');

    if (questionsData && questionsData.length > 0) {
      setQuestions(
        questionsData.map((q: any) => {
          const options = (q.options as any[]) || [];
          const correctOptions = (q.correct_options as number[]) || [];
          
          return {
            id: q.id,
            question_text: q.question_text,
            image_url: q.image_url,
            explanation: q.explanation,
            options: options.map((opt: any, idx: number) => ({
              text: typeof opt === 'string' ? opt : opt.text || '',
              image_url: typeof opt === 'object' ? opt.image_url : undefined,
              explanation: typeof opt === 'object' ? opt.explanation : undefined,
              is_correct: correctOptions.includes(idx),
            })),
            points: q.points,
          };
        })
      );
    } else {
      setQuestions([createEmptyQuestion()]);
    }
    setIsDialogOpen(true);
  };

  const generateQuestionsWithAi = async () => {
    setGeneratingAi(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: {
          course_id: courseId,
          num_questions: aiQuestionCount,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (Array.isArray(data?.questions) && data.questions.length > 0) {
        // Append generated questions to existing ones
        setQuestions((prev) => [...prev, ...data.questions]);
        toast.success(
          language === 'he'
            ? `נוצרו ${data.questions.length} שאלות חדשות 🎉`
            : `Generated ${data.questions.length} new questions 🎉`
        );
      } else {
        toast.error(
          language === 'he' ? 'לא נוצרו שאלות' : 'No questions generated'
        );
      }
    } catch (e) {
      console.error('AI quiz generation failed', e);
      toast.error(
        language === 'he' ? 'יצירת שאלות נכשלה' : 'Failed to generate questions'
      );
    } finally {
      setGeneratingAi(false);
    }
  };

  const addQuestion = () => {
    setQuestions([...questions, createEmptyQuestion()]);
  };

  const removeQuestion = (index: number) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEndQuestions = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = questions.findIndex((_, i) => `question-${i}` === active.id);
      const newIndex = questions.findIndex((_, i) => `question-${i}` === over.id);
      setQuestions(arrayMove(questions, oldIndex, newIndex));
    }
  };

  const updateQuestion = (index: number, field: string, value: any) => {
    const updated = [...questions];
    (updated[index] as any)[field] = value;
    setQuestions(updated);
  };

  const updateOption = (questionIndex: number, optionIndex: number, field: string, value: any) => {
    const updated = [...questions];
    (updated[questionIndex].options[optionIndex] as any)[field] = value;
    setQuestions(updated);
  };

  const addOption = (questionIndex: number) => {
    const updated = [...questions];
    updated[questionIndex].options.push({ text: '', is_correct: false, explanation: '' });
    setQuestions(updated);
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    if (questions[questionIndex].options.length > 2) {
      const updated = [...questions];
      updated[questionIndex].options = updated[questionIndex].options.filter((_, i) => i !== optionIndex);
      setQuestions(updated);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, questionIndex: number, optionIndex?: number) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const uploadKey = optionIndex !== undefined ? `${questionIndex}-${optionIndex}` : `q-${questionIndex}`;
    setUploadingImage(uploadKey);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `exams/${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('course-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('course-images')
        .getPublicUrl(fileName);

      if (optionIndex !== undefined) {
        updateOption(questionIndex, optionIndex, 'image_url', publicUrl);
      } else {
        updateQuestion(questionIndex, 'image_url', publicUrl);
      }
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast.error(error.message);
    } finally {
      setUploadingImage(null);
      e.target.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!examForm.title.trim()) {
      toast.error(t('exams.titleRequired'));
      return;
    }

    try {
      if (editingExam) {
        const { error } = await supabase
          .from('exams')
          .update({
            title: examForm.title,
            description: examForm.description || null,
            passing_score: examForm.passing_score,
            time_limit_minutes: examForm.time_limit_minutes || null,
            is_published: examForm.is_published,
          })
          .eq('id', editingExam.id);

        if (error) throw error;

        await supabase.from('exam_questions').delete().eq('exam_id', editingExam.id);

        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          if (!q.question_text.trim()) continue;

          const correctOptions = q.options
            .map((opt, idx) => opt.is_correct ? idx : -1)
            .filter(idx => idx !== -1);

          const optionsData = q.options
            .filter(o => o.text.trim())
            .map(o => ({
              text: o.text,
              image_url: o.image_url || null,
              explanation: o.explanation || null,
            }));

          await supabase.from('exam_questions').insert({
            exam_id: editingExam.id,
            question_text: q.question_text,
            image_url: q.image_url || null,
            explanation: q.explanation || null,
            options: optionsData,
            correct_options: correctOptions,
            points: q.points,
            order_index: i,
          });
        }

        toast.success(t('exams.updated'));
      } else {
        const { data: newExam, error } = await supabase
          .from('exams')
          .insert({
            course_id: courseId,
            title: examForm.title,
            description: examForm.description || null,
            passing_score: examForm.passing_score,
            time_limit_minutes: examForm.time_limit_minutes || null,
            is_published: examForm.is_published,
            order_index: exams.length,
          })
          .select()
          .single();

        if (error) throw error;

        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          if (!q.question_text.trim()) continue;

          const correctOptions = q.options
            .map((opt, idx) => opt.is_correct ? idx : -1)
            .filter(idx => idx !== -1);

          const optionsData = q.options
            .filter(o => o.text.trim())
            .map(o => ({
              text: o.text,
              image_url: o.image_url || null,
              explanation: o.explanation || null,
            }));

          await supabase.from('exam_questions').insert({
            exam_id: newExam.id,
            question_text: q.question_text,
            image_url: q.image_url || null,
            explanation: q.explanation || null,
            options: optionsData,
            correct_options: correctOptions,
            points: q.points,
            order_index: i,
          });
        }

        toast.success(t('exams.created'));
      }

      setIsDialogOpen(false);
      fetchExams();
    } catch (error: any) {
      console.error('Error saving exam:', error);
      toast.error(error.message);
    }
  };

  const deleteExam = async (examId: string) => {
    if (!confirm(t('exams.deleteConfirm'))) return;

    try {
      const { error } = await supabase.from('exams').delete().eq('id', examId);
      if (error) throw error;
      toast.success(t('exams.deleted'));
      fetchExams();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const togglePublish = async (exam: Exam) => {
    try {
      const { error } = await supabase
        .from('exams')
        .update({ is_published: !exam.is_published })
        .eq('id', exam.id);

      if (error) throw error;
      fetchExams();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  if (loading) {
    return <div className="text-center p-4">{t('common.loading')}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('exams.title')}</CardTitle>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" onClick={openCreateDialog}>
                <Plus className="w-4 h-4 ml-1" />
                {t('exams.addExam')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingExam ? t('exams.editExam') : t('exams.createExam')}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('exams.examTitle')}</Label>
                    <Input
                      value={examForm.title}
                      onChange={(e) => setExamForm({ ...examForm, title: e.target.value })}
                      placeholder={t('exams.examTitlePlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('exams.passingScore')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={examForm.passing_score}
                      onChange={(e) => setExamForm({ ...examForm, passing_score: parseInt(e.target.value) || 60 })}
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('exams.timeLimit')}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={examForm.time_limit_minutes || ''}
                      onChange={(e) => setExamForm({ ...examForm, time_limit_minutes: parseInt(e.target.value) || 0 })}
                      placeholder={t('exams.timeLimitPlaceholder')}
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-6">
                    <Switch
                      checked={examForm.is_published}
                      onCheckedChange={(checked) => setExamForm({ ...examForm, is_published: checked })}
                    />
                    <Label>{t('exams.publishExam')}</Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('exams.description')}</Label>
                  <Textarea
                    value={examForm.description}
                    onChange={(e) => setExamForm({ ...examForm, description: e.target.value })}
                    placeholder={t('exams.descriptionPlaceholder')}
                    rows={2}
                  />
                </div>

                {/* Questions */}
                <div className="border-t pt-4 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label className="text-base font-semibold">{t('exams.questions')}</Label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        type="number"
                        min={3}
                        max={15}
                        value={aiQuestionCount}
                        onChange={(e) => setAiQuestionCount(parseInt(e.target.value) || 5)}
                        className="h-9 w-16"
                        title={language === 'he' ? 'מספר שאלות לייצור' : 'Number of questions to generate'}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={generateQuestionsWithAi}
                        disabled={generatingAi}
                        className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5"
                      >
                        {generatingAi ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        {language === 'he' ? 'יצירה עם AI' : 'Generate with AI'}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
                        <Plus className="w-4 h-4 ml-1" />
                        {t('exams.addQuestion')}
                      </Button>
                    </div>
                  </div>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndQuestions}>
                    <SortableContext items={questions.map((_, i) => `question-${i}`)} strategy={verticalListSortingStrategy}>
                      {questions.map((question, qIndex) => (
                        <SortableQuestion key={`question-${qIndex}`} id={`question-${qIndex}`}>
                          <div className="bg-muted/50 rounded-lg p-4 space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{t('exams.question')} {qIndex + 1}</span>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Label className="text-xs">{t('exams.points')}:</Label>
                            <Input
                              type="number"
                              min={1}
                              value={question.points}
                              onChange={(e) => updateQuestion(qIndex, 'points', parseInt(e.target.value) || 1)}
                              className="w-16 h-7 text-xs"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeQuestion(qIndex)}
                            disabled={questions.length === 1}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      {/* Question text and image */}
                      <div className="space-y-2">
                        <Textarea
                          value={question.question_text}
                          onChange={(e) => updateQuestion(qIndex, 'question_text', e.target.value)}
                          placeholder={t('exams.questionTextPlaceholder')}
                          rows={2}
                        />
                        
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={qIndex === 0 ? questionImageRef : undefined}
                            onChange={(e) => handleImageUpload(e, qIndex)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (e) => handleImageUpload(e as any, qIndex);
                              input.click();
                            }}
                            disabled={uploadingImage === `q-${qIndex}`}
                          >
                            <ImageIcon className="w-4 h-4 ml-1" />
                            {uploadingImage === `q-${qIndex}` ? t('createCourse.uploading') : t('exams.addImage')}
                          </Button>
                          {question.image_url && (
                            <div className="relative">
                              <img src={question.image_url} alt="" className="h-12 rounded" />
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="absolute -top-2 -right-2 h-5 w-5"
                                onClick={() => updateQuestion(qIndex, 'image_url', undefined)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Options */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">{t('exams.options')}</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => addOption(qIndex)}
                          >
                            <Plus className="w-3 h-3 ml-1" />
                            {t('exams.addOption')}
                          </Button>
                        </div>

                        {question.options.map((option, oIndex) => (
                          <div key={oIndex} className="bg-background rounded-lg p-3 space-y-2">
                            <div className="flex items-start gap-3">
                              <div className="flex items-center gap-2 pt-2">
                                <Checkbox
                                  checked={option.is_correct}
                                  onCheckedChange={(checked) => updateOption(qIndex, oIndex, 'is_correct', !!checked)}
                                />
                                <span className="text-xs text-muted-foreground">{t('exams.correct')}</span>
                              </div>
                              <div className="flex-1 space-y-2">
                                <Input
                                  value={option.text}
                                  onChange={(e) => updateOption(qIndex, oIndex, 'text', e.target.value)}
                                  placeholder={`${t('exams.option')} ${oIndex + 1}`}
                                />
                                
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.accept = 'image/*';
                                      input.onchange = (e) => handleImageUpload(e as any, qIndex, oIndex);
                                      input.click();
                                    }}
                                    disabled={uploadingImage === `${qIndex}-${oIndex}`}
                                  >
                                    <ImageIcon className="w-3 h-3 ml-1" />
                                    {uploadingImage === `${qIndex}-${oIndex}` ? '...' : t('exams.addImage')}
                                  </Button>
                                  {option.image_url && (
                                    <div className="relative">
                                      <img src={option.image_url} alt="" className="h-8 rounded" />
                                      <Button
                                        type="button"
                                        variant="destructive"
                                        size="icon"
                                        className="absolute -top-1 -right-1 h-4 w-4"
                                        onClick={() => updateOption(qIndex, oIndex, 'image_url', undefined)}
                                      >
                                        <Trash2 className="w-2 h-2" />
                                      </Button>
                                    </div>
                                  )}
                                </div>

                                <Input
                                  value={option.explanation || ''}
                                  onChange={(e) => updateOption(qIndex, oIndex, 'explanation', e.target.value)}
                                  placeholder={t('exams.explanationPlaceholder')}
                                  className="text-xs"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => removeOption(qIndex, oIndex)}
                                disabled={question.options.length <= 2}
                              >
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                          {/* General explanation for the question */}
                          <div className="space-y-1">
                            <Label className="text-xs">{t('exams.generalExplanation')}</Label>
                            <Textarea
                              value={question.explanation || ''}
                              onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                              placeholder={t('exams.generalExplanationPlaceholder')}
                              rows={2}
                              className="text-sm"
                            />
                          </div>
                        </div>
                      </SortableQuestion>
                    ))}
                  </SortableContext>
                </DndContext>
              </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="button" onClick={handleSubmit}>
                    {editingExam ? t('common.save') : t('common.create')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {exams.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">{t('exams.noExams')}</p>
        ) : (
          <div className="space-y-2">
            {exams.map((exam) => (
              <div
                key={exam.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{exam.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('exams.passingScore')}: {exam.passing_score}% | 
                      {exam.time_limit_minutes && ` ${exam.time_limit_minutes} ${t('common.min')}`}
                    </p>
                  </div>
                  {!exam.is_published && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-600 px-2 py-0.5 rounded">
                      {t('courses.draft')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => togglePublish(exam)}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEditDialog(exam)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => deleteExam(exam.id)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
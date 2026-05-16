import { useEffect, useState, useMemo } from 'react';
import { CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Option {
  text: string;
  image_url?: string;
  explanation?: string;
}

interface ShuffledOption extends Option {
  originalIndex: number;
}

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  options: Option[];
  correct_options: number[]; // indexes - only populated after submission
  points: number;
  image_url: string | null;
  explanation: string | null;
  order_index: number;
  isCorrect?: boolean;
  userAnswer?: number[];
}

// Seeded random number generator for consistent shuffling per question
function seededRandom(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return function() {
    hash = Math.sin(hash) * 10000;
    return hash - Math.floor(hash);
  };
}

function shuffleArray<T>(array: T[], seed: string): T[] {
  const shuffled = [...array];
  const random = seededRandom(seed);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Create shuffled options map once when questions load
function createShuffledOptionsMap(questions: Question[], submitted: boolean): Record<string, ShuffledOption[]> {
  const map: Record<string, ShuffledOption[]> = {};
  questions.forEach(question => {
    if (submitted) {
      map[question.id] = question.options.map((opt, idx) => ({ ...opt, originalIndex: idx }));
    } else {
      const optionsWithIndices = question.options.map((opt, idx) => ({ ...opt, originalIndex: idx }));
      map[question.id] = shuffleArray(optionsWithIndices, question.id);
    }
  });
  return map;
}

interface Exam {
  id: string;
  title: string;
  description: string | null;
  passing_score: number;
  time_limit_minutes: number | null;
}

interface ExamTakerProps {
  examId: string;
  onComplete?: () => void;
}

export default function ExamTaker({ examId, onComplete }: ExamTakerProps) {
  const { user, isAdminOrInstructor } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();

  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);

  // Memoize shuffled options to keep consistent order during exam
  const shuffledOptionsMap = useMemo(() => {
    return createShuffledOptionsMap(questions, submitted);
  }, [questions, submitted]);
  useEffect(() => {
    fetchExamData();
  }, [examId]);

  useEffect(() => {
    if (timeRemaining !== null && timeRemaining > 0 && !submitted) {
      const timer = setTimeout(() => {
        setTimeRemaining(prev => (prev !== null ? prev - 1 : null));
      }, 1000);
      return () => clearTimeout(timer);
    } else if (timeRemaining === 0 && !submitted) {
      handleSubmit();
    }
  }, [timeRemaining, submitted]);

  const invokeWithAuth = async (functionName: string, body: object) => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session?.access_token) {
      // Try to refresh the session
      const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError || !refreshedSession?.access_token) {
        toast({
          title: t('common.error'),
          description: t('auth.sessionExpired') || 'Session expired, please login again',
          variant: 'destructive'
        });
        throw new Error('No active session');
      }
      
      return supabase.functions.invoke(functionName, {
        body,
        headers: {
          Authorization: `Bearer ${refreshedSession.access_token}`
        }
      });
    }

    return supabase.functions.invoke(functionName, {
      body,
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });
  };

  const fetchExamData = async () => {
    try {
      // Fetch exam details
      const { data: examData } = await supabase
        .from('exams')
        .select('*')
        .eq('id', examId)
        .single();

      if (examData) {
        setExam(examData);
        if (examData.time_limit_minutes) {
          setTimeRemaining(examData.time_limit_minutes * 60);
        }
      }

      // Check for existing completed attempt first
      if (user) {
        const { data: existingAttempt } = await supabase
          .from('exam_attempts')
          .select('*')
          .eq('exam_id', examId)
          .eq('user_id', user.id)
          .not('completed_at', 'is', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingAttempt) {
          // User has completed the exam - fetch questions with answers
          const { data, error } = await invokeWithAuth('get-exam-questions', { examId, includeAnswers: true });

          if (!error && data?.questions) {
            setQuestions(data.questions);
          }

          setSubmitted(true);
          setScore(existingAttempt.score);
          setPassed(existingAttempt.passed);
          setAnswers((existingAttempt.answers as Record<string, number[]>) || {});
          setAttemptId(existingAttempt.id);
          setLoading(false);
          return;
        }
      }

      // Fetch questions without answers (secure)
      const { data, error } = await invokeWithAuth('get-exam-questions', { examId, includeAnswers: false });

      if (error) {
        console.error('Error fetching questions:', error);
        // Fallback to direct query for admins/instructors
        if (isAdminOrInstructor) {
          const { data: questionsData } = await supabase
            .from('exam_questions')
            .select('*')
            .eq('exam_id', examId)
            .order('order_index');

          if (questionsData) {
            const processedQuestions = questionsData.map(q => ({
              ...q,
              options: (q.options as unknown as Option[]) || [],
              correct_options: (q.correct_options as unknown as number[]) || []
            }));
            setQuestions(processedQuestions);
          }
        }
      } else if (data?.questions) {
        setQuestions(data.questions);
      }

    } catch (error) {
      console.error('Error fetching exam:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionId: string, optionIndex: number, isMultiple: boolean) => {
    setAnswers(prev => {
      if (isMultiple) {
        const current = prev[questionId] || [];
        if (current.includes(optionIndex)) {
          return { ...prev, [questionId]: current.filter(idx => idx !== optionIndex) };
        } else {
          return { ...prev, [questionId]: [...current, optionIndex] };
        }
      } else {
        return { ...prev, [questionId]: [optionIndex] };
      }
    });
  };

  const handleSubmit = async () => {
    if (!user || !exam || submitting) return;

    setSubmitting(true);

    try {
      // Submit exam via secure edge function
      const { data, error } = await invokeWithAuth('submit-exam', { examId, answers });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to submit exam');
      }

      // Update state with results from server
      setAttemptId(data.attemptId);
      setScore(data.score);
      setPassed(data.passed);
      setSubmitted(true);

      // Update questions with correct answers from server
      if (data.questions) {
        setQuestions(data.questions);
      }

      toast({
        title: data.passed ? t('exam.passed') : t('exam.failed'),
        description: `${t('exam.yourScore')}: ${data.score}%`,
        variant: data.passed ? 'default' : 'destructive'
      });

      if (data.passed && onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Error submitting exam:', error);
      toast({
        title: t('common.error'),
        description: t('exam.submitError'),
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async () => {
    setSubmitted(false);
    setScore(null);
    setPassed(null);
    setAnswers({});
    setAttemptId(null);
    if (exam?.time_limit_minutes) {
      setTimeRemaining(exam.time_limit_minutes * 60);
    }

    // Refetch questions without answers
    const { data, error } = await invokeWithAuth('get-exam-questions', { examId, includeAnswers: false });

    if (!error && data?.questions) {
      setQuestions(data.questions);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  if (!exam) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">{t('exam.notFound')}</p>
        </CardContent>
      </Card>
    );
  }

  if (questions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{exam.title}</CardTitle>
          {exam.description && (
            <p className="text-sm text-muted-foreground">{exam.description}</p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
          <p className="text-lg font-medium mb-2">{t('exam.noQuestions')}</p>
          <p className="text-sm text-muted-foreground">{t('exam.noQuestionsDescription')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 px-2 sm:px-0">
      {/* Exam Header */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg sm:text-xl break-words">{exam.title}</CardTitle>
              {exam.description && (
                <p className="text-sm text-muted-foreground mt-1 break-words">{exam.description}</p>
              )}
            </div>
            {timeRemaining !== null && !submitted && (
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium self-start flex-shrink-0",
                timeRemaining < 60 ? "bg-destructive/10 text-destructive" : "bg-secondary"
              )}>
                <Clock className="w-4 h-4" />
                {formatTime(timeRemaining)}
              </div>
            )}
          </div>
          {submitted && score !== null && (
            <div className={cn(
              "mt-4 p-4 rounded-lg flex items-center gap-3",
              passed ? "bg-green-500/10" : "bg-destructive/10"
            )}>
              {passed ? (
                <CheckCircle className="w-6 h-6 text-green-500" />
              ) : (
                <XCircle className="w-6 h-6 text-destructive" />
              )}
              <div>
                <p className={cn("font-semibold", passed ? "text-green-500" : "text-destructive")}>
                  {passed ? t('exam.passed') : t('exam.failed')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('exam.yourScore')}: {score}% ({t('exam.passingScore')}: {exam.passing_score}%)
                </p>
              </div>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Questions */}
      {questions.map((question, index) => {
        const userAnswer = submitted && question.userAnswer 
          ? question.userAnswer 
          : (answers[question.id] || []);
        
        // Only show correct/incorrect after submission when we have the data from server
        const hasCorrectData = submitted && question.correct_options && question.correct_options.length > 0;
        const isCorrect = hasCorrectData && question.isCorrect !== undefined 
          ? question.isCorrect 
          : (hasCorrectData && userAnswer.length === question.correct_options.length &&
             userAnswer.every(a => question.correct_options.includes(a)));
        
        const isMultiple = !submitted 
          ? questions.filter(q => q.id === question.id).length > 1 || question.question_type === 'multiple_choice'
          : question.correct_options.length > 1;

        return (
          <Card key={question.id} className={cn(
            hasCorrectData && (isCorrect ? "border-green-500/50" : "border-destructive/50")
          )}>
            <CardHeader className="pb-3 p-4 sm:p-6 sm:pb-3">
              <div className="flex items-start gap-2 sm:gap-3">
                <span className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs sm:text-sm font-medium">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm sm:text-base break-words">{question.question_text}</p>
                  {question.image_url && (
                    <img 
                      src={question.image_url} 
                      alt="" 
                      className="mt-2 max-w-full rounded-lg object-contain max-h-64"
                      style={{ maxWidth: 'min(100%, 28rem)' }}
                    />
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {question.points} {t('exam.points')} 
                    {isMultiple && ` • ${t('exam.multipleAnswers')}`}
                  </p>
                </div>
                {hasCorrectData && (
                  isCorrect ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-destructive" />
                  )
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 sm:space-y-3 p-4 sm:p-6 pt-0 sm:pt-0">
              {(() => {
                const shuffledOptions = shuffledOptionsMap[question.id] || question.options.map((opt, idx) => ({ ...opt, originalIndex: idx }));

                return isMultiple ? (
                  // Multiple choice with checkboxes
                  shuffledOptions.map((option) => {
                    const isSelected = userAnswer.includes(option.originalIndex);
                    const isOptionCorrect = hasCorrectData && question.correct_options.includes(option.originalIndex);
                    
                    return (
                      <div 
                        key={option.originalIndex}
                        className={cn(
                          "flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border transition-colors",
                          !submitted && "hover:bg-secondary/50 cursor-pointer active:bg-secondary/70",
                          hasCorrectData && isOptionCorrect && "bg-green-500/10 border-green-500/50",
                          hasCorrectData && isSelected && !isOptionCorrect && "bg-destructive/10 border-destructive/50"
                        )}
                        onClick={() => !submitted && handleAnswerChange(question.id, option.originalIndex, true)}
                      >
                        <Checkbox 
                          checked={isSelected}
                          disabled={submitted}
                          className="mt-0.5 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm break-words">{option.text}</p>
                          {option.image_url && (
                            <img 
                              src={option.image_url} 
                              alt="" 
                              className="mt-2 rounded object-contain max-h-48"
                              style={{ maxWidth: 'min(100%, 20rem)' }}
                            />
                          )}
                          {hasCorrectData && option.explanation && (
                            <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1">
                              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              {option.explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  // Single choice with radio buttons
                  <RadioGroup 
                    value={userAnswer[0]?.toString() || ''} 
                    onValueChange={(value) => !submitted && handleAnswerChange(question.id, parseInt(value), false)}
                    disabled={submitted}
                  >
                    {shuffledOptions.map((option) => {
                      const isSelected = userAnswer.includes(option.originalIndex);
                      const isOptionCorrect = hasCorrectData && question.correct_options.includes(option.originalIndex);
                      
                      return (
                        <div 
                          key={option.originalIndex}
                          className={cn(
                            "flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border transition-colors",
                            !submitted && "hover:bg-secondary/50 cursor-pointer active:bg-secondary/70",
                            hasCorrectData && isOptionCorrect && "bg-green-500/10 border-green-500/50",
                            hasCorrectData && isSelected && !isOptionCorrect && "bg-destructive/10 border-destructive/50"
                          )}
                          onClick={() => !submitted && handleAnswerChange(question.id, option.originalIndex, false)}
                        >
                          <RadioGroupItem value={option.originalIndex.toString()} className="mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <Label className="text-sm cursor-pointer break-words">{option.text}</Label>
                            {option.image_url && (
                              <img 
                                src={option.image_url} 
                                alt="" 
                                className="mt-2 rounded object-contain max-h-48"
                                style={{ maxWidth: 'min(100%, 20rem)' }}
                              />
                            )}
                            {hasCorrectData && option.explanation && (
                              <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1">
                                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                {option.explanation}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </RadioGroup>
                );
              })()}
              {/* Question explanation */}
              {hasCorrectData && question.explanation && (
                <div className="mt-3 p-3 bg-secondary/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    <strong>{t('exam.explanation')}:</strong> {question.explanation}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Submit / Retry Button */}
      <div className="flex justify-center gap-4 pt-4 pb-6 px-2 sm:px-0">
        {!submitted ? (
          <Button 
            size="lg" 
            onClick={handleSubmit}
            disabled={Object.keys(answers).length < questions.length || submitting}
            className="w-full sm:w-auto"
          >
            {submitting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
            ) : null}
            {t('exam.submit')}
          </Button>
        ) : (
          <Button size="lg" variant="outline" onClick={handleRetry} className="w-full sm:w-auto">
            {t('exam.retryExam')}
          </Button>
        )}
      </div>
    </div>
  );
}

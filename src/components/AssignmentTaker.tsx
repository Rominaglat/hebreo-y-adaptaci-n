import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mic, Square, RotateCcw, Send, CheckCircle, MessageSquare, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useToast } from '@/components/ui/use-toast';
import type { AssignmentQuestion } from '@/components/LessonForm';

const BUCKET = 'assignment-audio';

interface AnswerRow { questionId: string; text: string; audioPath: string | null }

interface AssignmentTakerProps {
  lessonId: string;
  questions: AssignmentQuestion[];
  onComplete?: () => void;
}

interface QuestionHandle { getText: () => string; getBlob: () => Blob | null }

// One question: its own text answer + its own optional recording. Self-contained
// (holds its recorder + text); the parent reads it via ref at submit time.
const QuestionBlock = forwardRef<QuestionHandle, {
  index: number; question: AssignmentQuestion; initialText: string; existingAudioUrl: string | null;
}>(({ index, question, initialText, existingAudioUrl }, ref) => {
  const { t } = useLanguage();
  const recorder = useAudioRecorder();
  const [text, setText] = useState(initialText);
  useImperativeHandle(ref, () => ({ getText: () => text, getBlob: () => recorder.blob }), [text, recorder.blob]);

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <p className="font-semibold text-foreground">
        <span className="text-primary">{t('assignment.question')} {index + 1}.</span> {question.text}
      </p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={t('assignment.answerPlaceholder')} />

      <div className="flex flex-wrap items-center gap-3">
        {recorder.status === 'idle' && (
          <Button type="button" variant="outline" size="sm" onClick={() => void recorder.start()}>
            <Mic className="w-4 h-4 me-2" /> {t('assignment.record')}
          </Button>
        )}
        {recorder.status === 'recording' && (
          <Button type="button" variant="destructive" size="sm" onClick={recorder.stop}>
            <Square className="w-4 h-4 me-2" /> {t('assignment.stop')}
          </Button>
        )}
        {recorder.status === 'recorded' && recorder.url && (
          <>
            <audio controls src={recorder.url} className="h-9" />
            <Button type="button" variant="ghost" size="sm" onClick={recorder.reset}>
              <RotateCcw className="w-4 h-4 me-2" /> {t('assignment.rerecord')}
            </Button>
          </>
        )}
        {recorder.status === 'idle' && existingAudioUrl && <audio controls src={existingAudioUrl} className="h-9" />}
      </div>
      {recorder.error && <p className="text-xs text-destructive">{t('assignment.micError')}</p>}
    </div>
  );
});
QuestionBlock.displayName = 'QuestionBlock';

export default function AssignmentTaker({ lessonId, questions, onComplete }: AssignmentTakerProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();

  const [initialAnswers, setInitialAnswers] = useState<Record<string, AnswerRow>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'submitted' | 'reviewed' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const handles = useState(() => new Map<string, QuestionHandle>())[0];

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('assignment_submissions')
      .select('answers, status, feedback_text')
      .eq('lesson_id', lessonId).eq('user_id', user.id).maybeSingle();

    if (data) {
      const answers = (Array.isArray(data.answers) ? data.answers : []) as unknown as AnswerRow[];
      const byId: Record<string, AnswerRow> = {};
      const urls: Record<string, string> = {};
      for (const a of answers) {
        byId[a.questionId] = a;
        if (a.audioPath) {
          const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(a.audioPath, 3600);
          if (signed?.signedUrl) urls[a.questionId] = signed.signedUrl;
        }
      }
      setInitialAnswers(byId);
      setAudioUrls(urls);
      setStatus(data.status as 'submitted' | 'reviewed');
      setFeedback(data.feedback_text);
    }
    setLoading(false);
  }, [user, lessonId]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      const answers: AnswerRow[] = [];
      for (const q of questions) {
        const h = handles.get(q.id);
        const text = h?.getText() ?? initialAnswers[q.id]?.text ?? '';
        const blob = h?.getBlob() ?? null;
        let audioPath = initialAnswers[q.id]?.audioPath ?? null;
        if (blob) {
          audioPath = `${user.id}/${lessonId}/${q.id}.webm`;
          const { error: upErr } = await supabase.storage.from(BUCKET)
            .upload(audioPath, blob, { upsert: true, contentType: blob.type || 'audio/webm' });
          if (upErr) throw upErr;
        }
        answers.push({ questionId: q.id, text, audioPath });
      }
      const { error } = await supabase.from('assignment_submissions').upsert(
        { lesson_id: lessonId, user_id: user.id, answers: answers as unknown as never, status: 'submitted' },
        { onConflict: 'lesson_id,user_id' },
      );
      if (error) throw error;
      await load();
      onComplete?.();
      toast({ title: t('assignment.submitted') });
    } catch (e) {
      toast({ title: t('assignment.submitError'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }, [user, lessonId, questions, handles, initialAnswers, load, onComplete, toast, t]);

  if (loading) return <Card className="p-6 animate-pulse h-40" />;

  const hasSubmitted = status !== null;
  const isReviewed = status === 'reviewed' && !!feedback;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-primary" /> {t('lessonForm.assignmentTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isReviewed && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-bold text-foreground flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-primary" /> {t('assignment.feedbackTitle')}
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{feedback}</p>
          </div>
        )}
        {hasSubmitted && !isReviewed && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary" /> {t('assignment.awaitingReview')}
          </p>
        )}

        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('assignment.noQuestions')}</p>
        ) : (
          <>
            {questions.map((q, i) => (
              <QuestionBlock
                key={q.id}
                index={i}
                question={q}
                initialText={initialAnswers[q.id]?.text ?? ''}
                existingAudioUrl={audioUrls[q.id] ?? null}
                ref={(el) => { if (el) handles.set(q.id, el); else handles.delete(q.id); }}
              />
            ))}
            <Button className="font-bold" disabled={submitting} onClick={() => void submit()}>
              {submitting ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Send className="w-4 h-4 me-2" />}
              {hasSubmitted ? t('assignment.resubmit') : t('assignment.submit')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

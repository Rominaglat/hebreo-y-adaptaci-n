import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mic, Square, RotateCcw, Send, CheckCircle, MessageSquare, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useToast } from '@/components/ui/use-toast';

const BUCKET = 'assignment-audio';

interface AssignmentTakerProps {
  lessonId: string;
  prompt: string | null;
  onComplete?: () => void;
}

interface SubmissionRow {
  answer_text: string | null;
  audio_path: string | null;
  status: 'submitted' | 'reviewed';
  feedback_text: string | null;
}

export default function AssignmentTaker({ lessonId, prompt, onComplete }: AssignmentTakerProps) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const recorder = useAudioRecorder();

  const [answer, setAnswer] = useState('');
  const [existing, setExisting] = useState<SubmissionRow | null>(null);
  const [existingAudioUrl, setExistingAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('assignment_submissions')
      .select('answer_text, audio_path, status, feedback_text')
      .eq('lesson_id', lessonId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) {
      setExisting(data);
      setAnswer(data.answer_text ?? '');
      if (data.audio_path) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(data.audio_path, 3600);
        setExistingAudioUrl(signed?.signedUrl ?? null);
      }
    }
    setLoading(false);
  }, [user, lessonId]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      let audioPath = existing?.audio_path ?? null;
      if (recorder.blob) {
        audioPath = `${user.id}/${lessonId}.webm`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(audioPath, recorder.blob, { upsert: true, contentType: recorder.blob.type || 'audio/webm' });
        if (upErr) throw upErr;
      }
      // Resubmitting resets status to 'submitted' (guard trigger allows the owner to set it back).
      const { error } = await supabase.from('assignment_submissions').upsert(
        { lesson_id: lessonId, user_id: user.id, answer_text: answer, audio_path: audioPath, status: 'submitted' },
        { onConflict: 'lesson_id,user_id' },
      );
      if (error) throw error;
      recorder.reset();
      await load();
      onComplete?.();
      toast({ title: t('assignment.submitted') });
    } catch (e) {
      toast({ title: t('assignment.submitError'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }, [user, lessonId, answer, recorder, existing, load, onComplete, toast, t]);

  if (loading) return <Card className="p-6 animate-pulse h-40" />;

  const hasSubmitted = !!existing;
  const isReviewed = existing?.status === 'reviewed' && !!existing?.feedback_text;
  const canSubmit = !submitting && (answer.trim().length > 0 || !!recorder.blob || !!existing?.audio_path);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-primary" />
          {t('lessonForm.assignmentTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {prompt && (
          <div
            className="rich-content text-foreground"
            dir={language === 'he' ? 'rtl' : 'ltr'}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(prompt) }}
          />
        )}

        {isReviewed && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-bold text-foreground flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-primary" />
              {t('assignment.feedbackTitle')}
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{existing!.feedback_text}</p>
          </div>
        )}

        {hasSubmitted && !isReviewed && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary" />
            {t('assignment.awaitingReview')}
          </p>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('assignment.yourAnswer')}</label>
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t('assignment.answerPlaceholder')}
            rows={5}
            dir={language === 'he' ? 'rtl' : 'ltr'}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('assignment.optionalRecording')}</label>
          <div className="flex flex-wrap items-center gap-3">
            {recorder.status === 'idle' && (
              <Button type="button" variant="outline" onClick={() => void recorder.start()}>
                <Mic className="w-4 h-4 me-2" /> {t('assignment.record')}
              </Button>
            )}
            {recorder.status === 'recording' && (
              <Button type="button" variant="destructive" onClick={recorder.stop}>
                <Square className="w-4 h-4 me-2" /> {t('assignment.stop')}
              </Button>
            )}
            {recorder.status === 'recorded' && recorder.url && (
              <>
                <audio controls src={recorder.url} className="h-10" />
                <Button type="button" variant="ghost" onClick={recorder.reset}>
                  <RotateCcw className="w-4 h-4 me-2" /> {t('assignment.rerecord')}
                </Button>
              </>
            )}
            {recorder.status === 'idle' && existingAudioUrl && (
              <audio controls src={existingAudioUrl} className="h-10" />
            )}
          </div>
          {recorder.error && <p className="text-xs text-destructive">{t('assignment.micError')}</p>}
        </div>

        <Button className="font-bold" disabled={!canSubmit} onClick={() => void submit()}>
          {submitting ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Send className="w-4 h-4 me-2" />}
          {hasSubmitted ? t('assignment.resubmit') : t('assignment.submit')}
        </Button>
      </CardContent>
    </Card>
  );
}

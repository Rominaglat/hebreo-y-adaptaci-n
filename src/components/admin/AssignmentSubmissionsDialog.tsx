import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/components/ui/use-toast';

const BUCKET = 'assignment-audio';

interface StudentRef {
  id: string;
  full_name: string;
}

interface AssignmentSubmissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: StudentRef | null;
}

interface QAView { question: string; answer: string; audioUrl: string | null }

interface SubmissionView {
  id: string;
  lessonTitle: string;
  status: 'submitted' | 'reviewed';
  feedback_text: string | null;
  qa: QAView[];
}

export function AssignmentSubmissionsDialog({ open, onOpenChange, user }: AssignmentSubmissionsDialogProps) {
  const { user: authUser } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [rows, setRows] = useState<SubmissionView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('assignment_submissions')
      .select('id, answers, status, feedback_text, submitted_at, lessons(title, assignment_questions)')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false });

    const views: SubmissionView[] = [];
    for (const r of (data ?? []) as unknown[]) {
      const row = r as {
        id: string; status: 'submitted' | 'reviewed'; feedback_text: string | null;
        answers: unknown;
        lessons: { title: string; assignment_questions: unknown } | { title: string; assignment_questions: unknown }[] | null;
      };
      const lessonRel = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
      const questions = (Array.isArray(lessonRel?.assignment_questions) ? lessonRel!.assignment_questions : []) as { id: string; text: string }[];
      const answers = (Array.isArray(row.answers) ? row.answers : []) as { questionId: string; text: string; audioPath: string | null }[];
      const answerById = new Map(answers.map(a => [a.questionId, a]));

      const qa: QAView[] = [];
      for (const q of questions) {
        const a = answerById.get(q.id);
        let audioUrl: string | null = null;
        if (a?.audioPath) {
          const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(a.audioPath, 3600);
          audioUrl = signed?.signedUrl ?? null;
        }
        qa.push({ question: q.text, answer: a?.text ?? '—', audioUrl });
      }
      views.push({ id: row.id, lessonTitle: lessonRel?.title ?? '—', status: row.status, feedback_text: row.feedback_text, qa });
    }
    setRows(views);
    setDrafts(Object.fromEntries(views.map(v => [v.id, v.feedback_text ?? ''])));
    setLoading(false);
  }, [user]);

  useEffect(() => { if (open && user) void load(); }, [open, user, load]);

  const saveFeedback = useCallback(async (id: string) => {
    setSavingId(id);
    const { error } = await supabase.from('assignment_submissions').update({
      feedback_text: drafts[id] ?? '',
      feedback_by: authUser?.id ?? null,
      feedback_at: new Date().toISOString(),
      status: 'reviewed',
    }).eq('id', id);
    setSavingId(null);
    if (error) { toast({ title: error.message, variant: 'destructive' }); return; }
    toast({ title: t('assignment.admin.saved') });
    await load();
  }, [drafts, authUser, toast, t, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('assignment.admin.title')} — {user?.full_name}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('assignment.admin.none')}</p>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-border/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">{r.lessonTitle}</p>
                  <Badge variant={r.status === 'reviewed' ? 'secondary' : 'default'}>
                    {r.status === 'reviewed' ? t('assignment.admin.statusReviewed') : t('assignment.admin.statusSubmitted')}
                  </Badge>
                </div>

                {r.qa.map((qa, i) => (
                  <div key={i} className="rounded-md bg-muted/40 p-3 space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      <span className="text-primary">{t('assignment.question')} {i + 1}.</span> {qa.question}
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{qa.answer}</p>
                    {qa.audioUrl && <audio controls src={qa.audioUrl} className="h-9 w-full" />}
                  </div>
                ))}

                <div className="space-y-2 border-t border-border/60 pt-3">
                  <p className="text-xs font-medium text-muted-foreground">{t('assignment.admin.feedback')}</p>
                  <Textarea rows={3} value={drafts[r.id] ?? ''}
                    onChange={(e) => setDrafts(d => ({ ...d, [r.id]: e.target.value }))} />
                  <Button size="sm" disabled={savingId === r.id} onClick={() => void saveFeedback(r.id)}>
                    {savingId === r.id ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Save className="w-4 h-4 me-2" />}
                    {t('assignment.admin.saveFeedback')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

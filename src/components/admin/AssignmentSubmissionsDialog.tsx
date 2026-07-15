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

interface SubmissionView {
  id: string;
  lesson_id: string;
  lessonTitle: string;
  answer_text: string | null;
  audio_path: string | null;
  audioUrl: string | null;
  status: 'submitted' | 'reviewed';
  feedback_text: string | null;
  submitted_at: string;
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
      .select('id, lesson_id, answer_text, audio_path, status, feedback_text, submitted_at, lessons(title)')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false });

    const views: SubmissionView[] = [];
    for (const r of (data ?? []) as unknown[]) {
      const row = r as {
        id: string; lesson_id: string; answer_text: string | null; audio_path: string | null;
        status: 'submitted' | 'reviewed'; feedback_text: string | null; submitted_at: string;
        lessons: { title: string } | { title: string }[] | null;
      };
      const lessonsRel = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
      let audioUrl: string | null = null;
      if (row.audio_path) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(row.audio_path, 3600);
        audioUrl = signed?.signedUrl ?? null;
      }
      views.push({
        id: row.id, lesson_id: row.lesson_id, lessonTitle: lessonsRel?.title ?? '—',
        answer_text: row.answer_text, audio_path: row.audio_path, audioUrl,
        status: row.status, feedback_text: row.feedback_text, submitted_at: row.submitted_at,
      });
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
    if (error) {
      toast({ title: error.message, variant: 'destructive' });
      return;
    }
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

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{t('assignment.admin.answer')}</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{r.answer_text || '—'}</p>
                </div>

                {r.audioUrl && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t('assignment.admin.recording')}</p>
                    <audio controls src={r.audioUrl} className="h-10 w-full" />
                  </div>
                )}

                <div className="space-y-2">
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

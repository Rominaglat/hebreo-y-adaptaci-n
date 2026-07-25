import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, ClipboardCheck, Inbox, Loader2, Mic, RotateCcw, Save, Search, SendHorizonal, Square } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const BUCKET = 'assignment-audio';

type StatusFilter = 'pending' | 'reviewed' | 'all';

interface AnswerRow { questionId: string; text: string; audioPath: string | null }

interface SubmissionRow {
  id: string;
  user_id: string;
  lesson_id: string;
  answers: AnswerRow[];
  status: 'submitted' | 'reviewed';
  feedback_text: string | null;
  feedback_audio_path: string | null;
  submitted_at: string;
  lessonTitle: string;
  questions: { id: string; text: string }[];
  courseId: string | null;
  courseTitle: string | null;
}

interface StudentProfile { id: string; full_name: string; email: string; avatar_url: string | null }

const dateLocales = { he, en: enUS, es } as const;

export default function AdminSubmissions() {
  const { user: authUser } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();

  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, StudentProfile>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [lessonFilter, setLessonFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mobile: the list and the detail pane are the same screen; this flips it.
  const [mobileDetail, setMobileDetail] = useState(false);

  const [draft, setDraft] = useState('');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const recorder = useAudioRecorder();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('assignment_submissions')
      .select('id, user_id, lesson_id, answers, status, feedback_text, feedback_audio_path, submitted_at, lessons(id, title, assignment_questions, modules(course_id, courses(id, title)))')
      .order('submitted_at', { ascending: true });
    if (error) {
      toast({ title: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const parsed: SubmissionRow[] = (data ?? []).map((r) => {
      const row = r as unknown as {
        id: string; user_id: string; lesson_id: string; answers: unknown;
        status: 'submitted' | 'reviewed'; feedback_text: string | null;
        feedback_audio_path: string | null; submitted_at: string;
        lessons: {
          id: string; title: string; assignment_questions: unknown;
          modules: { course_id: string | null; courses: { id: string; title: string } | { id: string; title: string }[] | null } |
                   { course_id: string | null; courses: { id: string; title: string } | { id: string; title: string }[] | null }[] | null;
        } | null;
      };
      // RLS/deletes can legitimately leave embedded rows null — never assume they exist.
      const lesson = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
      const moduleRel = Array.isArray(lesson?.modules) ? lesson?.modules[0] : lesson?.modules;
      const course = Array.isArray(moduleRel?.courses) ? moduleRel?.courses[0] : moduleRel?.courses;
      return {
        id: row.id,
        user_id: row.user_id,
        lesson_id: row.lesson_id,
        answers: (Array.isArray(row.answers) ? row.answers : []) as AnswerRow[],
        status: row.status,
        feedback_text: row.feedback_text,
        feedback_audio_path: row.feedback_audio_path,
        submitted_at: row.submitted_at,
        lessonTitle: lesson?.title ?? '—',
        questions: (Array.isArray(lesson?.assignment_questions) ? lesson?.assignment_questions : []) as { id: string; text: string }[],
        courseId: course?.id ?? null,
        courseTitle: course?.title ?? null,
      };
    });
    setRows(parsed);

    const userIds = [...new Set(parsed.map((p) => p.user_id))];
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .in('id', userIds);
      setProfiles(Object.fromEntries(((profs ?? []) as StudentProfile[]).map((p) => [p.id, p])));
    } else {
      setProfiles({});
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (r.courseId && r.courseTitle) map.set(r.courseId, r.courseTitle); });
    return [...map.entries()].map(([id, title]) => ({ id, title }));
  }, [rows]);

  const lessons = useMemo(() => {
    const map = new Map<string, string>();
    rows
      .filter((r) => courseFilter === 'all' || r.courseId === courseFilter)
      .forEach((r) => map.set(r.lesson_id, r.lessonTitle));
    return [...map.entries()].map(([id, title]) => ({ id, title }));
  }, [rows, courseFilter]);

  const pendingTotal = useMemo(() => rows.filter((r) => r.status === 'submitted').length, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (statusFilter === 'pending' && r.status !== 'submitted') return false;
      if (statusFilter === 'reviewed' && r.status !== 'reviewed') return false;
      if (courseFilter !== 'all' && r.courseId !== courseFilter) return false;
      if (lessonFilter !== 'all' && r.lesson_id !== lessonFilter) return false;
      if (q) {
        const p = profiles[r.user_id];
        const hay = `${p?.full_name ?? ''} ${p?.email ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Pending queue: longest-waiting first. Reviewed/all: newest first.
    return statusFilter === 'pending'
      ? list
      : [...list].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }, [rows, profiles, statusFilter, courseFilter, lessonFilter, search]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  // Keep a sensible selection on desktop: if the current one fell out of the
  // filtered list (or nothing is selected yet), select the first visible row.
  useEffect(() => {
    if (loading) return;
    if (selectedId && filtered.some((r) => r.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
    setMobileDetail(false);
  }, [loading, filtered, selectedId]);

  // Selecting a submission resets the feedback form to that row's saved state.
  useEffect(() => {
    setDraft(selected?.feedback_text ?? '');
    recorder.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Signed URLs for the selected submission's audio (answers + existing voice
  // feedback) — one batched request, not a per-file loop.
  useEffect(() => {
    if (!selected) { setAudioUrls({}); return; }
    const paths = [
      ...selected.answers.map((a) => a.audioPath).filter((p): p is string => !!p),
      ...(selected.feedback_audio_path ? [selected.feedback_audio_path] : []),
    ];
    if (paths.length === 0) { setAudioUrls({}); return; }
    let cancelled = false;
    void supabase.storage.from(BUCKET).createSignedUrls(paths, 3600).then(({ data }) => {
      if (cancelled || !data) return;
      const urls: Record<string, string> = {};
      data.forEach((d) => { if (d.path && d.signedUrl && !d.error) urls[d.path] = d.signedUrl; });
      setAudioUrls(urls);
    });
    return () => { cancelled = true; };
  }, [selected]);

  const save = useCallback(async (goNext: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      let feedbackAudioPath = selected.feedback_audio_path;
      if (recorder.blob) {
        feedbackAudioPath = `${selected.user_id}/${selected.lesson_id}/feedback.webm`;
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(feedbackAudioPath, recorder.blob, { upsert: true, contentType: recorder.blob.type || 'audio/webm' });
        if (upErr) throw upErr;
      }

      const { error } = await supabase.from('assignment_submissions').update({
        feedback_text: draft,
        feedback_by: authUser?.id ?? null,
        feedback_at: new Date().toISOString(),
        feedback_audio_path: feedbackAudioPath,
        status: 'reviewed',
      }).eq('id', selected.id);
      if (error) throw error;

      // Email + in-portal announcement — best-effort, the save already stuck.
      const { error: notifyErr } = await supabase.functions.invoke('notify-assignment-feedback', { body: { submissionId: selected.id } });
      toast({ title: t('assignment.admin.saved'), description: notifyErr ? undefined : t('assignment.admin.notified') });

      // Decide where to go BEFORE the row leaves the pending filter.
      const remaining = filtered.filter((r) => r.id !== selected.id && r.status === 'submitted');
      const idx = filtered.findIndex((r) => r.id === selected.id);
      const next = filtered.slice(idx + 1).find((r) => r.status === 'submitted') ?? remaining[0] ?? null;

      setRows((prev) => prev.map((r) => r.id === selected.id
        ? { ...r, status: 'reviewed', feedback_text: draft, feedback_audio_path: feedbackAudioPath }
        : r));
      recorder.reset();
      window.dispatchEvent(new CustomEvent('submissions:changed'));

      if (goNext) {
        if (next) {
          setSelectedId(next.id);
        } else {
          toast({ title: t('submissions.queueDone') });
          setMobileDetail(false);
        }
      }
    } catch (e) {
      toast({ title: t('assignment.submitError'), description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [selected, recorder, draft, authUser, filtered, toast, t]);

  const initials = (name: string) => name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const student = (id: string) => profiles[id];
  const timeAgo = (iso: string) =>
    formatDistanceToNow(new Date(iso), { addSuffix: true, locale: dateLocales[language as keyof typeof dateLocales] ?? he });

  if (loading) {
    return <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-primary" /> {t('submissions.title')}
        </h2>
        {pendingTotal > 0 && (
          <Badge className="font-bold">{pendingTotal} {t('submissions.pendingCount')}</Badge>
        )}
        <div className="flex flex-wrap items-center gap-2 ms-auto">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('submissions.searchPlaceholder')} className="ps-9 w-44 sm:w-52" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">{t('submissions.filter.pending')}</SelectItem>
              <SelectItem value="reviewed">{t('submissions.filter.reviewed')}</SelectItem>
              <SelectItem value="all">{t('submissions.filter.all')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={courseFilter} onValueChange={(v) => { setCourseFilter(v); setLessonFilter('all'); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('submissions.filter.allCourses')}</SelectItem>
              {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={lessonFilter} onValueChange={setLessonFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('submissions.filter.allLessons')}</SelectItem>
              {lessons.map((l) => <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Split view */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] items-start">
        {/* List pane */}
        <Card className={cn('overflow-hidden', mobileDetail && 'hidden lg:block')}>
          {filtered.length === 0 ? (
            <div className="py-16 px-6 text-center text-sm text-muted-foreground space-y-2">
              <Inbox className="w-8 h-8 mx-auto opacity-50" />
              <p>{statusFilter === 'pending' ? t('submissions.emptyPending') : t('submissions.empty')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60 max-h-[70vh] overflow-y-auto">
              {filtered.map((r) => {
                const p = student(r.user_id);
                const isSel = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => { setSelectedId(r.id); setMobileDetail(true); }}
                      className={cn(
                        'w-full relative text-start px-4 py-3 flex items-center gap-3 transition-colors',
                        isSel ? 'bg-primary/10' : 'hover:bg-muted/50',
                      )}
                    >
                      {isSel && <span className="absolute inset-y-2 start-0 w-1 rounded-e-full bg-primary" />}
                      <Avatar className="w-9 h-9 flex-shrink-0">
                        <AvatarImage src={p?.avatar_url ?? undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {p?.full_name ? initials(p.full_name) : '?'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm truncate">{p?.full_name ?? t('submissions.unknownStudent')}</span>
                          <span className="text-[11px] text-muted-foreground flex-shrink-0">{timeAgo(r.submitted_at)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground truncate">{r.lessonTitle}</span>
                          <span className={cn(
                            'w-2 h-2 rounded-full flex-shrink-0',
                            r.status === 'submitted' ? 'bg-primary' : 'bg-muted-foreground/30',
                          )} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Detail pane */}
        <Card className={cn('p-5', !mobileDetail && 'hidden lg:block')}>
          {!selected ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t('submissions.selectPrompt')}</p>
          ) : (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" className="lg:hidden -ms-2" onClick={() => setMobileDetail(false)}>
                <ArrowRight className="w-4 h-4 me-2 ltr:rotate-180" /> {t('submissions.backToList')}
              </Button>

              {/* Student + assignment header */}
              <div className="flex items-center gap-3">
                <Avatar className="w-11 h-11">
                  <AvatarImage src={student(selected.user_id)?.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {student(selected.user_id)?.full_name ? initials(student(selected.user_id)!.full_name) : '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{student(selected.user_id)?.full_name ?? t('submissions.unknownStudent')}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {selected.lessonTitle}{selected.courseTitle ? ` · ${selected.courseTitle}` : ''} · {timeAgo(selected.submitted_at)}
                  </p>
                </div>
                <Badge variant={selected.status === 'reviewed' ? 'secondary' : 'default'}>
                  {selected.status === 'reviewed' ? t('assignment.admin.statusReviewed') : t('assignment.admin.statusSubmitted')}
                </Badge>
              </div>

              {/* Answers */}
              <div className="space-y-3">
                {selected.questions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('assignment.noQuestions')}</p>
                ) : selected.questions.map((q, i) => {
                  const a = selected.answers.find((x) => x.questionId === q.id);
                  return (
                    <div key={q.id} className="rounded-md bg-muted/40 p-3 space-y-2">
                      <p className="text-sm font-medium">
                        <span className="text-primary">{t('assignment.question')} {i + 1}.</span> {q.text}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{a?.text || '—'}</p>
                      {a?.audioPath && audioUrls[a.audioPath] && (
                        <audio controls src={audioUrls[a.audioPath]} className="h-9 w-full" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Feedback */}
              <div className="space-y-3 border-t border-border/60 pt-4">
                <p className="text-sm font-medium">{t('assignment.admin.feedback')}</p>
                <Textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{t('submissions.voiceFeedback')}</p>
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
                    {recorder.status === 'idle' && selected.feedback_audio_path && audioUrls[selected.feedback_audio_path] && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t('submissions.currentVoiceFeedback')}</span>
                        <audio controls src={audioUrls[selected.feedback_audio_path]} className="h-9" />
                      </div>
                    )}
                  </div>
                  {recorder.error && <p className="text-xs text-destructive">{t('assignment.micError')}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button className="font-bold" disabled={saving} onClick={() => void save(true)}>
                    {saving ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <SendHorizonal className="w-4 h-4 me-2 rtl:rotate-180" />}
                    {t('submissions.saveAndNext')}
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => void save(false)}>
                    <Save className="w-4 h-4 me-2" /> {t('assignment.admin.saveFeedback')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

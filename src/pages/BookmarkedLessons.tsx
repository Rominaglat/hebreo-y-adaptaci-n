import { useEffect, useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Play, CheckCircle, Clock, Download, ChevronDown, ChevronRight, ArrowRight, StickyNote, FileText, ClipboardList, FileInput, File, ExternalLink, Calendar, Star, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { he, enUS } from 'date-fns/locale';
import DOMPurify from 'dompurify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import ExamTaker from '@/components/ExamTaker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Lesson {
  id: string;
  title: string;
  video_url: string | null;
  content_text: string | null;
  resources_url: string | null;
  order_index: number;
  duration_minutes: number | null;
  is_completed: boolean;
  lesson_type: string;
  file_url: string | null;
  exam_id: string | null;
  embed_url: string | null;
  updated_at: string;
  created_at: string;
  course_id: string;
  course_title: string;
}

interface CourseGroup {
  course_id: string;
  course_title: string;
  lessons: Lesson[];
}

interface Note {
  id: string;
  note_text: string;
  video_timestamp: number | null;
  created_at: string;
}

export default function BookmarkedLessons() {
  const location = useLocation();
  const bookmarkType = location.pathname.includes('favorites') ? 'favorite' : 'watch_later';
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();

  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const pageTitle = bookmarkType === 'favorite'
    ? t('bookmarks.favoritesTitle')
    : t('bookmarks.watchLaterTitle');

  const allLessons = useMemo(() => courseGroups.flatMap(g => g.lessons), [courseGroups]);

  useEffect(() => {
    if (user) fetchBookmarkedLessons();
  }, [user, bookmarkType]);

  const fetchBookmarkedLessons = async () => {
    if (!user) return;
    try {
      // Get bookmarked lesson IDs
      const { data: bookmarks, error: bErr } = await supabase
        .from('lesson_bookmarks')
        .select('lesson_id')
        .eq('user_id', user.id)
        .eq('bookmark_type', bookmarkType);

      if (bErr) throw bErr;
      if (!bookmarks || bookmarks.length === 0) {
        setCourseGroups([]);
        setSelectedLesson(null);
        setLoading(false);
        return;
      }

      const lessonIds = bookmarks.map(b => b.lesson_id);

      // Fetch lesson data with module → course join
      const { data: lessonsData, error: lErr } = await supabase
        .from('lessons')
        .select('*, modules!inner(course_id, courses!inner(id, title))')
        .in('id', lessonIds);

      if (lErr) throw lErr;

      // Get completions
      const { data: completions } = await supabase
        .from('lesson_completions')
        .select('lesson_id')
        .eq('user_id', user.id);
      const completedIds = new Set(completions?.map(c => c.lesson_id) || []);

      // Group by course
      const groupMap = new Map<string, CourseGroup>();
      for (const l of (lessonsData || [])) {
        const mod = l.modules as any;
        const courseId = mod.course_id;
        const courseTitle = mod.courses?.title || '';

        if (!groupMap.has(courseId)) {
          groupMap.set(courseId, { course_id: courseId, course_title: courseTitle, lessons: [] });
        }
        groupMap.get(courseId)!.lessons.push({
          id: l.id,
          title: l.title,
          video_url: l.video_url,
          content_text: l.content_text,
          resources_url: l.resources_url,
          order_index: l.order_index,
          duration_minutes: l.duration_minutes,
          is_completed: completedIds.has(l.id),
          lesson_type: l.lesson_type,
          file_url: l.file_url,
          exam_id: l.exam_id,
          embed_url: l.embed_url,
          updated_at: l.updated_at,
          created_at: l.created_at,
          course_id: courseId,
          course_title: courseTitle,
        });
      }

      // Sort lessons within each group
      const groups = Array.from(groupMap.values());
      groups.forEach(g => g.lessons.sort((a, b) => a.order_index - b.order_index));

      setCourseGroups(groups);
      if (groups.length > 0) {
        setOpenGroups([groups[0].course_id]);
        if (!selectedLesson || !lessonIds.includes(selectedLesson.id)) {
          setSelectedLesson(groups[0].lessons[0] || null);
        }
      }
    } catch (error) {
      console.error('Error fetching bookmarked lessons:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotes = async (lessonId: string) => {
    if (!user) return;
    const { data } = await supabase
      .from('user_notes')
      .select('*')
      .eq('user_id', user.id)
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: false });
    setNotes(data || []);
  };

  useEffect(() => {
    if (selectedLesson) fetchNotes(selectedLesson.id);
  }, [selectedLesson]);

  const handleMarkComplete = async () => {
    if (!user || !selectedLesson) return;
    const wasCompleted = selectedLesson.is_completed;
    try {
      if (wasCompleted) {
        await supabase.from('lesson_completions').delete().eq('user_id', user.id).eq('lesson_id', selectedLesson.id);
      } else {
        await supabase.from('lesson_completions').insert({ user_id: user.id, lesson_id: selectedLesson.id });
      }
      // Update local state
      setCourseGroups(prev => prev.map(g => ({
        ...g,
        lessons: g.lessons.map(l => l.id === selectedLesson.id ? { ...l, is_completed: !wasCompleted } : l)
      })));
      setSelectedLesson(prev => prev ? { ...prev, is_completed: !wasCompleted } : null);
      toast({
        title: wasCompleted ? t('courseDetail.lessonUnmarked') : t('courseDetail.lessonCompleted'),
        description: wasCompleted ? t('courseDetail.lessonUnmarkedDesc') : t('courseDetail.lessonCompletedDesc')
      });
    } catch (error) {
      console.error('Error updating completion:', error);
    }
  };

  const handleAddNote = async () => {
    if (!user || !selectedLesson || !newNote.trim()) return;
    try {
      await supabase.from('user_notes').insert({
        user_id: user.id,
        lesson_id: selectedLesson.id,
        note_text: newNote.trim()
      });
      setNewNote('');
      fetchNotes(selectedLesson.id);
      toast({ title: t('courseDetail.noteSaved'), description: t('courseDetail.noteSavedDesc') });
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };

  const handleRemoveBookmark = async (lessonId: string) => {
    if (!user) return;
    try {
      await supabase
        .from('lesson_bookmarks')
        .delete()
        .eq('user_id', user.id)
        .eq('lesson_id', lessonId)
        .eq('bookmark_type', bookmarkType);

      // Remove from local state
      setCourseGroups(prev => {
        const updated = prev.map(g => ({
          ...g,
          lessons: g.lessons.filter(l => l.id !== lessonId)
        })).filter(g => g.lessons.length > 0);
        return updated;
      });

      if (selectedLesson?.id === lessonId) {
        const remaining = allLessons.filter(l => l.id !== lessonId);
        setSelectedLesson(remaining[0] || null);
      }
    } catch (error) {
      console.error('Error removing bookmark:', error);
    }
  };

  const toggleGroup = (courseId: string) => {
    setOpenGroups(prev => prev.includes(courseId) ? prev.filter(id => id !== courseId) : [...prev, courseId]);
  };

  const getYouTubeEmbedUrl = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? `https://www.youtube.com/embed/${match[2]}` : url;
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      
    );
  }

  if (allLessons.length === 0) {
    const emptyTitle = bookmarkType === 'favorite' ? t('bookmarks.noFavorites') : t('bookmarks.noWatchLater');
    const emptyDesc = bookmarkType === 'favorite' ? t('bookmarks.noFavoritesDesc') : t('bookmarks.noWatchLaterDesc');
    const EmptyIcon = bookmarkType === 'favorite' ? Star : Clock;
    return (
      
        <div className="space-y-6 animate-fade-in">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/courses"><ArrowRight className="w-5 h-5" /></Link>
            </Button>
            <h1 className="text-2xl font-bold">{pageTitle}</h1>
          </div>
          <Card>
            <CardContent className="py-12 text-center">
              <EmptyIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">{emptyTitle}</h3>
              <p className="text-muted-foreground">{emptyDesc}</p>
            </CardContent>
          </Card>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/courses"><ArrowRight className="w-5 h-5" /></Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{pageTitle}</h1>
            <p className="text-muted-foreground">
              {allLessons.length} {t('courseDetail.lessons')}
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {selectedLesson && (
              <>
                {/* Video Player */}
                {selectedLesson.lesson_type === 'video' && selectedLesson.video_url && (
                  <div className="aspect-video bg-secondary rounded-lg overflow-hidden">
                    <iframe src={getYouTubeEmbedUrl(selectedLesson.video_url)} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                  </div>
                )}

                {/* File Preview */}
                {selectedLesson.lesson_type === 'file' && selectedLesson.file_url && (
                  <Card>
                    <CardContent className="p-6">
                      <div className="space-y-4">
                        <iframe
                          key={`file-viewer-${selectedLesson.id}`}
                          src={`https://docs.google.com/viewer?url=${encodeURIComponent(selectedLesson.file_url)}&embedded=true&timestamp=${selectedLesson.id}`}
                          className="w-full h-[600px] rounded-lg border bg-white"
                          title={selectedLesson.title}
                        />
                        <div className="flex gap-2">
                          <Button variant="outline" asChild className="flex-1">
                            <a href={selectedLesson.file_url} target="_blank" rel="noopener noreferrer">
                              {t('courseDetail.openInNewTab')}
                            </a>
                          </Button>
                          <Button variant="outline" asChild className="flex-1">
                            <a href={selectedLesson.file_url} download>
                              <Download className="w-4 h-4 ml-2" />
                              {t('courseDetail.downloadFile')}
                            </a>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Exam */}
                {selectedLesson.lesson_type === 'exam' && selectedLesson.exam_id && (
                  <ExamTaker examId={selectedLesson.exam_id} onComplete={() => {
                    if (!selectedLesson.is_completed) handleMarkComplete();
                  }} />
                )}

                {/* Embed */}
                {selectedLesson.lesson_type === 'embed' && selectedLesson.embed_url && (
                  <Card>
                    <CardContent className="p-6">
                      <div className="space-y-4">
                        <iframe
                          src={selectedLesson.embed_url}
                          className="w-full min-h-[600px] rounded-lg border"
                          title={selectedLesson.title}
                          allow="camera; microphone; autoplay; encrypted-media"
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Last Updated Date */}
                {selectedLesson.updated_at && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>
                      {language === 'he' ? 'עודכן לאחרונה:' : 'Last updated:'}{' '}
                      {format(new Date(selectedLesson.updated_at), 'dd/MM/yyyy', { locale: language === 'he' ? he : enUS })}
                    </span>
                  </div>
                )}

                {/* Lesson Info - video with tabs */}
                {selectedLesson.lesson_type === 'video' && (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle>{selectedLesson.title}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-1">
                            {selectedLesson.course_title}
                          </p>
                          {selectedLesson.duration_minutes && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="w-3 h-3" />
                              {selectedLesson.duration_minutes} {t('common.min')}
                            </p>
                          )}
                        </div>
                        <Button variant={selectedLesson.is_completed ? "secondary" : "default"} onClick={handleMarkComplete}>
                          {selectedLesson.is_completed ? (
                            <>
                              <CheckCircle className="w-4 h-4 ml-2" />
                              {t('courseDetail.completed')}
                            </>
                          ) : t('courseDetail.markComplete')}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue="description" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="description">{t('courseDetail.description')}</TabsTrigger>
                          <TabsTrigger value="resources">{t('courseDetail.usefulResources')}</TabsTrigger>
                        </TabsList>
                        <TabsContent value="description" className="mt-4">
                          {selectedLesson.content_text ? (
                            <div className="rich-content text-muted-foreground" dir="rtl"
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedLesson.content_text) }} />
                          ) : (
                            <p className="text-sm text-muted-foreground">{t('courseDetail.noDescription')}</p>
                          )}
                        </TabsContent>
                        <TabsContent value="resources" className="mt-4">
                          {selectedLesson.resources_url ? (
                            <div className="space-y-3">
                              {(() => {
                                let resourceList: { name: string; url: string }[] = [];
                                try {
                                  const parsed = JSON.parse(selectedLesson.resources_url);
                                  if (Array.isArray(parsed)) resourceList = parsed;
                                } catch {
                                  resourceList = selectedLesson.resources_url.split(',').map((url, i) => ({
                                    name: decodeURIComponent(url.trim().split('/').pop() || `${t('courseDetail.resource')} ${i + 1}`),
                                    url: url.trim()
                                  })).filter(r => r.url);
                                }
                                return resourceList.map((resource, index) => (
                                  <div key={index} className="flex items-center gap-3 p-3 rounded-lg border bg-secondary/30 hover:bg-secondary/50 transition-colors">
                                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                      <File className="w-5 h-5 text-primary" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{resource.name}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button variant="ghost" size="icon" asChild>
                                        <a href={resource.url} target="_blank" rel="noopener noreferrer">
                                          <ExternalLink className="w-4 h-4" />
                                        </a>
                                      </Button>
                                      <Button variant="ghost" size="icon" asChild>
                                        <a href={`${resource.url}?download=`} download={resource.name}>
                                          <Download className="w-4 h-4" />
                                        </a>
                                      </Button>
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          ) : (
                            <div className="text-center py-8">
                              <File className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                              <p className="text-sm text-muted-foreground">{t('courseDetail.noResources')}</p>
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                )}

                {/* Lesson Info - non-video, non-exam */}
                {selectedLesson.lesson_type !== 'exam' && selectedLesson.lesson_type !== 'video' && (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle>{selectedLesson.title}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-1">
                            {selectedLesson.course_title}
                          </p>
                          {selectedLesson.duration_minutes && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="w-3 h-3" />
                              {selectedLesson.duration_minutes} {t('common.min')}
                            </p>
                          )}
                        </div>
                        <Button variant={selectedLesson.is_completed ? "secondary" : "default"} onClick={handleMarkComplete}>
                          {selectedLesson.is_completed ? (
                            <>
                              <CheckCircle className="w-4 h-4 ml-2" />
                              {t('courseDetail.completed')}
                            </>
                          ) : t('courseDetail.markComplete')}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {selectedLesson.content_text && (
                        <div className="rich-content text-muted-foreground" dir="rtl"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedLesson.content_text) }} />
                      )}
                      {selectedLesson.resources_url && (
                        <div className="mt-4 pt-4 border-t">
                          <Button variant="outline" asChild>
                            <a href={selectedLesson.resources_url} target="_blank" rel="noopener noreferrer">
                              <Download className="w-4 h-4 ml-2" />
                              {t('courseDetail.downloadResources')}
                            </a>
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4 order-first lg:order-last">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{pageTitle}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {allLessons.length} {t('courseDetail.lessons')}
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[250px] lg:max-h-[600px] overflow-y-auto">
                  {courseGroups.map(group => (
                    <Collapsible key={group.course_id} open={openGroups.includes(group.course_id)} onOpenChange={() => toggleGroup(group.course_id)}>
                      <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/50 border-b">
                        <span className="font-medium text-sm text-right">{group.course_title}</span>
                        {openGroups.includes(group.course_id) ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {group.lessons.map(lesson => {
                          const LessonIcon = lesson.is_completed ? CheckCircle :
                            lesson.lesson_type === 'file' ? FileText :
                            lesson.lesson_type === 'exam' ? ClipboardList :
                            lesson.lesson_type === 'embed' ? FileInput : Play;
                          return (
                            <div key={lesson.id} className={cn("w-full px-4 py-2.5 flex items-center gap-3 text-right text-sm hover:bg-secondary/50 transition-colors", selectedLesson?.id === lesson.id && "bg-secondary")}>
                              <button onClick={() => setSelectedLesson(lesson)} className="flex items-center gap-3 flex-1 min-w-0">
                                <LessonIcon className={cn("w-4 h-4 flex-shrink-0", lesson.is_completed ? "text-success" : "text-muted-foreground")} />
                                <span className="flex-1 truncate text-right">{lesson.title}</span>
                              </button>
                              <button
                                onClick={() => handleRemoveBookmark(lesson.id)}
                                className="flex-shrink-0 p-1 rounded hover:bg-destructive/10 transition-colors"
                                title={bookmarkType === 'favorite' ? t('courseDetail.removeFromFavorites') : t('courseDetail.removeFromWatchLater')}
                              >
                                {bookmarkType === 'favorite'
                                  ? <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                                  : <Clock className="w-3.5 h-3.5 text-blue-500 fill-blue-500" />
                                }
                              </button>
                            </div>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Notes Section */}
            {selectedLesson && (
              <Card className="hidden lg:block">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <StickyNote className="w-4 h-4" />
                    {t('courseDetail.myNotes')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Textarea placeholder={t('courseDetail.addNotePlaceholder')} value={newNote} onChange={e => setNewNote(e.target.value)} className="min-h-[80px]" />
                  </div>
                  <Button onClick={handleAddNote} disabled={!newNote.trim()}>
                    {t('courseDetail.saveNote')}
                  </Button>
                  {notes.length > 0 && (
                    <div className="space-y-3 pt-4 border-t max-h-[300px] overflow-y-auto">
                      {notes.map(note => (
                        <div key={note.id} className="p-3 bg-secondary/50 rounded-lg">
                          <p className="text-sm whitespace-pre-wrap">{note.note_text}</p>
                          <p className="text-xs text-muted-foreground mt-2">
                            {new Date(note.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
  );
}

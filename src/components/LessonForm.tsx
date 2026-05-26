import { useState, useRef, useEffect } from 'react';
import { Trash2, Upload, Video, File, ClipboardCheck, FileInput, X, ExternalLink, FolderOpen, ChevronDown, ChevronUp, ArrowRightLeft, Sparkles, Loader2, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import RichTextEditor from './RichTextEditor';
import { isVimeoUrl } from '@/lib/vimeoExtractor';

export interface ResourceItem {
  name: string;
  url: string;
}

export interface LessonFormData {
  title: string;
  lesson_type: 'video' | 'file' | 'exam' | 'embed';
  video_url: string;
  file_url: string;
  exam_id: string;
  content_text: string;
  embed_url: string;
  resources_url: string;
  is_hidden: boolean;
}

interface Exam {
  id: string;
  title: string;
}

interface ModuleOption {
  index: number;
  title: string;
}

interface LessonFormProps {
  lesson: LessonFormData;
  lessonIndex: number;
  moduleIndex: number;
  canRemove: boolean;
  courseId?: string;
  onUpdate: (moduleIndex: number, lessonIndex: number, field: string, value: any) => void;
  onRemove: (moduleIndex: number, lessonIndex: number) => void;
  onMoveToModule?: (fromModule: number, lessonIndex: number, toModule: number) => void;
  availableModules?: ModuleOption[];
  defaultExpanded?: boolean;
}

// Helper function to sanitize file names for Supabase storage
function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[^\x00-\x7F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
  
  return sanitized || 'file';
}

const lessonTypeIcons: Record<string, React.ReactNode> = {
  video: <Video className="w-4 h-4" />,
  file: <File className="w-4 h-4" />,
  exam: <ClipboardCheck className="w-4 h-4" />,
  embed: <FileInput className="w-4 h-4" />,
};

const lessonTypeKeys: Record<string, string> = {
  video: 'createCourse.lessonTypeVideo',
  file: 'createCourse.lessonTypeFile',
  exam: 'createCourse.lessonTypeExam',
  embed: 'lessonForm.embedSite',
};

export default function LessonForm({
  lesson,
  lessonIndex,
  moduleIndex,
  canRemove,
  courseId,
  onUpdate,
  onRemove,
  onMoveToModule,
  availableModules,
  defaultExpanded = false,
}: LessonFormProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [uploading, setUploading] = useState(false);
  const [uploadingResource, setUploadingResource] = useState(false);
  const [exams, setExams] = useState<Exam[]>([]);
  const [pendingResourceName, setPendingResourceName] = useState('');
  const [summaryLang, setSummaryLang] = useState<'he' | 'en' | 'es'>('he');
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState('');
  const cancelSummaryRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resourceInputRef = useRef<HTMLInputElement>(null);

  const getFileName = (url: string) => {
    try {
      const decoded = decodeURIComponent(url.split('/').pop() || '');
      return decoded.replace(/^\d+_/, '');
    } catch {
      return url.split('/').pop() || t('lessonForm.resource');
    }
  };

  const parseResources = (): ResourceItem[] => {
    if (!lesson.resources_url) return [];
    try {
      const parsed = JSON.parse(lesson.resources_url);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return lesson.resources_url.split(',').map(url => ({
        name: getFileName(url.trim()),
        url: url.trim()
      })).filter(r => r.url);
    }
    return [];
  };
  
  const resources = parseResources();

  useEffect(() => {
    if (courseId) {
      fetchExams();
    }
  }, [courseId]);

  const fetchExams = async () => {
    if (!courseId) return;
    const { data } = await supabase
      .from('exams')
      .select('id, title')
      .eq('course_id', courseId)
      .order('order_index');
    
    if (data) {
      setExams(data);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop() || '';
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const sanitizedName = sanitizeFileName(baseName);
      const fileName = `lessons/${user.id}/${Date.now()}_${sanitizedName}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('course-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('course-images')
        .getPublicUrl(fileName);

      onUpdate(moduleIndex, lessonIndex, 'file_url', publicUrl);
      toast.success(t('common.success'));
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleResourceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingResource(true);
    try {
      const fileExt = file.name.split('.').pop() || '';
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const sanitizedName = sanitizeFileName(baseName);
      const fileName = `resources/${user.id}/${Date.now()}_${sanitizedName}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('course-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('course-images')
        .getPublicUrl(fileName);

      const resourceName = pendingResourceName.trim() || baseName;
      const newResource: ResourceItem = { name: resourceName, url: publicUrl };
      const updatedResources = [...resources, newResource];
      onUpdate(moduleIndex, lessonIndex, 'resources_url', JSON.stringify(updatedResources));
      setPendingResourceName('');
      toast.success(t('common.success'));
    } catch (error: any) {
      console.error('Error uploading resources:', error);
      toast.error(error.message);
    } finally {
      setUploadingResource(false);
      if (resourceInputRef.current) {
        resourceInputRef.current.value = '';
      }
    }
  };

  const removeResource = (indexToRemove: number) => {
    const updatedResources = resources.filter((_, index) => index !== indexToRemove);
    onUpdate(moduleIndex, lessonIndex, 'resources_url', JSON.stringify(updatedResources));
  };

  const handleGenerateSummary = async () => {
    if (!lesson.video_url || generatingSummary) return;
    
    setGeneratingSummary(true);
    cancelSummaryRef.current = false;
    try {
      console.log("=== CLIENT: GENERATE SUMMARY START ===");
      console.log("📥 Video URL:", lesson.video_url);
      console.log("🌐 Language:", summaryLang);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log("❌ No session");
        toast.error(t('auth.loginRequired'));
        return;
      }
      console.log("✅ Session active, user:", session.user.id);

      const transcribeServiceUrl = import.meta.env.VITE_TRANSCRIBE_SERVICE_URL;
      if (!transcribeServiceUrl) {
        toast.error('VITE_TRANSCRIBE_SERVICE_URL is not configured');
        return;
      }

      // Step 1: Submit job
      setSummaryProgress(t('lessonForm.progressStarting'));
      toast.info(t('lessonForm.transcribing'));

      const submitResp = await fetch(`${transcribeServiceUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          video_url: lesson.video_url,
          language: summaryLang,
          referer_url: 'https://example.com/',
        }),
      });

      if (!submitResp.ok) {
        const errData = await submitResp.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${submitResp.status}`);
      }

      const { job_id } = await submitResp.json();
      console.log("Job started:", job_id);

      // Step 2: Poll for status
      const progressLabels: Record<string, string> = {
        queued: t('lessonForm.progressQueued'),
        downloading: t('lessonForm.progressDownloading'),
        uploading: t('lessonForm.progressUploading'),
        transcribing: t('lessonForm.progressTranscribing'),
        saving: t('lessonForm.progressSaving'),
        summarizing: t('lessonForm.progressSummarizing'),
        done: t('lessonForm.progressDone'),
      };

      let data: any = null;
      while (true) {
        await new Promise(r => setTimeout(r, 3000));
        if (cancelSummaryRef.current) {
          toast.info(t('lessonForm.cancelled'));
          return;
        }
        const pollResp = await fetch(`${transcribeServiceUrl}/status/${job_id}`);
        data = await pollResp.json();

        setSummaryProgress(progressLabels[data.progress] || data.progress);

        if (data.status === 'completed') break;
        if (data.status === 'error') throw new Error(data.error || 'Transcription failed');
      }

      console.log("Job completed:", job_id);
      console.log("Summary length:", data.summary?.length, "Transcript length:", data.transcript_text?.length);
      console.log("Summary preview:", data.summary?.substring(0, 100));

      // Download transcript as a file to the browser
      if (data.transcript_text) {
        const blob = new Blob([data.transcript_text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${lesson.title || 'transcript'}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      // Set summary as content_text (if summary was generated)
      if (data.summary) {
        // Strip markdown code fences (```html ... ```) that GPT sometimes wraps around HTML
        let cleanSummary = data.summary.replace(/^```html?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
        onUpdate(moduleIndex, lessonIndex, 'content_text', cleanSummary);
      }

      // Add transcript file as resource
      if (data.transcript_file_url) {
        const transcriptResource: ResourceItem = {
          name: summaryLang === 'he' ? t('lessonForm.transcript') : 'Transcript',
          url: data.transcript_file_url,
        };
        const updatedResources = [...resources, transcriptResource];
        onUpdate(moduleIndex, lessonIndex, 'resources_url', JSON.stringify(updatedResources));
      }

      console.log("=== CLIENT: GENERATE SUMMARY COMPLETE ===");
      toast.success(t('lessonForm.summaryReady'));
    } catch (error: any) {
      console.error('❌ Summary generation error:', error);
      console.error('❌ Error stack:', error.stack);
      toast.error(t('lessonForm.summaryError') + ': ' + (error.message || ''));
    } finally {
      setGeneratingSummary(false);
      setSummaryProgress('');
    }
  };

  // Other modules to move to
  const otherModules = availableModules?.filter(m => m.index !== moduleIndex) || [];

  return (
    <div className="bg-muted/50 rounded-lg p-3 space-y-0">
      {/* Compact header - always visible */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center gap-2 text-start hover:bg-muted/80 rounded px-1 py-1 transition-colors min-w-0"
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {lessonIndex + 1}.
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground flex-shrink-0">
            {lessonTypeIcons[lesson.lesson_type]}
          </span>
          <span className="text-sm truncate">
            {lesson.title || <span className="text-muted-foreground italic">{t('createCourse.lessonName')}</span>}
          </span>
          {lesson.is_hidden && (
            <span className="flex items-center gap-1 text-xs text-amber-500 flex-shrink-0" title={t('lessonForm.hiddenFromStudents')}>
              <EyeOff className="w-3.5 h-3.5" />
            </span>
          )}
        </button>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Move to module button */}
          {onMoveToModule && otherModules.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={t('lessonForm.moveToModule')}>
                  <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover">
                {otherModules.map((mod) => (
                  <DropdownMenuItem
                    key={mod.index}
                    onClick={() => onMoveToModule(moduleIndex, lessonIndex, mod.index)}
                  >
                    {mod.title || `${t('createCourse.module')} ${mod.index + 1}`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onRemove(moduleIndex, lessonIndex)}
            disabled={!canRemove}
          >
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="space-y-3 pt-3 border-t mt-2">

          <div className="flex items-center gap-2 mb-3">
            <Switch
              id={`hidden-${moduleIndex}-${lessonIndex}`}
              checked={lesson.is_hidden}
              onCheckedChange={(checked) => onUpdate(moduleIndex, lessonIndex, 'is_hidden', checked)}
            />
            <Label htmlFor={`hidden-${moduleIndex}-${lessonIndex}`} className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
              <EyeOff className="w-3.5 h-3.5" />
              {t('lessonForm.hideFromStudents')}
            </Label>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              value={lesson.title}
              onChange={(e) => onUpdate(moduleIndex, lessonIndex, 'title', e.target.value)}
              placeholder={t('createCourse.lessonName')}
            />
            <Select
              value={lesson.lesson_type}
              onValueChange={(value) => onUpdate(moduleIndex, lessonIndex, 'lesson_type', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4" />
                    {t('createCourse.lessonTypeVideo')}
                  </div>
                </SelectItem>
                <SelectItem value="file">
                  <div className="flex items-center gap-2">
                    <File className="w-4 h-4" />
                    {t('createCourse.lessonTypeFile')}
                  </div>
                </SelectItem>
                <SelectItem value="exam">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4" />
                    {t('createCourse.lessonTypeExam')}
                  </div>
                </SelectItem>
                <SelectItem value="embed">
                  <div className="flex items-center gap-2">
                    <FileInput className="w-4 h-4" />
                    {t('lessonForm.embedSite')}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Content based on lesson type */}
          {lesson.lesson_type === 'video' && (
            <div className="space-y-3">
              <Input
                value={lesson.video_url}
                onChange={(e) => onUpdate(moduleIndex, lessonIndex, 'video_url', e.target.value)}
                placeholder={t('createCourse.videoUrl')}
              />
              {lesson.video_url && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={summaryLang} onValueChange={(v: 'he' | 'en' | 'es') => setSummaryLang(v)}>
                    <SelectTrigger className="w-[120px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="he">{t('lessonForm.hebrew')}</SelectItem>
                      <SelectItem value="en">{t('lessonForm.english')}</SelectItem>
                      <SelectItem value="es">{t('lessonForm.spanish')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateSummary}
                    disabled={generatingSummary}
                    className="gap-1.5"
                  >
                    {generatingSummary ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span className="text-xs">{summaryProgress}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        {t('lessonForm.generateSummary')}
                      </>
                    )}
                  </Button>
                  {generatingSummary && (
                    <button
                      type="button"
                      onClick={() => { cancelSummaryRef.current = true; }}
                      className="p-1 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title={t('common.cancel')}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {lesson.lesson_type === 'file' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="w-4 h-4 ml-1" />
                  {uploading ? t('createCourse.uploading') : t('createCourse.uploadFile')}
                </Button>
                {lesson.file_url && (
                  <a 
                    href={lesson.file_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate max-w-[200px]"
                  >
                    {t('createCourse.viewFile')}
                  </a>
                )}
              </div>
              <Input
                value={lesson.file_url}
                onChange={(e) => onUpdate(moduleIndex, lessonIndex, 'file_url', e.target.value)}
                placeholder={t('createCourse.fileUrlPlaceholder')}
              />
            </div>
          )}

          {lesson.lesson_type === 'exam' && (
            <div className="space-y-2">
              {exams.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('createCourse.noExamsAvailable')}</p>
              ) : (
                <Select
                  value={lesson.exam_id}
                  onValueChange={(value) => onUpdate(moduleIndex, lessonIndex, 'exam_id', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('createCourse.selectExam')} />
                  </SelectTrigger>
                  <SelectContent>
                    {exams.map((exam) => (
                      <SelectItem key={exam.id} value={exam.id}>
                        {exam.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {lesson.lesson_type === 'embed' && (
            <div className="space-y-2">
              <Input
                value={lesson.embed_url || ''}
                onChange={(e) => onUpdate(moduleIndex, lessonIndex, 'embed_url', e.target.value)}
                placeholder={t('lessonForm.embedUrlPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('lessonForm.embedUrlHint')}
              </p>
            </div>
          )}

          {/* Lesson Description - Rich Text Editor */}
          <div className="space-y-2">
            <Label className="text-xs">{t('lessonForm.lessonDescription')}</Label>
            <RichTextEditor
              value={lesson.content_text}
              onChange={(value) => onUpdate(moduleIndex, lessonIndex, 'content_text', value)}
              placeholder={t('lessonForm.lessonDescriptionPlaceholder')}
            />
          </div>

          {/* Resources Section - Only for video lessons */}
          {lesson.lesson_type === 'video' && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-xs flex items-center gap-1">
                <FolderOpen className="w-3 h-3" />
                {t('lessonForm.usefulResources')}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={pendingResourceName}
                  onChange={(e) => setPendingResourceName(e.target.value)}
                  placeholder={t('lessonForm.resourceName')}
                  className="flex-1"
                />
                <input
                  type="file"
                  ref={resourceInputRef}
                  onChange={handleResourceUpload}
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.json,.csv,.xml,.yaml,.yml,.md,.html,.css,.js,.ts"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => resourceInputRef.current?.click()}
                  disabled={uploadingResource}
                >
                  <Upload className="w-3 h-3 ml-1" />
                  {uploadingResource ? t('createCourse.uploading') : t('lessonForm.uploadResources')}
                </Button>
              </div>
              
              {resources.length > 0 && (
                <div className="space-y-2">
                  {resources.map((resource, index) => (
                    <div 
                      key={index} 
                      className="flex items-center gap-2 p-2 rounded-md bg-background border text-sm"
                    >
                      <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 truncate">{resource.name}</span>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" asChild>
                          <a href={resource.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => removeResource(index)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {resources.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('lessonForm.noResourcesYet')}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const createEmptyLesson = (): LessonFormData => ({
  title: '',
  lesson_type: 'video',
  video_url: '',
  file_url: '',
  exam_id: '',
  content_text: '',
  embed_url: '',
  resources_url: '',
  is_hidden: false,
});

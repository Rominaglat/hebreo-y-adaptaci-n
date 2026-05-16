import { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Upload, FileText, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SecurityScanBadge } from '@/components/skills/SecurityScanBadge';
import { useSubmitSkill, SKILL_CATEGORIES } from '@/hooks/useSkills';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { SKILL_ICON_OPTIONS, SkillIcon } from '@/components/skills/SkillIcon';

const MAX_FILE_SIZE = 500 * 1024; // 500KB

export default function SkillSubmit() {
  const { t, language, isRTL } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const submitMutation = useSubmitSkill();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [tagsInput, setTagsInput] = useState('');
  const [triggerPattern, setTriggerPattern] = useState('');
  const [iconName, setIconName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);

  const handleFileRead = (file: File) => {
    if (!file.name.endsWith('.md')) {
      toast({ variant: 'destructive', title: language === 'he' ? 'רק קבצי .md' : 'Only .md files allowed' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      setFileName(file.name);

      // Try to extract name from frontmatter
      const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+)/m);
      if (nameMatch && !name) setName(nameMatch[1].trim());

      const descMatch = content.match(/^---[\s\S]*?description:\s*(.+)/m);
      if (descMatch && !description) setDescription(descMatch[1].trim());
    };
    reader.readAsText(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileRead(file);
  }, [name, description]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileRead(file);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !fileContent.trim()) {
      toast({ variant: 'destructive', title: language === 'he' ? 'שם ותוכן נדרשים' : 'Name and content are required' });
      return;
    }

    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

    if (fileContent.length > MAX_FILE_SIZE) {
      toast({ variant: 'destructive', title: language === 'he' ? 'הקובץ גדול מדי (מקסימום 500KB)' : 'File too large (max 500KB)' });
      return;
    }

    submitMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        long_description: longDescription.trim() || undefined,
        category,
        tags,
        trigger_pattern: triggerPattern.trim() || undefined,
        icon_name: iconName || undefined,
        file_content: fileContent,
      },
      {
        onSuccess: (data) => {
          setSubmitResult(data);
          toast({ title: t('skills.submitted') });
        },
      }
    );
  };

  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  // Show result after submission
  if (submitResult) {
    return (
        <div className="container py-6 max-w-2xl mx-auto">
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <Sparkles className="w-12 h-12 mx-auto text-primary" />
              <h2 className="text-xl font-bold">{t('skills.submitted')}</h2>
              <div className="flex justify-center">
                <SecurityScanBadge
                  status={submitResult.status}
                  scanResult={submitResult.scan_result}
                />
              </div>
              {submitResult.status === 'approved' && (
                <p className="text-green-600 dark:text-green-400">
                  {language === 'he' ? 'הסקיל אושר אוטומטית ופורסם!' : 'Skill was auto-approved and published!'}
                </p>
              )}
              {submitResult.status === 'submitted' && (
                <p className="text-yellow-600 dark:text-yellow-400">
                  {language === 'he' ? 'הסקיל ממתין לאישור ידני של מנהל.' : 'Skill is pending manual admin review.'}
                </p>
              )}
              {submitResult.status === 'rejected' && (
                <p className="text-red-600 dark:text-red-400">
                  {language === 'he' ? 'הסקיל נדחה עקב ממצאי אבטחה.' : 'Skill was rejected due to security findings.'}
                </p>
              )}
              <div className="flex gap-2 justify-center pt-2">
                <Button variant="outline" onClick={() => navigate('/skills')}>
                  {t('skills.title')}
                </Button>
                {submitResult.skill_id && (
                  <Button onClick={() => navigate(`/skills/${submitResult.skill_id}`)}>
                    {language === 'he' ? 'צפה בסקיל' : 'View Skill'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      
    );
  }

  return (
      <div className="container py-6 max-w-2xl mx-auto">
        {/* Back link */}
        <Link to="/skills" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <BackArrow className="w-4 h-4" />
          {t('skills.title')}
        </Link>

        <h1 className="text-2xl font-bold mb-6">{t('skills.submitNew')}</h1>

        <div className="space-y-6">
          {/* File Upload */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('skills.uploadOrPaste')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Drag & drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                {fileName ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium">{fileName}</span>
                    <Button variant="ghost" size="sm" onClick={() => { setFileName(''); setFileContent(''); }}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-2">{t('skills.dragDrop')}</p>
                    <label>
                      <input type="file" accept=".md" className="hidden" onChange={handleFileInput} />
                      <Button variant="outline" size="sm" asChild>
                        <span>{t('skills.uploadFile')}</span>
                      </Button>
                    </label>
                  </>
                )}
              </div>

              {/* Or paste content */}
              <div>
                <Label className="text-sm">{t('skills.fileContent')}</Label>
                <Textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  rows={10}
                  className="font-mono text-sm mt-1"
                  placeholder="---\nname: My Skill\ndescription: A helpful skill\n---\n\nSkill instructions here..."
                  dir="ltr"
                />
                {fileContent.length > 0 && (
                  <div className={`text-xs mt-1 ${fileContent.length > MAX_FILE_SIZE ? 'text-red-600' : fileContent.length > MAX_FILE_SIZE * 0.8 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {(fileContent.length / 1024).toFixed(1)} KB / 500 KB
                    {fileContent.length > MAX_FILE_SIZE && (
                      <span className="ms-2 font-semibold">
                        {language === 'he' ? '— הקובץ גדול מדי' : '— file too large'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{language === 'he' ? 'פרטי הסקיל' : 'Skill Details'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t('skills.name')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>

              <div>
                <Label>{t('skills.description')}</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
              </div>

              <div>
                <Label>{t('skills.longDescription')}</Label>
                <Textarea
                  value={longDescription}
                  onChange={(e) => setLongDescription(e.target.value)}
                  rows={3}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>{t('skills.category')}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SKILL_CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>
                        {t(`skills.categories.${cat}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t('skills.tags')}</Label>
                <Input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder={language === 'he' ? 'תגיות מופרדות בפסיקים' : 'Comma-separated tags'}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>{t('skills.triggerPattern')}</Label>
                <Input
                  value={triggerPattern}
                  onChange={(e) => setTriggerPattern(e.target.value)}
                  placeholder={language === 'he' ? 'מתי הסקיל מופעל אוטומטית' : 'When the skill auto-activates'}
                  className="mt-1"
                  dir="ltr"
                />
              </div>

              <div>
                <Label>{t('skills.icon')}</Label>
                <div className="grid grid-cols-8 sm:grid-cols-10 gap-2 mt-1">
                  {SKILL_ICON_OPTIONS.map(name => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setIconName(name === iconName ? '' : name)}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center border-2 transition-all hover:bg-primary/10 ${
                        iconName === name ? 'border-primary bg-primary/10' : 'border-border/40'
                      }`}
                      title={name}
                    >
                      <SkillIcon iconName={name} className="w-5 h-5 text-primary" />
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending || !name.trim() || !fileContent.trim()}
            className="w-full gap-2"
            size="lg"
          >
            {submitMutation.isPending ? (
              <>{t('skills.submitting')}</>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t('skills.submit')}
              </>
            )}
          </Button>
        </div>
      </div>
  );
}

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Download, Star, Clock, Tag, AlertTriangle, Pencil } from 'lucide-react';
import { SkillIcon } from '@/components/skills/SkillIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { SkillRating } from '@/components/skills/SkillRating';
import { SecurityScanBadge } from '@/components/skills/SecurityScanBadge';
import { SkillContentPreview } from '@/components/skills/SkillContentPreview';
import {
  useSkillDetail,
  useSkillVersions,
  useSkillRatings,
  useUserSkillRating,
  useDownloadSkill,
  useRateSkill,
} from '@/hooks/useSkills';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { SkillEditDialog } from '@/components/skills/SkillEditDialog';

export default function SkillDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: skill, isLoading } = useSkillDetail(id);
  const { data: versions = [] } = useSkillVersions(id);
  const { data: ratings = [] } = useSkillRatings(id);
  const { data: myRating } = useUserSkillRating(id);
  const downloadMutation = useDownloadSkill();
  const rateMutation = useRateSkill();

  const [reviewText, setReviewText] = useState('');
  const [selectedRating, setSelectedRating] = useState(0);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const isOwner = !!user && skill?.author_id === user.id;

  const handleDownload = () => {
    if (!skill) return;
    downloadMutation.mutate(
      { skill_id: skill.id, skill_name: skill.name },
      {
        onSuccess: () => {
          toast({ title: language === 'he' ? 'הקובץ הורד בהצלחה' : 'File downloaded successfully' });
        },
      }
    );
  };

  const handleRate = () => {
    if (!skill || selectedRating === 0) return;
    rateMutation.mutate(
      { skill_id: skill.id, rating: selectedRating, review_text: reviewText || undefined },
      {
        onSuccess: () => {
          toast({ title: language === 'he' ? 'הדירוג נשמר' : 'Rating saved' });
          setReviewText('');
        },
      }
    );
  };

  const currentVersion = versions.find(v => v.id === skill?.current_version_id);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;

  if (isLoading) {
    return (
        <div className="container py-6 max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      
    );
  }

  if (!skill) {
    return (
        <div className="container py-6 max-w-4xl mx-auto text-center">
          <p className="text-muted-foreground">{t('skills.noResults')}</p>
        </div>
      
    );
  }

  return (
      <div className="container py-6 max-w-4xl mx-auto">
        {/* Back link */}
        <Link to="/skills" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <BackArrow className="w-4 h-4" />
          {t('skills.title')}
        </Link>

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <SkillIcon iconName={skill.icon_name} category={skill.category} className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{skill.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline">{t(`skills.categories.${skill.category}`)}</Badge>
                {skill.is_featured && (
                  <Badge className="bg-amber-500 text-white">{t('skills.featured')}</Badge>
                )}
                {currentVersion && (
                  <SecurityScanBadge
                    status={currentVersion.status}
                    scanResult={currentVersion.scan_result}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOwner && (
              <Button variant="outline" onClick={() => setShowEditDialog(true)} className="gap-2">
                <Pencil className="w-4 h-4" />
                {t('skills.edit')}
              </Button>
            )}
            {skill.status === 'approved' && (
              <Button onClick={handleDownload} disabled={downloadMutation.isPending} className="gap-2">
                <Download className="w-4 h-4" />
                {t('skills.download')}
              </Button>
            )}
          </div>
        </div>

        {/* Owner-visible status / rejection notice */}
        {isOwner && skill.status === 'rejected' && currentVersion?.review_notes && (
          <Card className="mb-6 border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4" />
                {t('skills.rejectionReason')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-red-900 dark:text-red-200">{currentVersion.review_notes}</p>
            </CardContent>
          </Card>
        )}

        {isOwner && skill.status === 'rejected' && !currentVersion && versions[0]?.review_notes && (
          <Card className="mb-6 border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4" />
                {t('skills.rejectionReason')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-red-900 dark:text-red-200">{versions[0].review_notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-6 text-sm text-muted-foreground mb-6">
          <span className="flex items-center gap-1">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            {Number(skill.avg_rating).toFixed(1)} ({skill.rating_count} {t('skills.reviews')})
          </span>
          <span className="flex items-center gap-1">
            <Download className="w-4 h-4" />
            {skill.download_count} {t('skills.downloads')}
          </span>
          {currentVersion && (
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {t('skills.version')} {currentVersion.version}
            </span>
          )}
        </div>

        {/* Description */}
        {skill.description && (
          <p className="text-muted-foreground mb-6">{skill.description}</p>
        )}

        {skill.long_description && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <p className="whitespace-pre-wrap">{skill.long_description}</p>
            </CardContent>
          </Card>
        )}

        {/* Tags */}
        {skill.tags && skill.tags.length > 0 && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <Tag className="w-4 h-4 text-muted-foreground" />
            {skill.tags.map(tag => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </div>
        )}

        {/* Trigger pattern */}
        {skill.trigger_pattern && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('skills.triggerPattern')}</CardTitle>
            </CardHeader>
            <CardContent>
              <code className="text-sm bg-muted px-2 py-1 rounded">{skill.trigger_pattern}</code>
            </CardContent>
          </Card>
        )}

        {/* Content Preview */}
        {currentVersion?.content_preview && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('skills.contentPreview')}</CardTitle>
            </CardHeader>
            <CardContent>
              <SkillContentPreview content={currentVersion.content_preview} maxHeight="300px" />
            </CardContent>
          </Card>
        )}

        <Separator className="my-6" />

        {/* Rating Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{t('skills.rateSkill')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <SkillRating
                value={selectedRating || myRating?.rating || 0}
                onChange={setSelectedRating}
                size="lg"
              />
              {selectedRating > 0 && (
                <span className="text-sm text-muted-foreground">{selectedRating}/5</span>
              )}
            </div>
            <Textarea
              placeholder={t('skills.writeReview')}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              rows={3}
            />
            <Button
              onClick={handleRate}
              disabled={selectedRating === 0 || rateMutation.isPending}
              size="sm"
            >
              {t('skills.submitReview')}
            </Button>
          </CardContent>
        </Card>

        {/* Reviews */}
        {ratings.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">{t('skills.reviews')} ({ratings.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ratings.map((rating) => (
                <div key={rating.id} className="border-b last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <SkillRating value={rating.rating} readonly size="sm" />
                    <span className="text-xs text-muted-foreground">
                      {new Date(rating.created_at).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US')}
                    </span>
                  </div>
                  {rating.review_text && (
                    <p className="text-sm text-muted-foreground">{rating.review_text}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Edit dialog */}
        {isOwner && (
          <SkillEditDialog
            skill={skill}
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
          />
        )}

        {/* Version History */}
        {versions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('skills.versions')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">v{v.version}</Badge>
                      <SecurityScanBadge status={v.status} scanResult={v.scan_result} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US')}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
  );
}

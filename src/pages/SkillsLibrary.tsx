import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Sparkles, SlidersHorizontal, ShieldCheck, ShieldX, Star, Trash2, Eye, RefreshCw, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { SkillCard } from '@/components/skills/SkillCard';
import { SecurityScanBadge } from '@/components/skills/SecurityScanBadge';
import { SkillContentPreview } from '@/components/skills/SkillContentPreview';
import { useSkills, useMySkills, useAdminSkillAction, useFetchVersionContent, SKILL_CATEGORIES } from '@/hooks/useSkills';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { SkillSortBy } from '@/hooks/useSkills';

interface AdminSkill {
  id: string;
  name: string;
  description: string | null;
  category: string;
  status: string;
  is_featured: boolean;
  download_count: number;
  avg_rating: number;
  rating_count: number;
  author_id: string | null;
  created_at: string;
  skill_versions: Array<{
    id: string;
    version: number;
    status: string;
    scan_result: any;
    content_preview: string | null;
    created_at: string;
    submitted_by: string;
  }>;
}

export default function SkillsLibrary() {
  const { t, language } = useLanguage();
  const { isAdmin, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState<SkillSortBy>('newest');
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(0);

  // Reset to page 0 when filters change
  useEffect(() => { setPage(0); }, [search, category, sortBy]);

  const { data: skillsResult, isLoading } = useSkills({ search, category, sortBy, page });
  const skills = skillsResult?.skills || [];
  const skillsTotal = skillsResult?.total || 0;
  const { data: mySkills = [], isLoading: myLoading } = useMySkills();

  // Admin state
  const adminAction = useAdminSkillAction();
  const fetchVersionContent = useFetchVersionContent();
  const [adminSkills, setAdminSkills] = useState<AdminSkill[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [adminSearch, setAdminSearch] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<AdminSkill | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [actionVersionId, setActionVersionId] = useState<string | null>(null);
  const [actionSkillId, setActionSkillId] = useState<string | null>(null);
  const [deleteFromBrowse, setDeleteFromBrowse] = useState(false);

  const fetchAdminSkills = async () => {
    setAdminLoading(true);
    const headers: Record<string, string> = {};
    const { data: session } = await supabase.auth.getSession();
    if (session.session) {
      headers.Authorization = `Bearer ${session.session.access_token}`;
    }
    const response = await supabase.functions.invoke('skill-admin-actions', {
      body: {
        action: 'list_all',
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: adminSearch || undefined,
      },
      headers,
    });
    if (response.data?.skills) setAdminSkills(response.data.skills);
    setAdminLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'manage' && isAdmin) fetchAdminSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, statusFilter]);

  // Debounced admin search
  useEffect(() => {
    if (activeTab !== 'manage' || !isAdmin) return;
    const t = setTimeout(() => fetchAdminSkills(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSearch]);

  const openPreview = async (skill: AdminSkill) => {
    setSelectedSkill(skill);
    setPreviewContent('');
    const latest = skill.skill_versions?.[0];
    if (!latest) return;
    setPreviewLoading(true);
    try {
      const content = await fetchVersionContent.mutateAsync({ version_id: latest.id });
      setPreviewContent(content);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRescan = async (versionId: string) => {
    adminAction.mutate(
      { action: 'rescan', version_id: versionId },
      {
        onSuccess: (data: any) => {
          toast({ title: language === 'he' ? `סריקה הושלמה: ${data.status}` : `Rescan complete: ${data.status}` });
          fetchAdminSkills();
        },
      }
    );
  };

  const handleApprove = async (versionId: string) => {
    adminAction.mutate(
      { action: 'approve', version_id: versionId },
      { onSuccess: () => { toast({ title: language === 'he' ? 'הסקיל אושר' : 'Skill approved' }); fetchAdminSkills(); } }
    );
  };

  const handleReject = async () => {
    if (!actionVersionId) return;
    adminAction.mutate(
      { action: 'reject', version_id: actionVersionId, notes: rejectNotes },
      { onSuccess: () => { toast({ title: language === 'he' ? 'הסקיל נדחה' : 'Skill rejected' }); setShowRejectDialog(false); setRejectNotes(''); setActionVersionId(null); fetchAdminSkills(); } }
    );
  };

  const handleFeature = async (skillId: string, isFeatured: boolean) => {
    adminAction.mutate(
      { action: 'feature', skill_id: skillId, is_featured: !isFeatured },
      { onSuccess: () => { toast({ title: language === 'he' ? 'עודכן' : 'Updated' }); fetchAdminSkills(); } }
    );
  };

  const handleDelete = async () => {
    if (!actionSkillId) return;
    adminAction.mutate(
      { action: 'delete', skill_id: actionSkillId },
      {
        onSuccess: () => {
          toast({ title: language === 'he' ? 'הסקיל נמחק' : 'Skill deleted' });
          setShowDeleteDialog(false);
          setActionSkillId(null);
          setDeleteFromBrowse(false);
          if (activeTab === 'manage') fetchAdminSkills();
        },
      }
    );
  };

  const handleDeleteFromBrowse = (skillId: string) => {
    setActionSkillId(skillId);
    setDeleteFromBrowse(true);
    setShowDeleteDialog(true);
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    submitted: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    scanning: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  };

  return (

      <div className="space-y-6">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 mb-1.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md shadow-primary/20">
                  <Sparkles className="w-5 h-5 text-primary-foreground" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('skills.title')}</h1>
              </div>
              <p className="text-muted-foreground">
                {language === 'he' ? 'גלה ושתף סקילים מקצועיים' : 'Discover and share professional skills'}
              </p>
            </div>
            <Link to="/skills/submit">
              <Button size="lg" className="gap-2 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all">
                <Plus className="w-4 h-4" />
                {t('skills.submitNew')}
              </Button>
            </Link>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="all">{t('skills.allSkills')}</TabsTrigger>
            <TabsTrigger value="mine">{t('skills.mySkills')}</TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="manage">{t('nav.manageSkills')}</TabsTrigger>
            )}
          </TabsList>

          {/* ===== All Skills Tab ===== */}
          <TabsContent value="all">
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('skills.search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="ps-10"
                />
              </div>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SkillSortBy)}>
                <SelectTrigger className="w-[180px]">
                  <SlidersHorizontal className="w-4 h-4 me-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">{t('skills.sortNewest')}</SelectItem>
                  <SelectItem value="popular">{t('skills.sortPopular')}</SelectItem>
                  <SelectItem value="top_rated">{t('skills.sortTopRated')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              <Badge variant={category === 'all' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setCategory('all')}>
                {language === 'he' ? 'הכל' : 'All'}
              </Badge>
              {SKILL_CATEGORIES.map((cat) => (
                <Badge key={cat} variant={category === cat ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setCategory(cat)}>
                  {t(`skills.categories.${cat}`)}
                </Badge>
              ))}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
              </div>
            ) : skills.length === 0 ? (
              <Card className="border-border/60">
                <CardContent className="py-16 text-center">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                    <Sparkles className="w-10 h-10 text-primary/60" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{t('skills.noResults')}</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5">
                    {language === 'he'
                      ? 'סקילים הם מודולים מוכנים לשימוש עם Claude Code — שיפורים, אוטומציות וכלים שאפשר להעלות, לשתף ולהוריד יחד עם חברי הקהילה. אפשרות לתרום את הסקיל הראשון!'
                      : 'Skills are ready-to-use modules for Claude Code — enhancements, automations and tools that you (and other community members) can upload, share and download. Be the first to contribute!'}
                  </p>
                  <Link to="/skills/submit">
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      {t('skills.submitNew')}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {skills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onAdminDelete={isAdmin ? handleDeleteFromBrowse : undefined}
                    />
                  ))}
                </div>
                {skillsTotal > 24 && (
                  <div className="flex items-center justify-between mt-6">
                    <p className="text-sm text-muted-foreground">
                      {language === 'he'
                        ? `מציג ${page * 24 + 1}–${Math.min((page + 1) * 24, skillsTotal)} מתוך ${skillsTotal}`
                        : `Showing ${page * 24 + 1}–${Math.min((page + 1) * 24, skillsTotal)} of ${skillsTotal}`}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                        {language === 'he' ? 'הקודם' : 'Previous'}
                      </Button>
                      <Button variant="outline" size="sm" disabled={(page + 1) * 24 >= skillsTotal} onClick={() => setPage(p => p + 1)}>
                        {language === 'he' ? 'הבא' : 'Next'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ===== My Skills Tab ===== */}
          <TabsContent value="mine">
            {myLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
              </div>
            ) : mySkills.length === 0 ? (
              <Card className="border-border/60">
                <CardContent className="py-16 text-center">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                    <Sparkles className="w-10 h-10 text-primary/60" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{t('skills.noResults')}</h3>
                  <Link to="/skills/submit">
                    <Button variant="outline" className="mt-5 gap-2">
                      <Plus className="w-4 h-4" />
                      {t('skills.submitNew')}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {mySkills.map((skill) => <SkillCard key={skill.id} skill={skill} showStatus />)}
              </div>
            )}
          </TabsContent>

          {/* ===== Admin Manage Tab ===== */}
          {isAdmin && (
            <TabsContent value="manage">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t('skills.search')}
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    className="ps-10"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'he' ? 'כל הסטטוסים' : 'All statuses'}</SelectItem>
                    <SelectItem value="submitted">{t('skills.status.submitted')}</SelectItem>
                    <SelectItem value="scanning">{t('skills.status.scanning')}</SelectItem>
                    <SelectItem value="approved">{t('skills.status.approved')}</SelectItem>
                    <SelectItem value="rejected">{t('skills.status.rejected')}</SelectItem>
                    <SelectItem value="draft">{t('skills.status.draft')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Quick stats */}
              {!adminLoading && adminSkills.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-4">
                  {(() => {
                    const pendingCount = adminSkills.filter(s => s.status === 'submitted').length;
                    const failedCount = adminSkills.filter(s => s.skill_versions?.some(v => v.scan_result?.scan_failed)).length;
                    const rejectedCount = adminSkills.filter(s => s.status === 'rejected').length;
                    return (
                      <>
                        {pendingCount > 0 && (
                          <Badge
                            className="cursor-pointer bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 hover:bg-yellow-200"
                            onClick={() => setStatusFilter('submitted')}
                          >
                            {pendingCount} {language === 'he' ? 'ממתינים לאישור' : 'pending review'}
                          </Badge>
                        )}
                        {failedCount > 0 && (
                          <Badge
                            variant="outline"
                            className="cursor-pointer text-amber-700 border-amber-400 dark:text-amber-300 hover:bg-amber-50"
                            onClick={() => setStatusFilter('all')}
                          >
                            {failedCount} {language === 'he' ? 'סריקה נכשלה' : 'scan failed'}
                          </Badge>
                        )}
                        {rejectedCount > 0 && (
                          <Badge
                            className="cursor-pointer bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 hover:bg-red-200"
                            onClick={() => setStatusFilter('rejected')}
                          >
                            {rejectedCount} {language === 'he' ? 'נדחו' : 'rejected'}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-muted-foreground">
                          {adminSkills.length} {language === 'he' ? 'סה"כ' : 'total'}
                        </Badge>
                      </>
                    );
                  })()}
                </div>
              )}

              {adminLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
                </div>
              ) : adminSkills.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>{t('skills.noResults')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {adminSkills.map((skill) => {
                    const latestVersion = skill.skill_versions?.[0];
                    return (
                      <Card key={skill.id}>
                        <CardContent className="py-4">
                          <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h3 className="font-semibold">{skill.name}</h3>
                                <Badge className={statusColors[skill.status] || ''}>
                                  {t(`skills.status.${skill.status}`)}
                                </Badge>
                                {skill.is_featured && (
                                  <Badge className="bg-amber-500 text-white text-xs">{t('skills.featured')}</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-1">{skill.description}</p>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                                <span className="flex items-center gap-1">
                                  <Star className="w-3 h-3" />
                                  {Number(skill.avg_rating).toFixed(1)} ({skill.rating_count})
                                </span>
                                <span>{skill.download_count} {t('skills.downloads')}</span>
                                <span>{new Date(skill.created_at).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US')}</span>
                                {latestVersion && <span>{t('skills.version')} {latestVersion.version}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              {latestVersion && (
                                <Button variant="outline" size="sm" onClick={() => openPreview(skill)} title={t('skills.viewContent')}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              )}

                              {latestVersion && (
                                <SecurityScanBadge status={latestVersion.status} scanResult={latestVersion.scan_result} />
                              )}

                              {latestVersion?.scan_result?.scan_failed && (
                                <Badge variant="outline" className="text-amber-700 border-amber-400 dark:text-amber-300">
                                  {t('skills.scanFailedBadge')}
                                </Badge>
                              )}

                              {latestVersion && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRescan(latestVersion.id)}
                                  disabled={adminAction.isPending || latestVersion.status === 'scanning'}
                                  title={t('skills.rescan')}
                                >
                                  <RefreshCw className={`w-4 h-4 ${latestVersion.status === 'scanning' ? 'animate-spin' : ''}`} />
                                </Button>
                              )}

                              {latestVersion && skill.status !== 'approved' && (
                                <>
                                  <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-950" onClick={() => handleApprove(latestVersion.id)} disabled={adminAction.isPending}>
                                    <ShieldCheck className="w-4 h-4 me-1" />
                                    {t('skills.approve')}
                                  </Button>
                                  {skill.status !== 'rejected' && (
                                    <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => { setActionVersionId(latestVersion.id); setShowRejectDialog(true); }} disabled={adminAction.isPending}>
                                      <ShieldX className="w-4 h-4 me-1" />
                                      {t('skills.reject')}
                                    </Button>
                                  )}
                                </>
                              )}

                              <Button size="sm" variant={skill.is_featured ? 'default' : 'outline'} onClick={() => handleFeature(skill.id, skill.is_featured)} disabled={adminAction.isPending}>
                                <Star className="w-4 h-4" />
                              </Button>

                              {isAdmin && (
                                <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => { setActionSkillId(skill.id); setShowDeleteDialog(true); }} disabled={adminAction.isPending}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>

        {/* Reject Dialog */}
        <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('skills.reject')}</DialogTitle>
            </DialogHeader>
            <Textarea placeholder={t('skills.rejectNotes')} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={4} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
                {language === 'he' ? 'ביטול' : 'Cancel'}
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={adminAction.isPending}>
                {t('skills.reject')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('skills.deleteConfirm')}</AlertDialogTitle>
              <AlertDialogDescription>
                {language === 'he' ? 'פעולה זו אינה ניתנת לביטול.' : 'This action cannot be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{language === 'he' ? 'ביטול' : 'Cancel'}</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                {language === 'he' ? 'מחק' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Content Preview Dialog (admin — full content) */}
        <Dialog open={!!selectedSkill} onOpenChange={(open) => { if (!open) { setSelectedSkill(null); setPreviewContent(''); } }}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{selectedSkill?.name} — {t('skills.contentPreview')}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {previewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : previewContent ? (
                <SkillContentPreview content={previewContent} maxHeight="55vh" />
              ) : selectedSkill?.skill_versions?.[0]?.content_preview ? (
                <SkillContentPreview content={selectedSkill.skill_versions[0].content_preview} maxHeight="55vh" />
              ) : null}

              {selectedSkill?.skill_versions?.[0]?.scan_result && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">{t('skills.scanResults')}</h4>
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-48">
                    {JSON.stringify(selectedSkill.skill_versions[0].scan_result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
  );
}

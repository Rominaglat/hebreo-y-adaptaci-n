import { useState, useEffect, useRef } from 'react';
import { 
  Mail, 
  Phone, 
  Calendar,
  Save,
  Loader2,
  Github,
  Linkedin,
  Camera,
  Instagram,
  Facebook,
  Lock,
  Eye,
  EyeOff,
  Users,
  MessageCircle
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { format } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { AchievementsGrid } from '@/components/AchievementBadge';
import { StreakIndicator } from '@/components/StreakIndicator';
import { useOnboarding } from '@/hooks/useOnboarding';

export default function Profile() {
  const { profile, role, user, refreshProfile, tenantProfile, tenantRole, refreshTenantProfile } = useAuth();
  const { currentTenant } = useTenant();
  const { t, language } = useLanguage();
  const { goal: weeklyGoal, setEmailsEnabled: setWeeklyEmails } = useWeeklyGoal();
  const { toast } = useToast();
  const { completeStep } = useOnboarding();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mark profile onboarding step as complete on visit
  useEffect(() => {
    completeStep('profile');
  }, [completeStep]);
  
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [visibilitySettings, setVisibilitySettings] = useState({
    show_in_community: true,
    show_phone_call: true,
    show_whatsapp: true
  });
  const [passwordData, setPasswordData] = useState({
    newPassword: '',
    confirmPassword: ''
  });
  const [formData, setFormData] = useState({
    full_name: '',
    bio: '',
    linkedin: '',
    github: '',
    instagram: '',
    facebook: ''
  });

  const roleLabels: Record<string, string> = {
    admin: t('profile.admin'),
    instructor: t('profile.instructor'),
    student: t('profile.student'),
  };

  // Use tenant profile if available, otherwise fall back to global profile
  const effectiveProfile = {
    full_name: tenantProfile?.full_name || profile?.full_name || '',
    avatar_url: tenantProfile?.avatar_url || profile?.avatar_url || null,
    bio: tenantProfile?.bio || profile?.bio || null,
    phone: tenantProfile?.phone || profile?.phone || null,
    email: profile?.email || '',
    join_date: profile?.join_date || new Date().toISOString(),
    social_links: profile?.social_links || {}
  };
  
  const effectiveRole = tenantRole || role;

  useEffect(() => {
    const socialLinks = effectiveProfile.social_links as Record<string, string> || {};
    setFormData({
      full_name: effectiveProfile.full_name || '',
      bio: effectiveProfile.bio || '',
      linkedin: socialLinks.linkedin || '',
      github: socialLinks.github || '',
      instagram: socialLinks.instagram || '',
      facebook: socialLinks.facebook || ''
    });
  }, [tenantProfile, profile]);

  // Fetch visibility settings from profiles
  useEffect(() => {
    const fetchVisibilitySettings = async () => {
      if (!user) return;

      const { data } = await supabase
        .from('profiles')
        .select('show_in_community, show_phone_call, show_whatsapp')
        .eq('id', user.id)
        .maybeSingle();

      if (data) {
        setVisibilitySettings({
          show_in_community: data.show_in_community ?? true,
          show_phone_call: data.show_phone_call ?? true,
          show_whatsapp: data.show_whatsapp ?? true
        });
      }
    };

    fetchVisibilitySettings();
  }, [user]);

  const handleVisibilityChange = async (key: keyof typeof visibilitySettings, value: boolean) => {
    if (!user) return;

    const newSettings = { ...visibilitySettings, [key]: value };
    setVisibilitySettings(newSettings);
    setIsSavingVisibility(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [key]: value })
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: t('profilePage.settingUpdated'),
      });
    } catch (error) {
      console.error('Error updating visibility:', error);
      setVisibilitySettings(visibilitySettings); // Revert
      toast({
        title: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);

    try {
      // Update profile (single source of truth post tenant_memberships drop)
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name.trim(),
          bio: formData.bio.trim() || null,
          social_links: {
            linkedin: formData.linkedin.trim() || null,
            github: formData.github.trim() || null,
            instagram: formData.instagram.trim() || null,
            facebook: formData.facebook.trim() || null
          }
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      await refreshProfile();
      await refreshTenantProfile();

      toast({
        title: t('profile.saved'),
        description: t('profile.savedDesc'),
      });

      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: t('common.error'),
        description: t('profile.invalidImageType'),
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t('common.error'),
        description: t('profile.imageTooLarge'),
        variant: 'destructive',
      });
      return;
    }

    setIsUploadingAvatar(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      // Upload the file
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Update profile avatar (single source of truth post tenant_memberships drop)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      await refreshProfile();
      await refreshTenantProfile();

      toast({
        title: t('profile.avatarUpdated'),
        description: t('profile.avatarUpdatedDesc'),
      });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast({
        title: t('common.error'),
        description: t('profile.avatarUploadError'),
        variant: 'destructive',
      });
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePasswordChange = async () => {
    // SEC-014 — enforce policy + HIBP breach check before sending to Supabase.
    const { validatePassword } = await import('@/lib/passwordPolicy');
    const check = await validatePassword(passwordData.newPassword);
    if (!check.ok) {
      toast({
        title: t('common.error'),
        description: check.error ?? t('profile.passwordMinLength'),
        variant: 'destructive',
      });
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: t('common.error'),
        description: t('profile.passwordMismatch'),
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      });

      if (error) throw error;

      toast({
        title: t('profile.passwordChanged'),
        description: t('profile.passwordChangedDesc'),
      });

      setPasswordData({ newPassword: '', confirmPassword: '' });
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    } catch (error: any) {
      console.error('Error changing password:', error);
      toast({
        title: t('profile.passwordChangeError'),
        description: error.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin': return 'destructive';
      case 'instructor': return 'default';
      default: return 'secondary';
    }
  };

  if (!profile) {
    return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      
    );
  }

  return (
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Premium Profile Hero */}
        <Card className="overflow-hidden border-border/60">
          {/* Gradient Banner */}
          <div className="h-32 sm:h-40 bg-gradient-to-br from-primary via-accent to-primary/80 relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.15),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(255,255,255,0.1),transparent_50%)]" />
          </div>

          <CardContent className="pt-0 pb-6 -mt-16 sm:-mt-20 relative">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 sm:gap-6">
              <div className="relative group flex-shrink-0">
                <Avatar className="w-28 h-28 sm:w-32 sm:h-32 border-4 border-card shadow-xl">
                  <AvatarImage src={effectiveProfile.avatar_url || undefined} />
                  <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground text-3xl font-bold">
                    {getInitials(effectiveProfile.full_name)}
                  </AvatarFallback>
                </Avatar>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAvatar}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed"
                >
                  {isUploadingAvatar ? (
                    <Loader2 className="w-7 h-7 text-white animate-spin" />
                  ) : (
                    <Camera className="w-7 h-7 text-white" />
                  )}
                </button>
              </div>

              <div className="flex-1 text-center sm:text-right pt-2 sm:pt-0 sm:pb-2">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 mb-2">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{effectiveProfile.full_name}</h1>
                  <div className="flex items-center gap-2">
                    <Badge variant={getRoleBadgeVariant(effectiveRole || 'student')} className="font-medium">
                      {roleLabels[effectiveRole || 'student']}
                    </Badge>
                    {currentTenant && (
                      <Badge variant="outline" className="text-xs font-medium border-border/60">
                        {currentTenant.name}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-4 h-4" />
                    {effectiveProfile.email}
                  </span>
                  {effectiveProfile.phone && (
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-4 h-4" />
                      {effectiveProfile.phone}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {t('profile.memberSince')} {format(new Date(effectiveProfile.join_date), 'MMMM yyyy', { locale: language === 'he' ? he : language === 'es' ? es : enUS })}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Engagement Stats: Streak + Activity Heatmap */}
        <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-1">
            <StreakIndicator />
          </div>
          <div className="lg:col-span-2">
            <ActivityHeatmap />
          </div>
        </div>

        {/* Achievements */}
        <AchievementsGrid />

        {/* Bio Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('profile.about')}</CardTitle>
                <CardDescription>{t('profile.aboutDesc')}</CardDescription>
              </div>
              {!isEditing && (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  {t('profile.editProfile')}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditing ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="full_name">{t('profile.name')}</Label>
                  <Input
                    id="full_name"
                    placeholder={t('profile.namePlaceholder')}
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio">{t('profile.bio')}</Label>
                  <Textarea
                    id="bio"
                    placeholder={t('profile.bioPlaceholder')}
                    className="min-h-[100px]"
                    maxLength={2048}
                    value={formData.bio}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground text-left">
                    {formData.bio.length}/2048
                  </p>
                </div>
                
                <Separator />
                
                <div className="space-y-4">
                  <Label>{t('profile.socialLinks')}</Label>
                  
                  <div className="space-y-2">
                    <Label htmlFor="linkedin" className="text-sm text-muted-foreground flex items-center gap-2">
                      <Linkedin className="w-4 h-4" />
                      {t('profile.linkedinUrl')}
                    </Label>
                    <Input
                      id="linkedin"
                      placeholder="https://linkedin.com/in/..."
                      value={formData.linkedin}
                      onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="github" className="text-sm text-muted-foreground flex items-center gap-2">
                      <Github className="w-4 h-4" />
                      {t('profile.githubUrl')}
                    </Label>
                    <Input
                      id="github"
                      placeholder="https://github.com/..."
                      value={formData.github}
                      onChange={(e) => setFormData({ ...formData, github: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="instagram" className="text-sm text-muted-foreground flex items-center gap-2">
                      <Instagram className="w-4 h-4" />
                      Instagram
                    </Label>
                    <Input
                      id="instagram"
                      placeholder="https://instagram.com/..."
                      value={formData.instagram}
                      onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="facebook" className="text-sm text-muted-foreground flex items-center gap-2">
                      <Facebook className="w-4 h-4" />
                      Facebook
                    </Label>
                    <Input
                      id="facebook"
                      placeholder="https://facebook.com/..."
                      value={formData.facebook}
                      onChange={(e) => setFormData({ ...formData, facebook: e.target.value })}
                    />
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-4">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                        {t('profile.saving')}
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mx-2" />
                        {t('profile.saveChanges')}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setIsEditing(false)} disabled={isSaving}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">{t('profile.bio')}</h4>
                  {effectiveProfile.bio ? (
                    <p className="whitespace-pre-wrap">{effectiveProfile.bio}</p>
                  ) : (
                    <p className="text-muted-foreground italic">{t('profile.noBio')}</p>
                  )}
                </div>
                
                {(formData.linkedin || formData.github || formData.instagram || formData.facebook) && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-3">{t('profile.socialLinks')}</h4>
                      <div className="flex flex-wrap gap-2">
                        {formData.linkedin && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={formData.linkedin} target="_blank" rel="noopener noreferrer">
                              <Linkedin className="w-4 h-4 mx-2" />
                              LinkedIn
                            </a>
                          </Button>
                        )}
                        {formData.github && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={formData.github} target="_blank" rel="noopener noreferrer">
                              <Github className="w-4 h-4 mx-2" />
                              GitHub
                            </a>
                          </Button>
                        )}
                        {formData.instagram && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={formData.instagram} target="_blank" rel="noopener noreferrer">
                              <Instagram className="w-4 h-4 mx-2" />
                              Instagram
                            </a>
                          </Button>
                        )}
                        {formData.facebook && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={formData.facebook} target="_blank" rel="noopener noreferrer">
                              <Facebook className="w-4 h-4 mx-2" />
                              Facebook
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Preferences */}
        {weeklyGoal && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-foreground">{t('goal.profile.emailLabel')}</p>
                  <p className="text-sm text-muted-foreground">{t('goal.profile.emailHint')}</p>
                </div>
                <Switch
                  checked={weeklyGoal.emailsEnabled}
                  onCheckedChange={(v) => void setWeeklyEmails(v)}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contact Info (Read Only) */}
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.contactInfo')}</CardTitle>
            <CardDescription>
              {t('profile.contactInfoDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('profile.emailAddress')}</Label>
                <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span>{profile.email}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('profile.phoneNumber')}</Label>
                <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span>{profile.phone || t('profile.noPhone')}</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              {t('profile.contactAdmin')}
            </p>
          </CardContent>
        </Card>

        {/* Visibility Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-muted-foreground" />
              <div>
                <CardTitle>{t('profilePage.visibilityTitle')}</CardTitle>
                <CardDescription>
                  {t('profilePage.visibilityDesc')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">
                  {t('profilePage.showInCommunity')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('profilePage.showInCommunityDesc')}
                </p>
              </div>
              <Switch
                checked={visibilitySettings.show_in_community}
                onCheckedChange={(checked) => handleVisibilityChange('show_in_community', checked)}
                disabled={isSavingVisibility}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  {t('profilePage.showCallButton')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('profilePage.showCallButtonDesc')}
                </p>
              </div>
              <Switch
                checked={visibilitySettings.show_phone_call}
                onCheckedChange={(checked) => handleVisibilityChange('show_phone_call', checked)}
                disabled={isSavingVisibility}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  {t('profilePage.showWhatsappButton')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('profilePage.showWhatsappButtonDesc')}
                </p>
              </div>
              <Switch
                checked={visibilitySettings.show_whatsapp}
                onCheckedChange={(checked) => handleVisibilityChange('show_whatsapp', checked)}
                disabled={isSavingVisibility}
              />
            </div>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-muted-foreground" />
              <div>
                <CardTitle>{t('profile.changePassword')}</CardTitle>
                <CardDescription>{t('profile.changePasswordDesc')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-w-md">
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t('profile.newPassword')}</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    className="pe-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('profile.confirmPassword')}</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    className="pe-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button 
                onClick={handlePasswordChange} 
                disabled={isChangingPassword || !passwordData.newPassword || !passwordData.confirmPassword}
              >
                {isChangingPassword ? (
                  <>
                    <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                    {t('profile.changingPassword')}
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 mx-2" />
                    {t('profile.changePassword')}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}
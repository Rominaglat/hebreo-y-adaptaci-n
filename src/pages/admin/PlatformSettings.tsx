import { useEffect, useState, useRef, useCallback } from 'react';
import { Palette, Image, Type, Save, Loader2, Shield, Upload, RotateCcw, Building2, Eye, EyeOff, Video, HelpCircle, Bot, Sparkles, Crop, Trash2 } from 'lucide-react';
import { ImageCropper } from '@/components/ImageCropper';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { DeveloperSettings } from '@/components/admin/DeveloperSettings';
import { ColorField } from '@/components/admin/ColorField';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
interface TenantSettingsData {
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  background_color: string | null;
  custom_css: string | null;
  api_key: string | null;
  webhook_url: string | null;
  webhook_enabled: boolean | null;
  vimeo_access_token: string | null;
  ai_assistant_name: string | null;
  ai_assistant_avatar_url: string | null;
  ai_assistant_system_prompt: string | null;
}
const defaultColors = {
  primary_color: '#3b82f6',
  secondary_color: '#10b981',
  background_color: '#ffffff'
};

// Helper to convert hex to HSL string for CSS variables
const hexToHslForPreview = (hex: string): string | null => {
  if (!hex || !hex.startsWith('#')) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

// Get luminance (0-1)
const getLuminance = (hex: string): number => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 0.5;
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  const [rSRGB, gSRGB, bSRGB] = [r, g, b].map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * rSRGB + 0.7152 * gSRGB + 0.0722 * bSRGB;
};

// Get contrast color
const getContrastColor = (hexColor: string): string => {
  const lum = getLuminance(hexColor);
  return lum > 0.5 ? '0 0% 10%' : '0 0% 98%';
};
export default function PlatformSettings() {
  const {
    isAdmin,
    user
  } = useAuth();
  const {
    language
  } = useLanguage();
  const {
    currentTenant,
    refreshTenantSettings
  } = useTenant();
  const {
    toast
  } = useToast();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [livePreview, setLivePreview] = useState(false);
  const originalColorsRef = useRef<Map<string, string>>(new Map());
  const [settings, setSettings] = useState<TenantSettingsData>({
    logo_url: null,
    primary_color: defaultColors.primary_color,
    secondary_color: defaultColors.secondary_color,
    background_color: defaultColors.background_color,
    custom_css: null,
    api_key: null,
    webhook_url: null,
    webhook_enabled: false,
    vimeo_access_token: null,
    ai_assistant_name: null,
    ai_assistant_avatar_url: null,
    ai_assistant_system_prompt: null,
  });
  const [showVimeoToken, setShowVimeoToken] = useState(false);

  // Assistant avatar upload + cropper state
  const assistantAvatarInputRef = useRef<HTMLInputElement>(null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);


  // Apply live preview of colors
  const applyLivePreview = useCallback(() => {
    if (!livePreview) return;
    const root = document.documentElement;

    // Store original values if not already stored
    if (originalColorsRef.current.size === 0) {
      const props = ['--primary', '--secondary', '--accent', '--foreground', '--background', '--card', '--popover', '--muted', '--border', '--input', '--ring', '--card-foreground', '--popover-foreground', '--muted-foreground', '--primary-foreground', '--secondary-foreground', '--accent-foreground'];
      props.forEach(prop => {
        const computed = getComputedStyle(root).getPropertyValue(prop);
        originalColorsRef.current.set(prop, computed);
      });
    }
    const primaryColor = settings.primary_color;
    const secondaryColor = settings.secondary_color;
    const backgroundColor = settings.background_color;
    if (primaryColor) {
      const hsl = hexToHslForPreview(primaryColor);
      if (hsl) {
        root.style.setProperty('--primary', hsl);
        root.style.setProperty('--ring', hsl);
        root.style.setProperty('--primary-foreground', getContrastColor(primaryColor));
      }
    }
    if (secondaryColor) {
      const hsl = hexToHslForPreview(secondaryColor);
      if (hsl) {
        root.style.setProperty('--accent', hsl);
        root.style.setProperty('--accent-foreground', getContrastColor(secondaryColor));
      }
    }
    if (backgroundColor) {
      const hsl = hexToHslForPreview(backgroundColor);
      if (hsl) {
        root.style.setProperty('--background', hsl);
        root.style.setProperty('--foreground', getContrastColor(backgroundColor));
        root.style.setProperty('--card-foreground', getContrastColor(backgroundColor));
        root.style.setProperty('--popover-foreground', getContrastColor(backgroundColor));
      }
    }
  }, [livePreview, settings]);

  // Restore original colors when live preview is turned off
  const restoreOriginalColors = useCallback(() => {
    const root = document.documentElement;
    originalColorsRef.current.forEach((value, prop) => {
      if (value) {
        root.style.setProperty(prop, value);
      } else {
        root.style.removeProperty(prop);
      }
    });
    originalColorsRef.current.clear();
  }, []);

  // Apply/restore preview when toggle changes or settings change
  useEffect(() => {
    if (livePreview) {
      applyLivePreview();
    } else {
      restoreOriginalColors();
    }
  }, [livePreview, settings, applyLivePreview, restoreOriginalColors]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      restoreOriginalColors();
    };
  }, [restoreOriginalColors]);
  useEffect(() => {
    let cancelled = false;
    if (isAdmin && currentTenant) {
      fetchTenantSettings(() => cancelled);
    }
    return () => {
      cancelled = true;
    };
  }, [isAdmin, currentTenant?.id]);
  const fetchTenantSettings = async (isCancelled?: () => boolean) => {
    if (!currentTenant) return;
    setLoading(true);
    try {
      const {
        data,
        error
      } = await supabase.from('tenant_settings').select('*').maybeSingle();
      if (isCancelled?.()) return;
      if (error) throw error;
      if (data) {
        setSettings({
          logo_url: data.logo_url || currentTenant.logo_url,
          primary_color: data.primary_color || defaultColors.primary_color,
          secondary_color: data.secondary_color || defaultColors.secondary_color,
          background_color: data.background_color || defaultColors.background_color,
          custom_css: data.custom_css,
          api_key: data.api_key,
          webhook_url: data.webhook_url,
          webhook_enabled: data.webhook_enabled,
          vimeo_access_token: (data as any).vimeo_access_token || null,
          ai_assistant_name: (data as any).ai_assistant_name || null,
          ai_assistant_avatar_url: (data as any).ai_assistant_avatar_url || null,
          ai_assistant_system_prompt: (data as any).ai_assistant_system_prompt || null,
        });
      } else {
        // Create default settings for this tenant
        const {
          data: newSettings,
          error: insertError
        } = await supabase.from('tenant_settings').insert({
          primary_color: defaultColors.primary_color,
          secondary_color: defaultColors.secondary_color,
          background_color: defaultColors.background_color
        }).select().single();
        if (insertError) throw insertError;
        if (newSettings) {
          setSettings({
            logo_url: newSettings.logo_url,
            primary_color: newSettings.primary_color || defaultColors.primary_color,
            secondary_color: newSettings.secondary_color || defaultColors.secondary_color,
            background_color: newSettings.background_color || defaultColors.background_color,
            custom_css: newSettings.custom_css,
            api_key: newSettings.api_key,
            webhook_url: newSettings.webhook_url,
            webhook_enabled: newSettings.webhook_enabled,
            vimeo_access_token: (newSettings as any).vimeo_access_token || null,
            ai_assistant_name: (newSettings as any).ai_assistant_name || null,
            ai_assistant_avatar_url: (newSettings as any).ai_assistant_avatar_url || null,
            ai_assistant_system_prompt: (newSettings as any).ai_assistant_system_prompt || null,
          });
        }
      }
    } catch (error) {
      if (isCancelled?.()) return;
      // Ignore transient network errors caused by aborted/unmounted fetches —
      // these are expected during fast navigation and shouldn't surface to the user.
      const message = (error as Error)?.message ?? '';
      const isTransientNetworkError =
        message.includes('Failed to fetch') ||
        (error as Error)?.name === 'AbortError';
      if (isTransientNetworkError) {
        return;
      }
      console.error('Error fetching tenant settings:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'שגיאה בטעינת ההגדרות' : 'Error loading settings',
        variant: 'destructive'
      });
    } finally {
      if (!isCancelled?.()) setLoading(false);
    }
  };
  const handleSaveSettings = async () => {
    if (!user || !currentTenant) return;
    setSaving(true);
    try {
      const {
        error
      } = await supabase.from('tenant_settings').update({
        logo_url: settings.logo_url,
        primary_color: settings.primary_color,
        secondary_color: settings.secondary_color,
        background_color: settings.background_color,
        // Clear the old fields so the auto-generation kicks in
        accent_color: null,
        primary_color_dark: null,
        secondary_color_dark: null,
        accent_color_dark: null,
        foreground_color: null,
        foreground_color_dark: null,
        background_color_dark: null,
        custom_css: settings.custom_css,
        webhook_url: settings.webhook_url,
        webhook_enabled: settings.webhook_enabled,
        vimeo_access_token: settings.vimeo_access_token,
        ai_assistant_name: settings.ai_assistant_name,
        ai_assistant_avatar_url: settings.ai_assistant_avatar_url,
        ai_assistant_system_prompt: settings.ai_assistant_system_prompt,
      } as any);
      if (error) throw error;
      await refreshTenantSettings();
      toast({
        title: language === 'he' ? 'הגדרות נשמרו' : 'Settings Saved',
        description: language === 'he' ? 'הגדרות הטננט עודכנו בהצלחה' : 'Tenant settings updated successfully'
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'שגיאה בשמירת ההגדרות' : 'Error saving settings',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };
  const handleResetColors = () => {
    setSettings(prev => ({
      ...prev,
      primary_color: defaultColors.primary_color,
      secondary_color: defaultColors.secondary_color,
      background_color: defaultColors.background_color
    }));
  };
  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user || !currentTenant) return;
    if (!file.type.startsWith('image/')) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'יש להעלות קובץ תמונה' : 'Please upload an image file',
        variant: 'destructive'
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'גודל הקובץ לא יכול לעלות על 2MB' : 'File size cannot exceed 2MB',
        variant: 'destructive'
      });
      return;
    }
    setUploadingLogo(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `logo-${currentTenant.id}-${Date.now()}.${fileExt}`;
      const filePath = `tenants/${currentTenant.id}/${fileName}`;
      const {
        error: uploadError
      } = await supabase.storage.from('course-images').upload(filePath, file, {
        upsert: true
      });
      if (uploadError) throw uploadError;
      const {
        data: {
          publicUrl
        }
      } = supabase.storage.from('course-images').getPublicUrl(filePath);
      setSettings(prev => ({
        ...prev,
        logo_url: publicUrl
      }));
      toast({
        title: language === 'he' ? 'הלוגו הועלה' : 'Logo Uploaded',
        description: language === 'he' ? 'הלוגו הועלה בהצלחה. יש ללחוץ על שמירה להחלת השינויים' : 'Logo uploaded successfully. Click Save to apply changes'
      });
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'שגיאה בהעלאת הלוגו' : 'Error uploading logo',
        variant: 'destructive'
      });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  };

  // ─── Assistant avatar: file picker → cropper → upload ──────────────────
  const handleAssistantAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'יש להעלות קובץ תמונה' : 'Please upload an image file',
        variant: 'destructive',
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'גודל הקובץ לא יכול לעלות על 5MB' : 'File size cannot exceed 5MB',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropperImageSrc(reader.result as string);
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    // Reset input so the same file can be selected again
    if (assistantAvatarInputRef.current) {
      assistantAvatarInputRef.current.value = '';
    }
  };

  const handleAssistantAvatarUpload = async (blob: Blob) => {
    if (!user || !currentTenant) return;
    setUploadingAvatar(true);
    try {
      const fileName = `assistant-${currentTenant.id}-${Date.now()}.png`;
      const filePath = `ai-assistants/${currentTenant.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('course-images')
        .upload(filePath, blob, { upsert: true, contentType: 'image/png' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('course-images').getPublicUrl(filePath);

      setSettings(prev => ({ ...prev, ai_assistant_avatar_url: publicUrl }));
      setCropperOpen(false);
      setCropperImageSrc(null);

      toast({
        title: language === 'he' ? 'התמונה הועלתה' : 'Avatar uploaded',
        description: language === 'he'
          ? 'חשוב ללחוץ על "שמירת הגדרות"'
          : 'Don\'t forget to click "Save Settings"',
      });
    } catch (error) {
      console.error('Error uploading assistant avatar:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'שגיאה בהעלאת התמונה' : 'Error uploading avatar',
        variant: 'destructive',
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleAssistantAvatarRemove = () => {
    setSettings(prev => ({ ...prev, ai_assistant_avatar_url: null }));
  };

  if (!isAdmin) {
    return (
        <div className="text-center py-12">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {language === 'he' ? 'אין הרשאה' : 'Access Denied'}
          </h2>
          <p className="text-muted-foreground">
            {language === 'he' ? 'רק מנהלים יכולים לגשת לעמוד זה' : 'Only admins can access this page'}
          </p>
        </div>
    );
  }
  if (!currentTenant) {
    return (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {language === 'he' ? 'לא נבחר ארגון' : 'No Organization Selected'}
          </h2>
          <p className="text-muted-foreground">
            {language === 'he' ? 'יש לבחור ארגון מהתפריט כדי לערוך את ההגדרות שלו' : 'Select an organization from the menu to edit its settings'}
          </p>
        </div>
    );
  }
  if (loading) {
    return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
    );
  }
  return (
      <div className="max-w-4xl mx-auto space-y-6 px-2 sm:px-0">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                {language === 'he' ? 'הגדרות ארגון' : 'Organization Settings'}
              </h1>
              <Badge variant="outline" className="text-xs border-border/60 bg-card/60 backdrop-blur-sm">
                {currentTenant.name}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {language === 'he' ? 'התאמת המראה והמיתוג של הארגון' : 'Customize the appearance and branding of the organization'}
            </p>
          </div>
        </div>

        {/* Branding Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Type className="w-5 h-5" />
              {language === 'he' ? 'לוגו הארגון' : 'Organization Logo'}
            </CardTitle>
            <CardDescription>
              {language === 'he' ? 'הגדרת הלוגו של הארגון' : 'Set the organization logo'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>{language === 'he' ? 'לוגו' : 'Logo'}</Label>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {settings.logo_url ? <div className="w-20 h-20 rounded-lg border bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                    <img src={settings.logo_url} alt="Organization logo" className="w-full h-full object-contain" />
                  </div> : <div className="w-20 h-20 rounded-lg border bg-muted flex items-center justify-center flex-shrink-0">
                    <Image className="w-8 h-8 text-muted-foreground" />
                  </div>}
                <div>
                  <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  <Button variant="outline" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="w-full sm:w-auto">
                    {uploadingLogo ? <Loader2 className="w-4 h-4 mx-2 animate-spin" /> : <Upload className="w-4 h-4 mx-2" />}
                    {language === 'he' ? 'העלאת לוגו' : 'Upload Logo'}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    {language === 'he' ? 'PNG, JPG עד 2MB' : 'PNG, JPG up to 2MB'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Color Settings - Simplified */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              {language === 'he' ? 'צבעי הארגון' : 'Organization Colors'}
            </CardTitle>
            <CardDescription>
              {language === 'he' ? 'בחירת 3 צבעים והמערכת תיצור אוטומטית עיצוב מותאם לכל מצב תצוגה' : 'Choose 3 colors and the system will automatically generate a matching design for all display modes'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Live Preview Toggle */}
            

            {/* 3 Simple Color Pickers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <ColorField id="primary-color" label={language === 'he' ? 'צבע ראשי' : 'Primary Color'} value={settings.primary_color} onChange={value => setSettings(prev => ({
              ...prev,
              primary_color: value
            }))} />
              <ColorField id="secondary-color" label={language === 'he' ? 'צבע משני' : 'Secondary Color'} value={settings.secondary_color} onChange={value => setSettings(prev => ({
              ...prev,
              secondary_color: value
            }))} />
              <ColorField id="background-color" label={language === 'he' ? 'צבע רקע' : 'Background Color'} value={settings.background_color} onChange={value => setSettings(prev => ({
              ...prev,
              background_color: value
            }))} />
            </div>


            <Separator />

            <Button variant="outline" onClick={handleResetColors} size="sm">
              <RotateCcw className="w-4 h-4 mx-2" />
              {language === 'he' ? 'איפוס צבעים' : 'Reset Colors'}
            </Button>
          </CardContent>
        </Card>

        {/* AI Assistant Customization */}
        <Card className="border-border/60 overflow-hidden relative">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2.5 tracking-tight">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md shadow-primary/20">
                <Bot className="w-5 h-5 text-primary-foreground" />
              </div>
              {language === 'he' ? 'העוזר הדיגיטלי' : 'AI Assistant'}
            </CardTitle>
            <CardDescription>
              {language === 'he'
                ? 'התאם אישית את שם העוזר, התמונה והנחיות מותאמות'
                : 'Customize your assistant name, avatar, and instructions'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 relative">
            {/* Avatar */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {language === 'he' ? 'תמונת פרופיל' : 'Avatar'}
              </Label>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="relative flex-shrink-0">
                  {settings.ai_assistant_avatar_url ? (
                    <div className="relative w-24 h-24 rounded-2xl border border-border/60 bg-gradient-to-br from-primary/15 to-accent/10 overflow-hidden shadow-md">
                      <img
                        src={settings.ai_assistant_avatar_url}
                        alt="Assistant avatar"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-24 h-24 rounded-2xl border border-dashed border-border/60 bg-gradient-to-br from-primary/10 to-accent/5 flex items-center justify-center">
                      <Bot className="w-10 h-10 text-primary/40" />
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    ref={assistantAvatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAssistantAvatarSelect}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => assistantAvatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="gap-1.5"
                    >
                      {uploadingAvatar ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : settings.ai_assistant_avatar_url ? (
                        <Crop className="w-4 h-4" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      {settings.ai_assistant_avatar_url
                        ? language === 'he' ? 'החלף תמונה' : 'Replace image'
                        : language === 'he' ? 'העלה תמונה' : 'Upload image'}
                    </Button>
                    {settings.ai_assistant_avatar_url && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleAssistantAvatarRemove}
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                        {language === 'he' ? 'הסר' : 'Remove'}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {language === 'he'
                      ? 'PNG/JPG עד 5MB. אפשר לחתוך ולמרכז את התמונה לפני שמירה.'
                      : 'PNG/JPG up to 5MB. You can crop the image before saving.'}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="assistant-name" className="text-sm font-medium">
                {language === 'he' ? 'שם העוזר' : 'Assistant name'}
              </Label>
              <Input
                id="assistant-name"
                value={settings.ai_assistant_name || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, ai_assistant_name: e.target.value || null }))}
                placeholder={language === 'he' ? 'לדוגמה: ג׳ייסון' : 'e.g., Jason'}
                className="max-w-md"
              />
              <p className="text-xs text-muted-foreground">
                {language === 'he'
                  ? 'השם שיופיע בכרטיס הצ׳אט. אם תשאיר ריק — יוצג שם ברירת המחדל.'
                  : 'The name shown in the chat widget. Leave empty to use the default.'}
              </p>
            </div>

            <Separator />

            {/* System prompt */}
            <div className="space-y-2">
              <Label htmlFor="assistant-prompt" className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                {language === 'he' ? 'הנחיית מערכת (אופציונלי)' : 'System prompt (optional)'}
              </Label>
              <Textarea
                id="assistant-prompt"
                value={settings.ai_assistant_system_prompt || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, ai_assistant_system_prompt: e.target.value || null }))}
                placeholder={language === 'he'
                  ? 'לדוגמה: עוזר מקצועי בנושא AI ושיווק. יש לענות בעברית, בנימוס, ובאופן ממוקד...'
                  : 'e.g., You are a professional assistant for AI and marketing. Reply in Hebrew, politely and concisely...'}
                className="min-h-[140px] font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                {language === 'he'
                  ? 'הנחיה זו מתווספת לתחילת כל שיחה ומשפיעה על האופן בו העוזר מגיב.'
                  : 'This is prepended to every conversation and influences how the assistant responds.'}
              </p>
            </div>

          </CardContent>
        </Card>

        {/* Image Cropper Modal */}
        <ImageCropper
          open={cropperOpen}
          onOpenChange={setCropperOpen}
          imageSrc={cropperImageSrc}
          aspect={1}
          outputSize={512}
          onCropComplete={handleAssistantAvatarUpload}
          isUploading={uploadingAvatar}
        />

        {/* Vimeo Connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="w-5 h-5" />
              {language === 'he' ? 'חיבור Vimeo' : 'Vimeo Connection'}
              <Badge variant={settings.vimeo_access_token ? 'default' : 'destructive'} className="text-xs">
                {settings.vimeo_access_token
                  ? (language === 'he' ? 'מחובר' : 'Connected')
                  : (language === 'he' ? 'לא מחובר' : 'Not Connected')}
              </Badge>
            </CardTitle>
            <CardDescription>
              {language === 'he' ? 'חיבור חשבון Vimeo לאפשר סיכום אוטומטי של שיעורי וידאו' : 'Connect your Vimeo account to enable automatic video lesson summaries'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Personal Access Token</Label>
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm text-sm leading-relaxed" dir={language === 'he' ? 'rtl' : 'ltr'}>
                      <p className="font-semibold mb-2">
                        {language === 'he' ? 'איך משיגים טוקן:' : 'How to get a token:'}
                      </p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>{language === 'he' ? 'יש להיכנס ל-developer.vimeo.com/apps' : 'Go to developer.vimeo.com/apps'}</li>
                        <li>{language === 'he' ? 'יש ללחוץ על "Create App" (או לבחור אפליקציה קיימת)' : 'Click "Create App" (or select existing)'}</li>
                        <li>{language === 'he' ? 'יש למלא שם ותיאור כלשהם וללחוץ "Create"' : 'Fill in any name/description and click "Create"'}</li>
                        <li>{language === 'he' ? 'בדף האפליקציה, יש לגלול למטה ל-"Personal Access Tokens"' : 'On the app page, scroll down to "Personal Access Tokens"'}</li>
                        <li>{language === 'he' ? 'יש לבחור "Authenticated (you)" בשדה הראשון' : 'Select "Authenticated (you)" in the first field'}</li>
                        <li>{language === 'he' ? 'בהרשאות, יש לבחור "Private" ו-"Video Files"' : 'In scopes, select "Private" and "Video Files"'}</li>
                        <li>{language === 'he' ? 'יש ללחוץ "Generate" ולהעתיק את הטוקן שנוצר' : 'Click "Generate" and copy the generated token'}</li>
                        <li>{language === 'he' ? 'יש להדביק אותו כאן וללחוץ "שמירת הגדרות"' : 'Paste it here and click "Save Settings"'}</li>
                      </ol>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex gap-2">
                <Input
                  type={showVimeoToken ? 'text' : 'password'}
                  value={settings.vimeo_access_token || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, vimeo_access_token: e.target.value || null }))}
                  placeholder={language === 'he' ? 'יש להדביק את הטוקן כאן...' : 'Paste your token here...'}
                  dir="ltr"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowVimeoToken(!showVimeoToken)}
                >
                  {showVimeoToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Developer Settings */}
        <DeveloperSettings tenantId={currentTenant.id} />

        {/* Save Button */}
        <div className="flex justify-end sticky bottom-4 pb-4">
          <Button onClick={handleSaveSettings} disabled={saving} size="lg" className="shadow-lg">
            {saving ? <Loader2 className="w-4 h-4 mx-2 animate-spin" /> : <Save className="w-4 h-4 mx-2" />}
            {language === 'he' ? 'שמירת הגדרות' : 'Save Settings'}
          </Button>
        </div>
      </div>
  );
}
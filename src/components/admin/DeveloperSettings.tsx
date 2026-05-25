import { useState, useEffect } from 'react';
import { Code, Webhook, Key, Copy, RefreshCw, Eye, EyeOff, Loader2, Save, BookOpen, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ApiAnalyticsChart } from './ApiAnalyticsChart';

interface DeveloperSettingsProps {
  tenantId: string;
}

interface TenantSettingsData {
  id: string;
  webhook_url: string | null;
  webhook_enabled: boolean | null;
  api_key: string | null;
  api_key_created_at: string | null;
}

export function DeveloperSettings({ tenantId }: DeveloperSettingsProps) {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [settings, setSettings] = useState<TenantSettingsData | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);

  useEffect(() => {
    if (tenantId) {
      fetchSettings();
    }
  }, [tenantId]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tenant_settings')
        .select('id, webhook_url, webhook_enabled, api_key, api_key_created_at')
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings(data);
        setWebhookUrl(data.webhook_url || '');
        setWebhookEnabled(data.webhook_enabled || false);
      }
    } catch (error) {
      console.error('Error fetching tenant settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings || !user) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('tenant_settings')
        .update({
          webhook_url: webhookUrl || null,
          webhook_enabled: webhookEnabled
        })
        .eq('id', settings.id);

      if (error) throw error;

      toast({
        title: t('platformSettings.settingsSaved'),
        description: t('developerSettings.settingsUpdated'),
      });
    } catch (error) {
      console.error('Error saving developer settings:', error);
      toast({
        title: t('common.error'),
        description: t('platformSettings.errorSaving'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateApiKey = async () => {
    if (!settings || !user) return;
    setRegenerating(true);

    try {
      // Generate new API key
      const newApiKey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const { error } = await supabase
        .from('tenant_settings')
        .update({
          api_key: newApiKey,
          api_key_created_at: new Date().toISOString()
        })
        .eq('id', settings.id);

      if (error) throw error;

      setSettings(prev => prev ? { ...prev, api_key: newApiKey, api_key_created_at: new Date().toISOString() } : null);
      
      toast({
        title: t('developerSettings.newKeyGenerated'),
        description: t('developerSettings.newKeyGeneratedDesc'),
      });
    } catch (error) {
      console.error('Error regenerating API key:', error);
      toast({
        title: t('common.error'),
        description: t('developerSettings.errorGeneratingKey'),
        variant: 'destructive',
      });
    } finally {
      setRegenerating(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: t('developerSettings.copied'),
        description: t('developerSettings.copiedToClipboard'),
      });
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <p className="text-muted-foreground">
            {t('developerSettings.noSettingsFound')}
          </p>
        </CardContent>
      </Card>
    );
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  return (
    <div className="space-y-6">
      <ApiAnalyticsChart />
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="w-5 h-5" />
            {t('developerSettings.title')}
          </CardTitle>
          <CardDescription>
            {t('developerSettings.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
        {/* API Key Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            <Label className="text-base font-medium">
              {t('developerSettings.apiKey')}
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('developerSettings.apiKeyDesc')}
          </p>
          
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={settings?.api_key || ''}
                readOnly
                className="font-mono text-sm pr-10"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => settings?.api_key && copyToClipboard(settings.api_key)}
            >
              {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRegenerateApiKey}
              disabled={regenerating}
            >
              <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          
          {settings?.api_key_created_at && (
            <p className="text-xs text-muted-foreground">
              {t('developerSettings.createdAt')}
              {new Date(settings.api_key_created_at).toLocaleDateString(language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US')}
            </p>
          )}
        </div>

        <Separator />

        {/* Webhook Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Webhook className="w-4 h-4 text-muted-foreground" />
            <Label className="text-base font-medium">
              {t('developerSettings.webhookLabel')}
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('developerSettings.webhookDesc')}
          </p>

          <div className="flex items-center justify-between">
            <Label htmlFor="webhook-enabled">
              {t('developerSettings.enableWebhook')}
            </Label>
            <Switch
              id="webhook-enabled"
              checked={webhookEnabled}
              onCheckedChange={setWebhookEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-url">
              {t('developerSettings.webhookUrl')}
            </Label>
            <Input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              disabled={!webhookEnabled}
            />
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 mx-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mx-2" />
            )}
            {t('platformSettings.saveSettings')}
          </Button>
        </div>

        <Separator />

        {/* API Documentation */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <Label className="text-base font-medium">
              {t('developerSettings.apiDocs')}
            </Label>
          </div>

          <Accordion type="multiple" className="w-full">
            {/* API Endpoint */}
            <AccordionItem value="api-endpoint">
              <AccordionTrigger>
                {t('developerSettings.apiEndpoint')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {t('developerSettings.sendPost')}
                  </p>
                  <pre className="bg-muted p-4 rounded-lg text-xs overflow-x-auto" dir="ltr">
{`POST ${supabaseUrl}/functions/v1/external-api

Headers:
  Content-Type: application/json
  X-API-Key: <your-api-key>

Body:
{
  "action": "action.name",
  "data": { ... }
}`}
                  </pre>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Users API */}
            <AccordionItem value="users-api">
              <AccordionTrigger>
                {t('developerSettings.usersApi')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">users.list</h4>
                    <p className="text-muted-foreground">{t('developerSettings.usersList')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "users.list", 
  "data": { 
    "limit": 100 
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.get</h4>
                    <p className="text-muted-foreground">{t('developerSettings.usersGet')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "users.get", 
  "data": { 
    "user_id": "550e8400-e29b-41d4-a716-446655440000" 
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.create</h4>
                    <p className="text-muted-foreground">{t('developerSettings.usersCreate')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{
  "action": "users.create",
  "data": {
    "email": "user@example.com",
    "password": "securePassword123",
    "full_name": "${t('developerSettings.sampleFullName')}",
    "phone": "0501234567",
    "role": "student",
    "courses": "all"
  }
}

// Or with specific courses:
{
  "action": "users.create",
  "data": {
    "email": "user@example.com",
    "password": "securePassword123",
    "full_name": "${t('developerSettings.sampleFullName')}",
    "phone": "0501234567",
    "role": "student",
    "courses": [
      "course-uuid-1",
      "course-uuid-2"
    ]
  }
}`}
                    </pre>
                    <div className="bg-muted/50 p-3 rounded-lg text-xs mt-2">
                      <p className="font-medium mb-1">{t('developerSettings.parameters')}</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><code>email</code> - {t('developerSettings.paramEmail')}</li>
                        <li><code>password</code> - {t('developerSettings.paramPassword')}</li>
                        <li><code>full_name</code> - {t('developerSettings.paramFullName')}</li>
                        <li><code>phone</code> - {t('developerSettings.paramPhone')}</li>
                        <li><code>role</code> - {t('developerSettings.paramRole')}</li>
                        <li><code>courses</code> - {t('developerSettings.paramCourses')}</li>
                      </ul>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.search</h4>
                    <p className="text-muted-foreground">{t('developerSettings.usersSearch')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{
  "action": "users.search",
  "data": {
    "email": "user@example.com",
    "full_name": "${t('developerSettings.sampleSearchName')}",
    "phone": "050",
    "limit": 50,
    "offset": 0
  }
}`}
                    </pre>
                    <div className="bg-muted/50 p-3 rounded-lg text-xs mt-2">
                      <p className="font-medium mb-1">{t('developerSettings.parametersOptional')}</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><code>email</code> - {t('developerSettings.paramSearchEmail')}</li>
                        <li><code>full_name</code> - {t('developerSettings.paramSearchName')}</li>
                        <li><code>phone</code> - {t('developerSettings.paramSearchPhone')}</li>
                        <li><code>limit</code> - {t('developerSettings.paramLimit')}</li>
                        <li><code>offset</code> - {t('developerSettings.paramOffset')}</li>
                      </ul>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.getRoles</h4>
                    <p className="text-muted-foreground">{t('developerSettings.usersGetRoles')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "users.getRoles", 
  "data": { 
    "user_id": "550e8400-e29b-41d4-a716-446655440000" 
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.setRole</h4>
                    <p className="text-muted-foreground">{t('developerSettings.usersSetRole')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "users.setRole", 
  "data": { 
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "role": "instructor"
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.delete</h4>
                    <p className="text-muted-foreground">{t('developerSettings.usersDelete')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "users.delete", 
  "data": { 
    "user_id": "550e8400-e29b-41d4-a716-446655440000" 
  } 
}`}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Courses API */}
            <AccordionItem value="courses-api">
              <AccordionTrigger>
                {t('developerSettings.coursesApi')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.list</h4>
                    <p className="text-muted-foreground">{t('developerSettings.coursesList')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "courses.list" }`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.get</h4>
                    <p className="text-muted-foreground">{t('developerSettings.coursesGet')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "courses.get", 
  "data": { 
    "course_id": "550e8400-e29b-41d4-a716-446655440000" 
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.create</h4>
                    <p className="text-muted-foreground">{t('developerSettings.coursesCreate')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{
  "action": "courses.create",
  "data": {
    "title": "${t('developerSettings.sampleCourseTitle')}",
    "description": "${t('developerSettings.sampleCourseDescription')}",
    "is_published": false,
    "thumbnail_url": "https://example.com/image.jpg",
    "payment_url": "https://payment.link/course"
  }
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.update</h4>
                    <p className="text-muted-foreground">{t('developerSettings.coursesUpdate')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{
  "action": "courses.update",
  "data": {
    "course_id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "${t('developerSettings.sampleUpdatedTitle')}",
    "is_published": true
  }
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.delete</h4>
                    <p className="text-muted-foreground">{t('developerSettings.coursesDelete')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "courses.delete", 
  "data": { 
    "course_id": "550e8400-e29b-41d4-a716-446655440000" 
  } 
}`}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Enrollments API */}
            <AccordionItem value="enrollments-api">
              <AccordionTrigger>
                {t('developerSettings.enrollmentsApi')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">enrollments.list</h4>
                    <p className="text-muted-foreground">{t('developerSettings.enrollmentsList')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "enrollments.list", 
  "data": { 
    "course_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "550e8400-e29b-41d4-a716-446655440001"
  } 
}`}
                    </pre>
                    <div className="bg-muted/50 p-3 rounded-lg text-xs mt-2">
                      <p className="text-muted-foreground">{t('developerSettings.enrollmentsListFilter')}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">enrollments.create</h4>
                    <p className="text-muted-foreground">{t('developerSettings.enrollmentsCreate')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "enrollments.create", 
  "data": { 
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "course_id": "550e8400-e29b-41d4-a716-446655440001"
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">enrollments.delete</h4>
                    <p className="text-muted-foreground">{t('developerSettings.enrollmentsDelete')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "enrollments.delete", 
  "data": { 
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "course_id": "550e8400-e29b-41d4-a716-446655440001"
  } 
}`}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Activities API */}
            <AccordionItem value="activities-api">
              <AccordionTrigger>
                {t('developerSettings.activitiesApi')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">activities.list</h4>
                    <p className="text-muted-foreground">{t('developerSettings.activitiesList')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "activities.list", 
  "data": { 
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "activity_type": "course_view",
    "from_date": "2024-01-01T00:00:00Z",
    "to_date": "2024-12-31T23:59:59Z",
    "limit": 50
  } 
}`}
                    </pre>
                    <div className="bg-muted/50 p-3 rounded-lg text-xs mt-2">
                      <p className="font-medium mb-1">{t('developerSettings.parametersOptional')}</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><code>user_id</code> - {t('developerSettings.paramFilterUser')}</li>
                        <li><code>activity_type</code> - {t('developerSettings.paramFilterActivity')}</li>
                        <li><code>from_date</code> - {t('developerSettings.paramFromDate')}</li>
                        <li><code>to_date</code> - {t('developerSettings.paramToDate')}</li>
                        <li><code>limit</code> - {t('developerSettings.paramMaxResults')}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Stats API */}
            <AccordionItem value="stats-api">
              <AccordionTrigger>
                {t('developerSettings.statsApi')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">stats.overview</h4>
                    <p className="text-muted-foreground">{t('developerSettings.statsOverview')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "stats.overview" }`}
                    </pre>
                    <div className="bg-muted/50 p-3 rounded-lg text-xs mt-2">
                      <p className="font-medium mb-1">{t('developerSettings.response')}</p>
                      <pre className="text-muted-foreground">
{`{
  "stats": {
    "total_users": 150,
    "published_courses": 12,
    "total_enrollments": 450
  }
}`}
                      </pre>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Announcements API */}
            <AccordionItem value="announcements-api">
              <AccordionTrigger>
                {t('developerSettings.announcementsApi')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">announcements.list</h4>
                    <p className="text-muted-foreground">{t('developerSettings.announcementsList')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "announcements.list" }`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">announcements.create</h4>
                    <p className="text-muted-foreground">{t('developerSettings.announcementsCreate')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{
  "action": "announcements.create",
  "data": {
    "title": "${t('developerSettings.sampleAnnouncementTitle')}",
    "content": "${t('developerSettings.sampleAnnouncementContent')}",
    "is_pinned": true
  }
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">announcements.delete</h4>
                    <p className="text-muted-foreground">{t('developerSettings.announcementsDelete')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "announcements.delete", 
  "data": { 
    "announcement_id": "550e8400-e29b-41d4-a716-446655440000" 
  } 
}`}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Events API */}
            <AccordionItem value="events-api">
              <AccordionTrigger>
                {t('developerSettings.eventsApi')}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">events.list</h4>
                    <p className="text-muted-foreground">{t('developerSettings.eventsList')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "events.list" }`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">events.create</h4>
                    <p className="text-muted-foreground">{t('developerSettings.eventsCreate')}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{
  "action": "events.create",
  "data": {
    "title": "${t('developerSettings.sampleEventTitle')}",
    "description": "${t('developerSettings.sampleEventDescription')}",
    "start_time": "2024-12-25T10:00:00Z",
    "end_time": "2024-12-25T12:00:00Z",
    "location": "${t('developerSettings.sampleEventLocation')}",
    "meeting_url": "https://meet.google.com/abc-defg-hij"
  }
}`}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        </CardContent>
      </Card>
    </div>
  );
}
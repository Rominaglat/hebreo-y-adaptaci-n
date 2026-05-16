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
  const { language } = useLanguage();
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
        title: language === 'he' ? 'הגדרות נשמרו' : 'Settings Saved',
        description: language === 'he' ? 'הגדרות המפתחים עודכנו בהצלחה' : 'Developer settings updated successfully',
      });
    } catch (error) {
      console.error('Error saving developer settings:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'שגיאה בשמירת ההגדרות' : 'Error saving settings',
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
        title: language === 'he' ? 'מפתח חדש נוצר' : 'New Key Generated',
        description: language === 'he' ? 'מפתח ה-API החדש נוצר בהצלחה' : 'New API key generated successfully',
      });
    } catch (error) {
      console.error('Error regenerating API key:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'שגיאה ביצירת מפתח חדש' : 'Error generating new key',
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
        title: language === 'he' ? 'הועתק' : 'Copied',
        description: language === 'he' ? 'הועתק ללוח' : 'Copied to clipboard',
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
            {language === 'he' ? 'לא נמצאו הגדרות לארגון זה' : 'No settings found for this organization'}
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
            {language === 'he' ? 'הגדרות מפתחים' : 'Developer Settings'}
          </CardTitle>
          <CardDescription>
            {language === 'he' 
              ? 'הגדרות API ו-Webhook לאינטגרציות חיצוניות' 
              : 'API and Webhook settings for external integrations'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
        {/* API Key Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            <Label className="text-base font-medium">
              {language === 'he' ? 'מפתח API' : 'API Key'}
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {language === 'he' 
              ? 'יש להשתמש במפתח זה לאימות בקשות API ולשמור אותו במקום בטוח.'
              : 'Use this key to authenticate API requests. Keep it secure.'}
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
              {language === 'he' ? 'נוצר ב: ' : 'Created: '}
              {new Date(settings.api_key_created_at).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US')}
            </p>
          )}
        </div>

        <Separator />

        {/* Webhook Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Webhook className="w-4 h-4 text-muted-foreground" />
            <Label className="text-base font-medium">
              {language === 'he' ? 'Webhook לאירועי Audit' : 'Audit Events Webhook'}
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {language === 'he' 
              ? 'קבל עדכונים בזמן אמת על כל אירועי הפעילות במערכת.'
              : 'Receive real-time updates about all activity events in the system.'}
          </p>

          <div className="flex items-center justify-between">
            <Label htmlFor="webhook-enabled">
              {language === 'he' ? 'הפעל Webhook' : 'Enable Webhook'}
            </Label>
            <Switch
              id="webhook-enabled"
              checked={webhookEnabled}
              onCheckedChange={setWebhookEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-url">
              {language === 'he' ? 'כתובת Webhook' : 'Webhook URL'}
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
            {language === 'he' ? 'שמירת הגדרות' : 'Save Settings'}
          </Button>
        </div>

        <Separator />

        {/* API Documentation */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <Label className="text-base font-medium">
              {language === 'he' ? 'תיעוד API' : 'API Documentation'}
            </Label>
          </div>

          <Accordion type="multiple" className="w-full">
            {/* API Endpoint */}
            <AccordionItem value="api-endpoint">
              <AccordionTrigger>
                {language === 'he' ? 'כתובת ה-API' : 'API Endpoint'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {language === 'he' 
                      ? 'יש לשלוח בקשות POST לכתובת הבאה:'
                      : 'Send POST requests to the following URL:'}
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
                {language === 'he' ? 'משתמשים (Users)' : 'Users API'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">users.list</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת רשימת משתמשים' : 'Get list of users'}</p>
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
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת פרטי משתמש' : 'Get user details'}</p>
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
                    <p className="text-muted-foreground">{language === 'he' ? 'יצירת משתמש חדש עם אפשרות להגדיר קורסים' : 'Create new user with optional course enrollments'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "users.create", 
  "data": { 
    "email": "user@example.com",
    "password": "securePassword123",
    "full_name": "ישראל ישראלי",
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
    "full_name": "ישראל ישראלי",
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
                      <p className="font-medium mb-1">{language === 'he' ? 'פרמטרים:' : 'Parameters:'}</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><code>email</code> - {language === 'he' ? 'כתובת אימייל (חובה)' : 'Email address (required)'}</li>
                        <li><code>password</code> - {language === 'he' ? 'סיסמה, מינימום 6 תווים (חובה)' : 'Password, minimum 6 characters (required)'}</li>
                        <li><code>full_name</code> - {language === 'he' ? 'שם מלא' : 'Full name'}</li>
                        <li><code>phone</code> - {language === 'he' ? 'מספר טלפון' : 'Phone number'}</li>
                        <li><code>role</code> - {language === 'he' ? 'תפקיד: student, instructor, admin' : 'Role: student, instructor, admin'}</li>
                        <li><code>courses</code> - {language === 'he' ? '"all" לכל הקורסים או מערך של מזהי קורסים' : '"all" for all courses or array of course IDs'}</li>
                      </ul>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.search</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'חיפוש משתמשים לפי פרמטרים' : 'Search users by parameters'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "users.search", 
  "data": { 
    "email": "user@example.com",
    "full_name": "ישראל",
    "phone": "050",
    "limit": 50,
    "offset": 0
  } 
}`}
                    </pre>
                    <div className="bg-muted/50 p-3 rounded-lg text-xs mt-2">
                      <p className="font-medium mb-1">{language === 'he' ? 'פרמטרים (כולם אופציונליים):' : 'Parameters (all optional):'}</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><code>email</code> - {language === 'he' ? 'חיפוש לפי אימייל (חלקי)' : 'Search by email (partial match)'}</li>
                        <li><code>full_name</code> - {language === 'he' ? 'חיפוש לפי שם (חלקי)' : 'Search by name (partial match)'}</li>
                        <li><code>phone</code> - {language === 'he' ? 'חיפוש לפי טלפון (חלקי)' : 'Search by phone (partial match)'}</li>
                        <li><code>limit</code> - {language === 'he' ? 'מספר תוצאות מקסימלי (ברירת מחדל: 100)' : 'Maximum results (default: 100)'}</li>
                        <li><code>offset</code> - {language === 'he' ? 'דילוג על תוצאות (לעימוד)' : 'Skip results (for pagination)'}</li>
                      </ul>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">users.getRoles</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת תפקידי משתמש' : 'Get user roles'}</p>
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
                    <p className="text-muted-foreground">{language === 'he' ? 'עדכון תפקיד משתמש' : 'Update user role'}</p>
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
                    <p className="text-muted-foreground">{language === 'he' ? 'מחיקת משתמש' : 'Delete user'}</p>
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
                {language === 'he' ? 'קורסים (Courses)' : 'Courses API'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.list</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת רשימת קורסים' : 'Get list of courses'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "courses.list" }`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.get</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת פרטי קורס כולל מודולים ושיעורים' : 'Get course details with modules and lessons'}</p>
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
                    <p className="text-muted-foreground">{language === 'he' ? 'יצירת קורס חדש' : 'Create new course'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "courses.create", 
  "data": { 
    "title": "שם הקורס",
    "description": "תיאור הקורס",
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
                    <p className="text-muted-foreground">{language === 'he' ? 'עדכון פרטי קורס' : 'Update course details'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "courses.update", 
  "data": { 
    "course_id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "שם מעודכן",
    "is_published": true
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">courses.delete</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'מחיקת קורס' : 'Delete course'}</p>
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
                {language === 'he' ? 'הרשמות (Enrollments)' : 'Enrollments API'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">enrollments.list</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת רשימת הרשמות' : 'Get list of enrollments'}</p>
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
                      <p className="text-muted-foreground">{language === 'he' ? 'ניתן לסנן לפי course_id או user_id או שניהם' : 'Can filter by course_id, user_id, or both'}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">enrollments.create</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'הרשמת משתמש לקורס' : 'Enroll user to course'}</p>
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
                    <p className="text-muted-foreground">{language === 'he' ? 'ביטול הרשמה לקורס' : 'Remove enrollment'}</p>
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
                {language === 'he' ? 'פעילויות (Activities)' : 'Activities API'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">activities.list</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת לוג פעילויות' : 'Get activity log'}</p>
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
                      <p className="font-medium mb-1">{language === 'he' ? 'פרמטרים (כולם אופציונליים):' : 'Parameters (all optional):'}</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li><code>user_id</code> - {language === 'he' ? 'סינון לפי משתמש' : 'Filter by user'}</li>
                        <li><code>activity_type</code> - {language === 'he' ? 'סינון לפי סוג פעילות' : 'Filter by activity type'}</li>
                        <li><code>from_date</code> - {language === 'he' ? 'תאריך התחלה (ISO 8601)' : 'Start date (ISO 8601)'}</li>
                        <li><code>to_date</code> - {language === 'he' ? 'תאריך סיום (ISO 8601)' : 'End date (ISO 8601)'}</li>
                        <li><code>limit</code> - {language === 'he' ? 'מספר תוצאות מקסימלי' : 'Maximum results'}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Stats API */}
            <AccordionItem value="stats-api">
              <AccordionTrigger>
                {language === 'he' ? 'סטטיסטיקות (Stats)' : 'Stats API'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">stats.overview</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת סטטיסטיקות כלליות' : 'Get overview statistics'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "stats.overview" }`}
                    </pre>
                    <div className="bg-muted/50 p-3 rounded-lg text-xs mt-2">
                      <p className="font-medium mb-1">{language === 'he' ? 'תגובה:' : 'Response:'}</p>
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
                {language === 'he' ? 'הודעות (Announcements)' : 'Announcements API'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">announcements.list</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת רשימת הודעות' : 'Get list of announcements'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "announcements.list" }`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">announcements.create</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'יצירת הודעה חדשה' : 'Create new announcement'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "announcements.create", 
  "data": { 
    "title": "כותרת ההודעה",
    "content": "תוכן ההודעה",
    "is_pinned": true
  } 
}`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">announcements.delete</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'מחיקת הודעה' : 'Delete announcement'}</p>
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
                {language === 'he' ? 'אירועים (Events)' : 'Events API'}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <h4 className="font-medium">events.list</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'קבלת רשימת אירועים' : 'Get list of events'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ "action": "events.list" }`}
                    </pre>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="font-medium">events.create</h4>
                    <p className="text-muted-foreground">{language === 'he' ? 'יצירת אירוע חדש' : 'Create new event'}</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs" dir="ltr">
{`{ 
  "action": "events.create", 
  "data": { 
    "title": "שם האירוע",
    "description": "תיאור האירוע",
    "start_time": "2024-12-25T10:00:00Z",
    "end_time": "2024-12-25T12:00:00Z",
    "location": "חדר 101",
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
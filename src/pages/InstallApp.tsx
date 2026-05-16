import { useState, useEffect } from 'react';
import { 
  Download, 
  Smartphone, 
  Monitor, 
  Bell, 
  Check, 
  Share, 
  PlusSquare,
  MoreVertical,
  ArrowDown,
  Chrome,
  Apple
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallApp() {
  const { language } = useLanguage();
  const { isSupported, isSubscribed, isLoading, isPWA, subscribe } = usePushNotifications();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');

  useEffect(() => {
    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent)) {
      setPlatform('ios');
    } else if (/android/.test(userAgent)) {
      setPlatform('android');
    } else {
      setPlatform('desktop');
    }

    // Check if already installed (iOS standalone or display-mode: standalone)
    const isIOSStandalone = ('standalone' in window.navigator) && (window.navigator as any).standalone === true;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isIOSStandalone || isStandalone) {
      setIsInstalled(true);
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Listen for app installed
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    
    setDeferredPrompt(null);
  };

  const isHebrew = language === 'he';

  return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">
            {isHebrew ? 'התקנת האפליקציה' : 'Install App'}
          </h1>
          <p className="text-muted-foreground">
            {isHebrew 
              ? 'התקנת האפליקציה וקבלת התראות על הודעות חדשות'
              : 'Install the app and get notifications for new announcements'
            }
          </p>
        </div>

        {/* Status Cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className={isInstalled ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Download className="w-5 h-5" />
                {isHebrew ? 'התקנה' : 'Installation'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isInstalled ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span>{isHebrew ? 'האפליקציה מותקנת' : 'App installed'}</span>
                </div>
              ) : deferredPrompt ? (
                <Button onClick={handleInstallClick} className="w-full">
                  <Download className="w-4 h-4 mx-2" />
                  {isHebrew ? 'התקן עכשיו' : 'Install Now'}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isHebrew 
                    ? 'יש לעקוב אחרי ההוראות למטה להתקנה'
                    : 'Follow the instructions below to install'
                  }
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={isSubscribed ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell className="w-5 h-5" />
                {isHebrew ? 'התראות' : 'Notifications'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isSubscribed ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span>{isHebrew ? 'התראות מופעלות' : 'Notifications enabled'}</span>
                </div>
              ) : isSupported ? (
                <Button onClick={subscribe} disabled={isLoading} className="w-full">
                  <Bell className="w-4 h-4 mx-2" />
                  {isHebrew ? 'הפעל התראות' : 'Enable Notifications'}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isHebrew 
                    ? 'התראות לא נתמכות בדפדפן זה'
                    : 'Notifications not supported in this browser'
                  }
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Installation Instructions */}
        {!isInstalled && (
          <Card>
            <CardHeader>
              <CardTitle>{isHebrew ? 'הוראות התקנה' : 'Installation Instructions'}</CardTitle>
              <CardDescription>
                {isHebrew 
                  ? 'בחירת פלטפורמה'
                  : 'Select your platform'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={platform} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="ios" className="flex items-center gap-2">
                    <Apple className="w-4 h-4" />
                    iPhone
                  </TabsTrigger>
                  <TabsTrigger value="android" className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4" />
                    Android
                  </TabsTrigger>
                  <TabsTrigger value="desktop" className="flex items-center gap-2">
                    <Monitor className="w-4 h-4" />
                    {isHebrew ? 'מחשב' : 'Desktop'}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="ios" className="mt-4 space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">1</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          {isHebrew ? 'פתיחה ב-Safari' : 'Open in Safari'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'האפליקציה חייבת להיות פתוחה בדפדפן Safari'
                            : 'The app must be opened in Safari browser'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">2</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Share className="w-4 h-4" />
                          {isHebrew ? 'לחיצה על כפתור השיתוף' : 'Tap the Share button'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'הכפתור נמצא בתחתית המסך (ריבוע עם חץ למעלה)'
                            : 'Located at the bottom of the screen (square with arrow up)'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">3</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <PlusSquare className="w-4 h-4" />
                          {isHebrew ? 'בחירת "הוסף למסך הבית"' : 'Select "Add to Home Screen"'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'יש לגלול למטה בתפריט ולבחור באפשרות זו'
                            : 'Scroll down in the menu and select this option'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">4</Badge>
                      <div>
                        <p className="font-medium">{isHebrew ? 'אישור ההתקנה' : 'Confirm Installation'}</p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'לחיצה על "הוסף" בפינה הימנית העליונה'
                            : 'Tap "Add" in the top right corner'
                          }
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">5</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Bell className="w-4 h-4" />
                          {isHebrew ? 'הפעלת התראות' : 'Enable Notifications'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'יש לפתוח את האפליקציה מהמסך הבית וללחוץ על "הפעלת התראות". כשתופיע בקשת ההרשאה של iOS - יש ללחוץ "אפשר"'
                            : 'Open the app from home screen and tap "Enable Notifications". When iOS permission request appears - tap "Allow"'
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>{isHebrew ? 'חשוב!' : 'Important!'}</strong>{' '}
                      {isHebrew 
                        ? 'התראות פוש יעבדו רק אם האפליקציה מותקנת במסך הבית ונפתחת משם. סימניה רגילה לא תתמוך בהתראות.'
                        : 'Push notifications will only work if you install the app to home screen and open it from there. A regular bookmark will not support notifications.'
                      }
                    </p>
                  </div>

                  {/* Show notification button if installed */}
                  {isInstalled && !isSubscribed && isSupported && (
                    <Button onClick={subscribe} disabled={isLoading} className="w-full" size="lg">
                      <Bell className="w-5 h-5 mx-2" />
                      {isHebrew ? 'הפעלת התראות עכשיו' : 'Enable Notifications Now'}
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="android" className="mt-4 space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">1</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Chrome className="w-4 h-4" />
                          {isHebrew ? 'פתיחה ב-Chrome' : 'Open in Chrome'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'מומלץ להשתמש בדפדפן Chrome'
                            : 'Chrome browser is recommended'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">2</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <MoreVertical className="w-4 h-4" />
                          {isHebrew ? 'לחיצה על תפריט שלוש הנקודות' : 'Tap the three-dot menu'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'בפינה הימנית העליונה של הדפדפן'
                            : 'In the top right corner of the browser'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">3</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Download className="w-4 h-4" />
                          {isHebrew ? 'בחירת "התקן אפליקציה"' : 'Select "Install app"'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'או "הוספה למסך הבית"'
                            : 'Or "Add to Home screen"'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">4</Badge>
                      <div>
                        <p className="font-medium">{isHebrew ? 'אישור ההתקנה' : 'Confirm Installation'}</p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'לחיצה על "התקן" בחלון הקופץ'
                            : 'Tap "Install" in the popup'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  {deferredPrompt && (
                    <Button onClick={handleInstallClick} className="w-full" size="lg">
                      <Download className="w-5 h-5 mx-2" />
                      {isHebrew ? 'התקנה עכשיו' : 'Install Now'}
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="desktop" className="mt-4 space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">1</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Chrome className="w-4 h-4" />
                          {isHebrew ? 'פתיחה ב-Chrome או Edge' : 'Open in Chrome or Edge'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'דפדפנים אלה תומכים בהתקנת אפליקציות'
                            : 'These browsers support app installation'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">2</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <ArrowDown className="w-4 h-4" />
                          {isHebrew ? 'לחיצה על אייקון ההתקנה' : 'Click the install icon'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'בצד ימין של שורת הכתובת (אייקון מחשב עם חץ)'
                            : 'On the right side of the address bar (computer icon with arrow)'
                          }
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">3</Badge>
                      <div>
                        <p className="font-medium">{isHebrew ? 'אישור ההתקנה' : 'Confirm Installation'}</p>
                        <p className="text-sm text-muted-foreground">
                          {isHebrew 
                            ? 'לחיצה על "התקן" בחלון הקופץ'
                            : 'Click "Install" in the popup'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  {deferredPrompt && (
                    <Button onClick={handleInstallClick} className="w-full" size="lg">
                      <Download className="w-5 h-5 mx-2" />
                      {isHebrew ? 'התקנה עכשיו' : 'Install Now'}
                    </Button>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {/* Benefits */}
        <Card>
          <CardHeader>
            <CardTitle>{isHebrew ? 'למה להתקין?' : 'Why Install?'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{isHebrew ? 'התראות פוש' : 'Push Notifications'}</p>
                  <p className="text-sm text-muted-foreground">
                    {isHebrew 
                      ? 'קבל התראות על הודעות חדשות'
                      : 'Get notified about new announcements'
                    }
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{isHebrew ? 'גישה מהירה' : 'Quick Access'}</p>
                  <p className="text-sm text-muted-foreground">
                    {isHebrew 
                      ? 'פתיחת האפליקציה ישירות ממסך הבית'
                      : 'Open the app directly from home screen'
                    }
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{isHebrew ? 'חוויית אפליקציה' : 'App Experience'}</p>
                  <p className="text-sm text-muted-foreground">
                    {isHebrew 
                      ? 'ממשק מסך מלא ללא סרגלי דפדפן'
                      : 'Full screen interface without browser bars'
                    }
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Check className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{isHebrew ? 'עדכונים אוטומטיים' : 'Auto Updates'}</p>
                  <p className="text-sm text-muted-foreground">
                    {isHebrew 
                      ? 'תמיד הגרסה העדכנית ביותר'
                      : 'Always the latest version'
                    }
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}

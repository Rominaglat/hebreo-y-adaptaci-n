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
  const { t } = useLanguage();
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

  return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">
            {t('installApp.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('installApp.subtitle')}
          </p>
        </div>

        {/* Status Cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className={isInstalled ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Download className="w-5 h-5" />
                {t('installApp.installation')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isInstalled ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span>{t('installApp.appInstalled')}</span>
                </div>
              ) : deferredPrompt ? (
                <Button onClick={handleInstallClick} className="w-full">
                  <Download className="w-4 h-4 mx-2" />
                  {t('installApp.installNow')}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('installApp.followInstructions')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={isSubscribed ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell className="w-5 h-5" />
                {t('installApp.notifications')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isSubscribed ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="w-5 h-5" />
                  <span>{t('installApp.notificationsEnabled')}</span>
                </div>
              ) : isSupported ? (
                <Button onClick={subscribe} disabled={isLoading} className="w-full">
                  <Bell className="w-4 h-4 mx-2" />
                  {t('notifications.enable')}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('installApp.notificationsUnsupported')}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Installation Instructions */}
        {!isInstalled && (
          <Card>
            <CardHeader>
              <CardTitle>{t('installApp.instructionsTitle')}</CardTitle>
              <CardDescription>
                {t('installApp.selectPlatform')}
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
                    {t('installApp.desktop')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="ios" className="mt-4 space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">1</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          {t('installApp.iosStep1Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.iosStep1Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">2</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Share className="w-4 h-4" />
                          {t('installApp.iosStep2Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.iosStep2Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">3</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <PlusSquare className="w-4 h-4" />
                          {t('installApp.iosStep3Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.iosStep3Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">4</Badge>
                      <div>
                        <p className="font-medium">{t('installApp.confirmInstall')}</p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.iosStep4Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">5</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Bell className="w-4 h-4" />
                          {t('installApp.enableNotifications')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.iosStep5Desc')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>{t('installApp.important')}</strong>{' '}
                      {t('installApp.pushOnlyHomeScreen')}
                    </p>
                  </div>

                  {/* Show notification button if installed */}
                  {isInstalled && !isSubscribed && isSupported && (
                    <Button onClick={subscribe} disabled={isLoading} className="w-full" size="lg">
                      <Bell className="w-5 h-5 mx-2" />
                      {t('installApp.enableNotificationsNow')}
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
                          {t('installApp.androidStep1Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.androidStep1Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">2</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <MoreVertical className="w-4 h-4" />
                          {t('installApp.androidStep2Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.androidStep2Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">3</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <Download className="w-4 h-4" />
                          {t('installApp.androidStep3Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.androidStep3Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">4</Badge>
                      <div>
                        <p className="font-medium">{t('installApp.confirmInstall')}</p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.androidStep4Desc')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {deferredPrompt && (
                    <Button onClick={handleInstallClick} className="w-full" size="lg">
                      <Download className="w-5 h-5 mx-2" />
                      {t('installApp.installNow')}
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
                          {t('installApp.desktopStep1Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.desktopStep1Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">2</Badge>
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <ArrowDown className="w-4 h-4" />
                          {t('installApp.desktopStep2Title')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.desktopStep2Desc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                      <Badge className="mt-1">3</Badge>
                      <div>
                        <p className="font-medium">{t('installApp.confirmInstall')}</p>
                        <p className="text-sm text-muted-foreground">
                          {t('installApp.desktopStep3Desc')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {deferredPrompt && (
                    <Button onClick={handleInstallClick} className="w-full" size="lg">
                      <Download className="w-5 h-5 mx-2" />
                      {t('installApp.installNow')}
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
            <CardTitle>{t('installApp.whyInstall')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{t('installApp.benefitPushTitle')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('installApp.benefitPushDesc')}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{t('installApp.benefitQuickAccessTitle')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('installApp.benefitQuickAccessDesc')}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{t('installApp.benefitAppExperienceTitle')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('installApp.benefitAppExperienceDesc')}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Check className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">{t('installApp.benefitAutoUpdatesTitle')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('installApp.benefitAutoUpdatesDesc')}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}

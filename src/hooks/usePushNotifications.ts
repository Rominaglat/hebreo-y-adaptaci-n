import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// VAPID public key is stored in backend secrets; we fetch it at runtime (it's safe to expose because it's public).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isPWA, setIsPWA] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);

  // Check if running as installed PWA
  const checkIfPWA = () => {
    // Check for iOS standalone mode
    const isIOSStandalone = ('standalone' in window.navigator) && (window.navigator as any).standalone === true;
    // Check for display-mode: standalone (works on Android and desktop)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    return isIOSStandalone || isStandalone;
  };

  const fetchVapidPublicKey = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('get-push-public-key');
    if (error) throw error;

    const key = (data as any)?.vapidPublicKey;
    if (!key || typeof key !== 'string') {
      throw new Error('Missing VAPID public key');
    }

    setVapidPublicKey(key);
    return key;
  }, []);

  // Check if push notifications are supported
  useEffect(() => {
    const checkSupport = async () => {
      const supported = 'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window;

      setIsSupported(supported);
      setIsPWA(checkIfPWA());

      if (supported && user) {
        await Promise.all([
          checkExistingSubscription(),
          fetchVapidPublicKey().catch((e) => {
            console.error('Error fetching VAPID public key:', e);
          }),
        ]);
      }
    };

    checkSupport();
  }, [user, fetchVapidPublicKey]);

  const checkExistingSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSub = await (registration as any).pushManager.getSubscription();
      
      if (existingSub) {
        setSubscription(existingSub);
        setIsSubscribed(true);
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  };

  const registerServiceWorker = async (): Promise<ServiceWorkerRegistration> => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Worker not supported');
    }

    // Register the service worker from the root
    // For iOS compatibility, use absolute path from origin
    const swUrl = '/sw.js';
    
    console.log('[push] Registering service worker:', swUrl);

    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
    });

    console.log('[push] Service worker registered, waiting for ready...');

    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;

    console.log('[push] Service worker ready');

    return registration;
  };

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      toast({
        title: 'לא נתמך',
        description: 'הדפדפן שלך לא תומך בהתראות פוש',
        variant: 'destructive',
      });
      return false;
    }

    if (!user) {
      toast({
        title: 'נדרשת התחברות',
        description: 'יש להתחבר כדי להפעיל התראות',
        variant: 'destructive',
      });
      return false;
    }

    setIsLoading(true);
    try {
      const ua = navigator.userAgent || '';
      const isIOS =
        /iphone|ipad|ipod/i.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      // On iOS, Web Push works only from an installed PWA opened from the Home Screen.
      const pwaNow = checkIfPWA();
      setIsPWA(pwaNow);

      console.log('[push] subscribe', {
        isIOS,
        isPWA: pwaNow,
        permission: Notification.permission,
      });

      if (isIOS && !pwaNow) {
        toast({
          title: 'צריך לפתוח מהמסך הבית',
          description: 'באייפון התראות פוש עובדות רק באפליקציה שמותקנת למסך הבית ונפתחת מהאייקון.',
          variant: 'destructive',
        });
        return false;
      }

      // Check current permission state first
      const currentPermission = Notification.permission;

      // If already denied, we can't request again - user must change in settings
      if (currentPermission === 'denied') {
        toast({
          title: 'התראות חסומות',
          description: isIOS
            ? 'באייפון צריך לאפשר ידנית דרך הגדרות > Notifications > (שם האפליקציה)'
            : 'יש לאפשר התראות בהגדרות הדפדפן',
          variant: 'destructive',
        });
        return false;
      }

      // Request notification permission
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        toast({
          title: 'יש לאשר התראות',
          description: isIOS
            ? 'כשתופיע בקשת ההרשאה של iOS, יש ללחוץ "אפשר"'
            : 'יש לאפשר התראות בחלון שיופיע',
          variant: 'destructive',
        });
        return false;
      }

      // Register service worker
      const registration = await registerServiceWorker();

      // Subscribe to push notifications
      const keyToUse = vapidPublicKey ?? (await fetchVapidPublicKey());
      const applicationServerKey = urlBase64ToUint8Array(keyToUse);

      const pushSubscription = await (registration as any).pushManager.subscribe({
        userVisibleOnly: true,
        // IMPORTANT: Safari/iOS expects a BufferSource here; TS types can be overly strict.
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });

      // Extract subscription keys
      const subscriptionJson = pushSubscription.toJSON();
      const keys = subscriptionJson.keys;

      if (!keys?.p256dh || !keys?.auth) {
        throw new Error('Invalid subscription keys');
      }

      // Save subscription to database
      // We keep ONE subscription per user (important for iOS/Safari reliability).
      const { error: deleteError } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', user.id);

      if (deleteError) {
        // Not fatal — we try to insert anyway
        console.warn('Error removing existing subscriptions (non-fatal):', deleteError);
      }

      const { error } = await supabase.from('push_subscriptions').insert({
        user_id: user.id,
        endpoint: pushSubscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      });

      if (error) {
        console.error('Error saving subscription:', error);
        throw error;
      }

      setSubscription(pushSubscription);
      setIsSubscribed(true);

      toast({
        title: 'התראות הופעלו',
        description: 'יישלחו התראות על הודעות חדשות',
      });

      return true;
    } catch (error) {
      console.error('Error subscribing to push:', error);
      const msg =
        (error as any)?.message ||
        (typeof error === 'string' ? error : 'Unknown error');

      toast({
        title: 'שגיאה בהפעלת התראות',
        description: `לא ניתן להפעיל התראות: ${String(msg).slice(0, 180)}`,
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, user, vapidPublicKey, fetchVapidPublicKey, toast]);

  const unsubscribe = useCallback(async () => {
    if (!user) return false;
    
    setIsLoading(true);
    try {
      // Unsubscribe from push manager
      if (subscription) {
        await subscription.unsubscribe();
      }
      
      // Remove from database
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', user.id);

      if (error) {
        console.error('Error removing subscription:', error);
      }
      
      setSubscription(null);
      setIsSubscribed(false);
      
      toast({
        title: 'התראות בוטלו',
        description: 'לא יישלחו יותר התראות על הודעות חדשות',
      });
      
      return true;
    } catch (error) {
      console.error('Error unsubscribing:', error);
      toast({
        title: 'שגיאה',
        description: 'לא ניתן לבטל התראות',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [user, subscription, toast]);

  return {
    isSupported,
    isSubscribed,
    isLoading,
    isPWA,
    subscribe,
    unsubscribe
  };
}

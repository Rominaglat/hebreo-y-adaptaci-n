import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface BrandingSettings {
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
}

interface ColorSettings {
  primary: string;
  accent: string;
  background: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarAccent: string;
}

interface PlatformSettings {
  branding: BrandingSettings;
  colors: ColorSettings;
}

interface PlatformContextType {
  settings: PlatformSettings;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  loading: boolean;
  refreshSettings: () => Promise<void>;
}

const defaultSettings: PlatformSettings = {
  branding: {
    name: 'LMS Platform',
    logo_url: null,
    favicon_url: null
  },
  colors: {
    primary: '275 60% 35%',
    accent: '45 90% 55%',
    background: '270 30% 98%',
    sidebar: '275 60% 35%',
    sidebarForeground: '45 100% 95%',
    sidebarAccent: '275 50% 30%'
  }
};

const PlatformContext = createContext<PlatformContextType | undefined>(undefined);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PlatformSettings>(defaultSettings);
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark') || 'light';
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    // Apply theme to document
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // Apply colors to CSS variables
    if (!loading) {
      applyColors(settings.colors, theme);
    }
  }, [settings.colors, theme, loading]);

  useEffect(() => {
    // Apply favicon from branding settings
    if (!loading && settings.branding.logo_url) {
      updateFavicon(settings.branding.logo_url);
    }
  }, [settings.branding.logo_url, loading]);

  const updateFavicon = (logoUrl: string) => {
    // Remove existing favicons
    const existingFavicons = document.querySelectorAll("link[rel*='icon']");
    existingFavicons.forEach(favicon => favicon.remove());

    // Create new favicon link
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = logoUrl;
    document.head.appendChild(link);

    // Also set apple-touch-icon for iOS
    const appleLink = document.createElement('link');
    appleLink.rel = 'apple-touch-icon';
    appleLink.href = logoUrl;
    document.head.appendChild(appleLink);
  };

  // platform_settings was dropped with the multi-tenancy schema. Platform-
  // level branding now comes from tenant_settings (singleton) via
  // TenantContext. Keep this function as a no-op so the wider initial-
  // load orchestration stays intact, but stop querying a table that
  // doesn't exist.
  const fetchSettings = async () => {
    setLoading(false);
  };

  const applyColors = (colors: ColorSettings, currentTheme: 'light' | 'dark') => {
    // Platform colors are only applied as fallback - tenant colors take priority
    // This is handled by TenantContext which applies its own branding
    // We only apply platform defaults if there's no tenant branding
  };

  const setTheme = (newTheme: 'light' | 'dark') => {
    // Use View Transitions API for a smooth crossfade if supported
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };
    if (doc.startViewTransition) {
      doc.startViewTransition(() => {
        setThemeState(newTheme);
      });
    } else {
      setThemeState(newTheme);
    }
  };

  const refreshSettings = async () => {
    await fetchSettings();
  };

  return (
    <PlatformContext.Provider value={{ settings, theme, setTheme, loading, refreshSettings }}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const context = useContext(PlatformContext);
  if (context === undefined) {
    throw new Error('usePlatform must be used within a PlatformProvider');
  }
  return context;
}

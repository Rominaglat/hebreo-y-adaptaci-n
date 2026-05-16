import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { SINGLE_TENANT_ID, SINGLE_TENANT_SLUG } from '@/constants/singleTenant';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  settings_logo_url?: string | null;
}

export interface TenantSettings {
  id: string;
  tenant_id: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  primary_color_dark: string | null;
  secondary_color_dark: string | null;
  accent_color_dark: string | null;
  foreground_color: string | null;
  foreground_color_dark: string | null;
  background_color: string | null;
  background_color_dark: string | null;
  custom_css: string | null;
  api_key: string | null;
  webhook_url: string | null;
  webhook_enabled: boolean | null;
  // AI assistant customization (per-tenant)
  ai_assistant_name: string | null;
  ai_assistant_avatar_url: string | null;
  ai_assistant_system_prompt: string | null;
}

interface TenantMembership {
  id: string;
  tenant_id: string;
  role: string;
  is_default: boolean;
  tenant: Tenant;
}

interface TenantContextType {
  currentTenant: Tenant | null;
  tenantSettings: TenantSettings | null;
  tenants: Tenant[];
  memberships: TenantMembership[];
  loading: boolean;
  settingsLoading: boolean;
  setCurrentTenant: (tenant: Tenant) => void;
  refreshTenants: () => Promise<void>;
  refreshTenantSettings: () => Promise<void>;
  reapplyBranding: () => void;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, role, setCurrentTenantId } = useAuth();
  const [currentTenant, setCurrentTenantState] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  
  const settingsRef = useRef<TenantSettings | null>(null);

  // Get current theme
  const getCurrentTheme = (): 'light' | 'dark' => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  };

  // Fetch tenant settings and apply branding using the RPC function that bypasses RLS
  const fetchTenantSettings = useCallback(async (tenantId: string) => {
    setSettingsLoading(true);
    try {
      // Use the get_tenant_branding function which is accessible to all tenant members
      const { data, error } = await supabase.rpc('get_tenant_branding', { _tenant_id: tenantId });

      if (error) {
        console.error('Error fetching tenant branding:', error);
        setTenantSettings(null);
        settingsRef.current = null;
        resetBranding();
        return;
      }

      // The function returns an array, take the first row
      const brandingData = Array.isArray(data) ? data[0] : data;

      if (brandingData) {
        const settings: TenantSettings = {
          id: tenantId,
          tenant_id: brandingData.tenant_id,
          logo_url: brandingData.logo_url,
          primary_color: brandingData.primary_color,
          secondary_color: brandingData.secondary_color,
          accent_color: brandingData.accent_color,
          primary_color_dark: null,
          secondary_color_dark: null,
          accent_color_dark: null,
          foreground_color: brandingData.foreground_color,
          foreground_color_dark: null,
          background_color: brandingData.background_color,
          background_color_dark: null,
          custom_css: brandingData.custom_css,
          api_key: null,
          webhook_url: null,
          webhook_enabled: null,
          ai_assistant_name: brandingData.ai_assistant_name ?? null,
          ai_assistant_avatar_url: brandingData.ai_assistant_avatar_url ?? null,
          ai_assistant_system_prompt: brandingData.ai_assistant_system_prompt ?? null,
        };
        setTenantSettings(settings);
        settingsRef.current = settings;
        applyTenantBranding(settings);
      } else {
        setTenantSettings(null);
        settingsRef.current = null;
        resetBranding();
      }
    } catch (error) {
      console.error('Error fetching tenant settings:', error);
      setTenantSettings(null);
      settingsRef.current = null;
      resetBranding();
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  // Apply tenant-specific branding - Auto-generates dark mode from light colors
  const applyTenantBranding = (settings: TenantSettings) => {
    const root = document.documentElement;
    const isDark = getCurrentTheme() === 'dark';

    // Use light mode colors as base and derive dark mode automatically
    const primaryColor = settings.primary_color;
    const secondaryColor = settings.secondary_color;
    const accentColor = settings.accent_color || settings.secondary_color;
    const backgroundColor = settings.background_color;
    const foregroundColor = settings.foreground_color;

    if (!primaryColor && !secondaryColor && !backgroundColor) {
      return;
    }

    // === PRIMARY COLOR ===
    if (primaryColor) {
      const primaryHsl = hexToHsl(primaryColor);
      if (primaryHsl) {
        // Adjust primary for dark mode - slightly brighter for visibility
        const adjustedPrimary = isDark ? adjustSaturationLightness(primaryHsl, 0, 10) : primaryHsl;
        
        root.style.setProperty('--primary', adjustedPrimary);
        root.style.setProperty('--ring', adjustedPrimary);
        root.style.setProperty('--primary-foreground', getContrastColor(primaryColor));
        
        // Sidebar uses primary color
        root.style.setProperty('--sidebar-background', primaryHsl);
        root.style.setProperty('--sidebar-primary', primaryHsl);
        root.style.setProperty('--sidebar-foreground', getContrastColor(primaryColor));
        root.style.setProperty('--sidebar-primary-foreground', getContrastColor(primaryColor));
        root.style.setProperty('--sidebar-accent', adjustLightness(primaryHsl, isDark ? 8 : -8));
        root.style.setProperty('--sidebar-accent-foreground', getContrastColor(primaryColor));
        root.style.setProperty('--sidebar-border', adjustLightness(primaryHsl, isDark ? 12 : -12));
        root.style.setProperty('--sidebar-ring', primaryHsl);
      }
    }
    
    // === SECONDARY COLOR ===
    if (secondaryColor) {
      const secondaryHsl = hexToHsl(secondaryColor);
      if (secondaryHsl) {
        if (isDark) {
          // Dark mode: secondary becomes a subtle dark surface with hint of brand color
          root.style.setProperty('--secondary', adjustSaturationLightness(secondaryHsl, -60, -55));
          root.style.setProperty('--secondary-foreground', '0 0% 95%');
        } else {
          // Light mode: secondary is a light tinted surface
          root.style.setProperty('--secondary', adjustSaturationLightness(secondaryHsl, -40, 40));
          root.style.setProperty('--secondary-foreground', '0 0% 10%');
        }
      }
    }

    // === ACCENT COLOR ===
    if (accentColor) {
      const accentHsl = hexToHsl(accentColor);
      if (accentHsl) {
        // Adjust accent for visibility in dark mode
        const adjustedAccent = isDark ? adjustSaturationLightness(accentHsl, 5, 10) : accentHsl;
        root.style.setProperty('--accent', adjustedAccent);
        root.style.setProperty('--accent-foreground', getContrastColor(accentColor));
      }
    }

    // === BACKGROUND & SURFACES ===
    if (isDark) {
      // Dark mode: Create a cohesive dark theme tinted from the tenant's primary color
      const brandHsl = primaryColor
        ? hexToHsl(primaryColor)
        : (secondaryColor ? hexToHsl(secondaryColor) : (backgroundColor ? hexToHsl(backgroundColor) : null));

      const brand = brandHsl ? parseHslParts(brandHsl) : null;

      if (brand) {
        // Make the tint visible (not pure black) while keeping it native-looking
        const tintS = Math.max(12, Math.min(26, Math.round(brand.s * 0.25)));
        const surfaceS = Math.max(10, tintS - 4);
        const mutedS = Math.max(10, tintS - 6);
        const borderS = Math.max(12, tintS - 2);

        root.style.setProperty('--background', `${brand.h} ${tintS}% 10%`);
        root.style.setProperty('--foreground', foregroundColor && hexToHsl(foregroundColor) ? hexToHsl(foregroundColor)! : '0 0% 95%');

        root.style.setProperty('--card', `${brand.h} ${surfaceS}% 13%`);
        root.style.setProperty('--card-foreground', foregroundColor && hexToHsl(foregroundColor) ? hexToHsl(foregroundColor)! : '0 0% 95%');

        root.style.setProperty('--popover', `${brand.h} ${surfaceS}% 13%`);
        root.style.setProperty('--popover-foreground', foregroundColor && hexToHsl(foregroundColor) ? hexToHsl(foregroundColor)! : '0 0% 95%');

        root.style.setProperty('--muted', `${brand.h} ${mutedS}% 18%`);
        root.style.setProperty('--muted-foreground', '0 0% 65%');

        root.style.setProperty('--border', `${brand.h} ${borderS}% 23%`);
        root.style.setProperty('--input', `${brand.h} ${borderS}% 23%`);
      }
    } else {
      // Light mode: Use background and foreground colors if set
      if (backgroundColor) {
        const backgroundHsl = hexToHsl(backgroundColor);
        if (backgroundHsl) {
          const bgLuminance = getLuminance(backgroundColor);
          
          root.style.setProperty('--background', backgroundHsl);
          
          // Use foreground color if set, otherwise compute from background
          if (foregroundColor) {
            const foregroundHsl = hexToHsl(foregroundColor);
            if (foregroundHsl) {
              root.style.setProperty('--foreground', foregroundHsl);
              root.style.setProperty('--card-foreground', foregroundHsl);
              root.style.setProperty('--popover-foreground', foregroundHsl);
            }
          } else {
            root.style.setProperty('--foreground', getContrastColor(backgroundColor));
            root.style.setProperty('--card-foreground', getContrastColor(backgroundColor));
            root.style.setProperty('--popover-foreground', getContrastColor(backgroundColor));
          }
          
          const cardDelta = bgLuminance > 0.92 ? 2 : 3;
          root.style.setProperty('--card', adjustLightness(backgroundHsl, cardDelta));
          root.style.setProperty('--popover', adjustLightness(backgroundHsl, cardDelta));
          root.style.setProperty('--muted', adjustLightness(backgroundHsl, -7));
          root.style.setProperty('--muted-foreground', '0 0% 40%');
          root.style.setProperty('--border', adjustLightness(backgroundHsl, -12));
          root.style.setProperty('--input', adjustLightness(backgroundHsl, -12));
        }
      }
    }

    // Destructive - always visible
    root.style.setProperty('--destructive', isDark ? '0 75% 55%' : '0 84% 50%');
    root.style.setProperty('--destructive-foreground', '0 0% 100%');

    // Apply custom CSS if provided
    applyCustomCSS(settings.custom_css);

    // Update favicon with tenant logo
    if (settings.logo_url) {
      updateFavicon(settings.logo_url);
    }
  };

  // Adjust both saturation and lightness of HSL color
  const adjustSaturationLightness = (hsl: string, satAmount: number, lightAmount: number): string => {
    const parts = hsl.split(' ');
    if (parts.length < 3) return hsl;

    const h = parts[0];
    const sValue = parseFloat(parts[1]);
    const lValue = parseFloat(parts[2]);

    const newS = Math.max(0, Math.min(100, sValue + satAmount));
    const newL = Math.max(0, Math.min(100, lValue + lightAmount));

    return `${h} ${newS}% ${newL}%`;
  };

  const parseHslParts = (hsl: string): { h: number; s: number; l: number } | null => {
    const match = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(hsl.trim());
    if (!match) return null;
    return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
  };

  // Get contrast color (light or dark) based on best contrast ratio
  const getContrastColor = (hexColor: string): string => {
    const lum = getLuminance(hexColor);
    return lum > 0.5 ? '0 0% 10%' : '0 0% 98%';
  };

  // Get luminance of a color (0-1)
  const getLuminance = (hex: string): number => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return 0.5;
    
    const r = parseInt(result[1], 16) / 255;
    const g = parseInt(result[2], 16) / 255;
    const b = parseInt(result[3], 16) / 255;
    
    const [rSRGB, gSRGB, bSRGB] = [r, g, b].map(c => 
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
    
    return 0.2126 * rSRGB + 0.7152 * gSRGB + 0.0722 * bSRGB;
  };

  // Adjust lightness of HSL color
  const adjustLightness = (hsl: string, amount: number): string => {
    const parts = hsl.split(' ');
    if (parts.length < 3) return hsl;
    
    const h = parts[0];
    const s = parts[1];
    const lValue = parseFloat(parts[2]);
    const newL = Math.max(0, Math.min(100, lValue + amount));
    
    return `${h} ${s} ${newL}%`;
  };

  // Reset branding to defaults
  const resetBranding = () => {
    const root = document.documentElement;
    const propsToReset = [
      '--primary', '--primary-foreground',
      '--secondary', '--secondary-foreground',
      '--accent', '--accent-foreground',
      '--foreground', '--background',
      '--card', '--card-foreground',
      '--popover', '--popover-foreground',
      '--muted', '--muted-foreground',
      '--border', '--input', '--ring',
      '--destructive', '--destructive-foreground',
      '--sidebar-background', '--sidebar-foreground',
      '--sidebar-primary', '--sidebar-primary-foreground',
      '--sidebar-accent', '--sidebar-accent-foreground',
      '--sidebar-border', '--sidebar-ring'
    ];
    
    propsToReset.forEach(prop => root.style.removeProperty(prop));
    removeCustomCSS();
  };

  // Apply custom CSS
  const applyCustomCSS = (css: string | null) => {
    removeCustomCSS();
    if (css) {
      const style = document.createElement('style');
      style.id = 'tenant-custom-css';
      style.textContent = css;
      document.head.appendChild(style);
    }
  };

  // Remove custom CSS
  const removeCustomCSS = () => {
    const existing = document.getElementById('tenant-custom-css');
    if (existing) {
      existing.remove();
    }
  };

  // Update favicon
  const updateFavicon = (logoUrl: string) => {
    const existingFavicons = document.querySelectorAll("link[rel*='icon']");
    existingFavicons.forEach(favicon => favicon.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = logoUrl;
    document.head.appendChild(link);

    const appleLink = document.createElement('link');
    appleLink.rel = 'apple-touch-icon';
    appleLink.href = logoUrl;
    document.head.appendChild(appleLink);
  };

  // Convert hex to HSL
  const hexToHsl = (hex: string): string | null => {
    if (!hex || !hex.startsWith('#')) return null;
    
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;

    let r = parseInt(result[1], 16) / 255;
    let g = parseInt(result[2], 16) / 255;
    let b = parseInt(result[3], 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  };

  useEffect(() => {
    if (user) {
      fetchTenants();
    } else {
      setTenants([]);
      setMemberships([]);
      setCurrentTenantState(null);
      setTenantSettings(null);
      setLoading(false);
      resetBranding();
    }
  }, [user, role]);

  // Load tenant settings when current tenant changes
  useEffect(() => {
    if (currentTenant) {
      fetchTenantSettings(currentTenant.id);
    }
  }, [currentTenant, fetchTenantSettings]);

  // Listen for theme changes and reapply branding
  useEffect(() => {
    const handleThemeChange = () => {
      if (settingsRef.current) {
        applyTenantBranding(settingsRef.current);
      }
    };

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          // Use setTimeout to ensure the class has been fully applied
          setTimeout(handleThemeChange, 0);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // Single-tenant build: synthesize the tenant object from constants
  // instead of querying the (now-dropped) tenants table. Branding still
  // comes from tenant_settings (which is now a singleton row).
  const fetchTenants = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const stubTenant: Tenant = {
        id: SINGLE_TENANT_ID,
        name: 'Learning Portal',
        slug: SINGLE_TENANT_SLUG,
        logo_url: null,
        is_active: true,
        created_at: new Date(0).toISOString(),
      };
      setTenants([stubTenant]);
      setMemberships([]);
      setCurrentTenantState(stubTenant);
      setCurrentTenantId(stubTenant.id);
    } finally {
      setLoading(false);
    }
  };

  // Kept for API compatibility with existing call sites — switching is a
  // no-op in single-tenant mode.
  const setCurrentTenant = (_tenant: Tenant) => {
    /* no-op in single-tenant mode */
  };

  const refreshTenants = async () => {
    await fetchTenants();
  };

  const refreshTenantSettings = async () => {
    if (currentTenant) {
      await fetchTenantSettings(currentTenant.id);
    }
  };

  const reapplyBranding = () => {
    if (settingsRef.current) {
      applyTenantBranding(settingsRef.current);
    }
  };

  return (
    <TenantContext.Provider value={{
      currentTenant,
      tenantSettings,
      tenants,
      memberships,
      loading,
      settingsLoading,
      setCurrentTenant,
      refreshTenants,
      refreshTenantSettings,
      reapplyBranding
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}

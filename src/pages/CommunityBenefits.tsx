import { useEffect, useState } from 'react';
import { 
  Gift, 
  Plus, 
  Phone,
  Loader2,
  Trash2,
  Filter,
  MessageCircle,
  ExternalLink,
  Link,
  BarChart3,
  Pencil,
  Settings,
  X
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { he, enUS } from 'date-fns/locale';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Benefit {
  id: string;
  title: string;
  description: string;
  category: string;
  phone_number: string | null;
  link_url: string | null;
  logo_url: string | null;
  created_at: string;
  is_active: boolean;
}

interface ClickData {
  date: string;
  clicks: number;
}

interface Category {
  id: string;
  value: string;
  label_he: string;
  label_en: string;
  label_es?: string | null;
  color: string;
  order_index: number;
}

// Default categories for fallback
const defaultCategories: Category[] = [
  { id: '1', value: 'marketing', label_he: 'שיווק', label_en: 'Marketing', label_es: 'Marketing', color: 'pink', order_index: 0 },
  { id: '2', value: 'sales', label_he: 'מכירות', label_en: 'Sales', label_es: 'Ventas', color: 'green', order_index: 1 },
  { id: '3', value: 'finance', label_he: 'פיננסים', label_en: 'Finance', label_es: 'Finanzas', color: 'blue', order_index: 2 },
  { id: '4', value: 'logistics', label_he: 'לוגיסטיקה', label_en: 'Logistics', label_es: 'Logística', color: 'orange', order_index: 3 },
  { id: '5', value: 'technology', label_he: 'טכנולוגיה', label_en: 'Technology', label_es: 'Tecnología', color: 'purple', order_index: 4 },
  { id: '6', value: 'legal', label_he: 'משפטים', label_en: 'Legal', label_es: 'Legal', color: 'amber', order_index: 5 },
];

const colorOptions = [
  { value: 'pink', labelHe: 'ורוד', labelEn: 'Pink', labelEs: 'Rosa' },
  { value: 'green', labelHe: 'ירוק', labelEn: 'Green', labelEs: 'Verde' },
  { value: 'blue', labelHe: 'כחול', labelEn: 'Blue', labelEs: 'Azul' },
  { value: 'orange', labelHe: 'כתום', labelEn: 'Orange', labelEs: 'Naranja' },
  { value: 'purple', labelHe: 'סגול', labelEn: 'Purple', labelEs: 'Morado' },
  { value: 'amber', labelHe: 'ענבר', labelEn: 'Amber', labelEs: 'Ámbar' },
  { value: 'red', labelHe: 'אדום', labelEn: 'Red', labelEs: 'Rojo' },
  { value: 'teal', labelHe: 'טורקיז', labelEn: 'Teal', labelEs: 'Verde azulado' },
  { value: 'gray', labelHe: 'אפור', labelEn: 'Gray', labelEs: 'Gris' },
];

const getBenefitSchema = (
  categoryValues: string[],
  t: (key: string) => string
) => z.object({
  title: z.string().trim().min(2, t('benefitsPage.validation.titleMin')).max(100),
  description: z.string().trim().min(10, t('benefitsPage.validation.descriptionMin')).max(1000),
  category: z.string().refine(val => categoryValues.includes(val), t('benefitsPage.validation.invalidCategory')),
  phone_number: z.string().trim().max(15).optional().or(z.literal('')),
  link_url: z.string().url(t('benefitsPage.validation.invalidLink')).optional().or(z.literal('')),
  logo_url: z.string().url().optional().or(z.literal('')),
  contactType: z.enum(['phone', 'link']),
}).refine(data => {
  if (data.contactType === 'phone') {
    return data.phone_number && data.phone_number.length >= 9;
  } else {
    return data.link_url && data.link_url.length > 0;
  }
}, {
  message: t('benefitsPage.validation.requiredValue'),
  path: ['phone_number'],
});

export default function CommunityBenefits() {
  const { user, isAdmin } = useAuth();
  const { language, t } = useLanguage();
  const { toast } = useToast();
  
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [contactType, setContactType] = useState<'phone' | 'link'>('phone');
  const [analyticsDialogOpen, setAnalyticsDialogOpen] = useState(false);
  const [selectedBenefitForAnalytics, setSelectedBenefitForAnalytics] = useState<Benefit | null>(null);
  const [clicksData, setClicksData] = useState<ClickData[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [editingBenefit, setEditingBenefit] = useState<Benefit | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Dynamic categories
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [categoriesDialogOpen, setCategoriesDialogOpen] = useState(false);
  const [newCategory, setNewCategory] = useState({ value: '', label_he: '', label_en: '', color: 'gray' });
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  
  const [newBenefit, setNewBenefit] = useState({
    title: '',
    description: '',
    category: defaultCategories[0].value,
    phone_number: '',
    link_url: '',
    logo_url: ''
  });

  useEffect(() => {
    fetchCategories();
    fetchBenefits();

    const benefitsChannel = supabase
      .channel('benefits-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_benefits' },
        () => fetchBenefits()
      )
      .subscribe();

    const categoriesChannel = supabase
      .channel('categories-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'benefit_categories' },
        () => fetchCategories()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(benefitsChannel);
      supabase.removeChannel(categoriesChannel);
    };
  }, [user, isAdmin]);

  const ensureDefaultCategories = async (existing: Category[]) => {
    if (!user) return existing;

    const existingValues = new Set(existing.map((c) => c.value));
    const missingDefaults = defaultCategories.filter((c) => !existingValues.has(c.value));

    if (missingDefaults.length === 0) return existing;

    const maxOrderIndex = existing.reduce((max, c) => Math.max(max, c.order_index ?? 0), -1);

    const rows = missingDefaults.map((cat, index) => ({
      value: cat.value,
      label_he: cat.label_he,
      label_en: cat.label_en,
      color: cat.color,
      order_index: maxOrderIndex + 1 + index,
      created_by: user.id,
    }));

    const { error } = await supabase.from('benefit_categories').insert(rows);
    if (error) throw error;

    const { data, error: refetchError } = await supabase
      .from('benefit_categories')
      .select('*')
      .order('order_index', { ascending: true });

    if (refetchError) throw refetchError;

    return data ?? existing;
  };

  const fetchCategories = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('benefit_categories')
        .select('*')
        .order('order_index', { ascending: true });

      if (error) throw error;

      const existing = (data as Category[]) || [];

      // If an admin added a custom category before defaults were seeded,
      // we still want to keep the baseline defaults so editing/creating doesn't break.
      const finalCategories = isAdmin ? await ensureDefaultCategories(existing) : existing;

      const safeCategories = finalCategories.length > 0 ? finalCategories : defaultCategories;
      setCategories(safeCategories);

      const validValues = new Set(safeCategories.map((c) => c.value));
      setNewBenefit((prev) => {
        const nextCategory = validValues.has(prev.category)
          ? prev.category
          : (safeCategories[0]?.value ?? defaultCategories[0].value);
        return prev.category === nextCategory ? prev : { ...prev, category: nextCategory };
      });
    } catch (error) {
      console.error('Error fetching categories:', error);
      setCategories(defaultCategories);

      const validValues = new Set(defaultCategories.map((c) => c.value));
      setNewBenefit((prev) => {
        const nextCategory = validValues.has(prev.category) ? prev.category : defaultCategories[0].value;
        return prev.category === nextCategory ? prev : { ...prev, category: nextCategory };
      });
    }
  };

  const handleAddCategory = async () => {
    if (!user) return;
    if (!newCategory.value || !newCategory.label_he || !newCategory.label_en) {
      toast({
        title: t('common.error'),
        description: t('benefitsPage.allFieldsRequired'),
        variant: 'destructive',
      });
      return;
    }

    setIsAddingCategory(true);
    try {
      const { error } = await supabase
        .from('benefit_categories')
        .insert({
          value: newCategory.value.toLowerCase().replace(/\s+/g, '_'),
          label_he: newCategory.label_he.trim(),
          label_en: newCategory.label_en.trim(),
          color: newCategory.color,
          order_index: categories.length,
          created_by: user.id
        });

      if (error) throw error;

      toast({
        title: t('benefitsPage.categoryAdded'),
      });

      setNewCategory({ value: '', label_he: '', label_en: '', color: 'gray' });
      fetchCategories();
    } catch (error: any) {
      console.error('Error adding category:', error);
      toast({
        title: t('common.error'),
        description: error.message?.includes('duplicate')
          ? t('benefitsPage.categoryDuplicate')
          : t('benefitsPage.categoryAddError'),
        variant: 'destructive',
      });
    } finally {
      setIsAddingCategory(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    setDeletingCategoryId(categoryId);
    try {
      const { error } = await supabase
        .from('benefit_categories')
        .delete()
        .eq('id', categoryId);

      if (error) throw error;

      toast({
        title: t('benefitsPage.categoryDeleted'),
      });

      fetchCategories();
    } catch (error) {
      console.error('Error deleting category:', error);
      toast({
        title: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const fetchBenefits = async () => {
    try {
      // Select all fields except phone_number for non-admins (security)
      const { data, error } = await supabase
        .from('community_benefits')
        .select('id, title, description, category, logo_url, link_url, created_at, is_active, phone_number')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Show all data including phone numbers to all users
      setBenefits(data || []);
    } catch (error) {
      console.error('Error fetching benefits:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBenefit = async () => {
    if (!user) return;

    setErrors({});
    const categoryValues = categories.map(c => c.value);
    const result = getBenefitSchema(categoryValues, t).safeParse({ ...newBenefit, contactType });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsCreating(true);

    try {
      const { error } = await supabase
        .from('community_benefits')
        .insert({
          title: newBenefit.title.trim(),
          description: newBenefit.description.trim(),
          category: newBenefit.category,
          phone_number: newBenefit.phone_number.trim() || null,
          link_url: newBenefit.link_url.trim() || null,
          logo_url: newBenefit.logo_url.trim() || null,
          created_by: user.id,
        });

      if (error) throw error;

      toast({
        title: t('benefitsPage.benefitPublished'),
        description: t('benefitsPage.benefitPublishedDesc'),
      });

      const resetCategory = categories[0]?.value ?? defaultCategories[0].value;
      setNewBenefit({ title: '', description: '', category: resetCategory, phone_number: '', link_url: '', logo_url: '' });
      setDialogOpen(false);
      fetchBenefits();
    } catch (error) {
      console.error('Error creating benefit:', error);
      toast({
        title: t('common.error'),
        description: t('benefitsPage.benefitCreateError'),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteBenefit = async (id: string) => {
    try {
      const { error } = await supabase
        .from('community_benefits')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: t('benefitsPage.benefitDeleted'),
      });

      fetchBenefits();
    } catch (error) {
      console.error('Error deleting benefit:', error);
      toast({
        title: t('common.error'),
        variant: 'destructive',
      });
    }
  };

  const openEditDialog = (benefit: Benefit) => {
    setEditingBenefit(benefit);
    setNewBenefit({
      title: benefit.title,
      description: benefit.description,
      category: benefit.category,
      phone_number: benefit.phone_number || '',
      link_url: benefit.link_url || '',
      logo_url: benefit.logo_url || ''
    });
    setContactType(benefit.phone_number ? 'phone' : 'link');
    setErrors({});
    setEditDialogOpen(true);
  };

  const handleUpdateBenefit = async () => {
    if (!user || !editingBenefit) return;

    setErrors({});
    const categoryValues = categories.map(c => c.value);
    const result = getBenefitSchema(categoryValues, t).safeParse({ ...newBenefit, contactType });
    
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsUpdating(true);

    try {
      const { error } = await supabase
        .from('community_benefits')
        .update({
          title: newBenefit.title.trim(),
          description: newBenefit.description.trim(),
          category: newBenefit.category,
          phone_number: newBenefit.phone_number.trim() || null,
          link_url: newBenefit.link_url.trim() || null,
          logo_url: newBenefit.logo_url.trim() || null,
        })
        .eq('id', editingBenefit.id);

      if (error) throw error;

      toast({
        title: t('benefitsPage.benefitUpdated'),
        description: t('benefitsPage.benefitUpdatedDesc'),
      });

      const resetCategory = categories[0]?.value ?? defaultCategories[0].value;
      setNewBenefit({ title: '', description: '', category: resetCategory, phone_number: '', link_url: '', logo_url: '' });
      setEditDialogOpen(false);
      setEditingBenefit(null);
      fetchBenefits();
    } catch (error) {
      console.error('Error updating benefit:', error);
      toast({
        title: t('common.error'),
        description: t('benefitsPage.benefitUpdateError'),
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const trackClick = async (benefitId: string, clickType: 'phone' | 'whatsapp' | 'link' | 'view', benefitTitle: string) => {
    if (!user) return;
    
    try {
      // Insert click tracking
      await supabase.from('benefit_clicks').insert({
        benefit_id: benefitId,
        user_id: user.id,
        click_type: clickType
      });

      // Log audit activity with benefit title for easy identification
      await supabase.rpc('log_user_activity', {
        p_user_id: user.id,
        p_activity_type: 'benefit_click',
        p_description: t('benefitsPage.activityClick').replace('{title}', benefitTitle).replace('{type}', clickType),
        p_entity_type: 'benefit',
        p_entity_id: benefitId,
        p_action: clickType,
        p_metadata: { 
          click_type: clickType,
          benefit_title: benefitTitle
        }
      });
    } catch (error) {
      console.error('Error tracking click:', error);
    }
  };

  const fetchAnalytics = async (benefitId: string) => {
    setLoadingAnalytics(true);
    try {
      const thirtyDaysAgo = subDays(new Date(), 30);
      
      const { data, error } = await supabase
        .from('benefit_clicks')
        .select('created_at')
        .eq('benefit_id', benefitId)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group by date
      const clicksByDate: Record<string, number> = {};
      for (let i = 0; i < 30; i++) {
        const date = format(subDays(new Date(), 29 - i), 'dd/MM');
        clicksByDate[date] = 0;
      }

      (data || []).forEach(click => {
        const date = format(new Date(click.created_at), 'dd/MM');
        if (clicksByDate[date] !== undefined) {
          clicksByDate[date]++;
        }
      });

      const chartData: ClickData[] = Object.entries(clicksByDate).map(([date, clicks]) => ({
        date,
        clicks
      }));

      setClicksData(chartData);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const openAnalyticsDialog = (benefit: Benefit) => {
    setSelectedBenefitForAnalytics(benefit);
    setAnalyticsDialogOpen(true);
    fetchAnalytics(benefit.id);
  };

  const getWhatsAppUrl = (phoneNumber: string) => {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const message = encodeURIComponent(t('benefitsPage.whatsappMessage'));
    return `https://wa.me/${cleanPhone}?text=${message}`;
  };

  const getCategoryLabel = (category: string) => {
    const cat = categories.find(c => c.value === category);
    if (!cat) return category;
    if (language === 'he') return cat.label_he;
    if (language === 'es') return cat.label_es || cat.label_en;
    return cat.label_en;
  };

  const getCategoryColor = (category: string) => {
    const cat = categories.find(c => c.value === category);
    const colorName = cat?.color || 'gray';
    const colorMap: Record<string, string> = {
      'pink': 'bg-pink-500/10 text-pink-600 border-pink-500/20',
      'green': 'bg-green-500/10 text-green-600 border-green-500/20',
      'blue': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      'orange': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
      'purple': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
      'amber': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
      'red': 'bg-red-500/10 text-red-600 border-red-500/20',
      'teal': 'bg-teal-500/10 text-teal-600 border-teal-500/20',
      'gray': 'bg-muted text-muted-foreground',
    };
    return colorMap[colorName] || colorMap['gray'];
  };

  const filteredBenefits = benefits.filter(benefit => 
    categoryFilter === 'all' || benefit.category === categoryFilter
  );

  return (
      <div className="space-y-6 overflow-x-hidden">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t('nav.communityBenefits')}
            </h1>
            <p className="text-muted-foreground mt-1.5">
              {t('benefitsPage.headerSubtitle')}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <Filter className="w-4 h-4 ml-2" />
                <SelectValue placeholder={t('benefitsPage.allCategories')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('benefitsPage.allCategories')}
                </SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {language === 'he' ? cat.label_he : language === 'es' ? (cat.label_es || cat.label_en) : cat.label_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isAdmin && (
              <div className="flex flex-col sm:flex-row gap-2">
                {/* Manage Categories Button */}
                <Button
                  variant="outline"
                  onClick={() => setCategoriesDialogOpen(true)}
                  className="flex-1 sm:flex-none"
                >
                  <Settings className="w-4 h-4 mx-2" />
                  <span className="hidden sm:inline">{t('benefitsPage.manageCategories')}</span>
                  <span className="sm:hidden">{t('benefitsPage.categoriesShort')}</span>
                </Button>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="flex-1 sm:flex-none">
                      <Plus className="w-4 h-4 mx-2" />
                      {t('benefitsPage.addBenefit')}
                    </Button>
                  </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      {t('benefitsPage.addNewBenefit')}
                    </DialogTitle>
                    <DialogDescription>
                      {t('benefitsPage.addNewBenefitDesc')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="title">
                        {t('benefitsPage.benefitName')}
                      </Label>
                      <Input
                        id="title"
                        placeholder={t('benefitsPage.benefitNamePlaceholder')}
                        value={newBenefit.title}
                        onChange={(e) => setNewBenefit({ ...newBenefit, title: e.target.value })}
                      />
                      {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">
                        {t('benefitsPage.benefitDescription')}
                      </Label>
                      <Textarea
                        id="description"
                        placeholder={t('benefitsPage.benefitDescriptionPlaceholder')}
                        className="min-h-[100px]"
                        value={newBenefit.description}
                        onChange={(e) => setNewBenefit({ ...newBenefit, description: e.target.value })}
                      />
                      {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">
                        {t('studyRooms.category')}
                      </Label>
                      <Select 
                        value={newBenefit.category} 
                        onValueChange={(v) => setNewBenefit({ ...newBenefit, category: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('benefitsPage.chooseCategory')} />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {language === 'he' ? cat.label_he : language === 'es' ? (cat.label_es || cat.label_en) : cat.label_en}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.category && <p className="text-sm text-destructive">{errors.category}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label>
                        {t('benefitsPage.contactType')}
                      </Label>
                      <Select 
                        value={contactType} 
                        onValueChange={(v: 'phone' | 'link') => {
                          setContactType(v);
                          setNewBenefit({ ...newBenefit, phone_number: '', link_url: '' });
                        }}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          <SelectItem value="phone">
                            {t('benefitsPage.phoneWhatsapp')}
                          </SelectItem>
                          <SelectItem value="link">
                            {t('benefitsPage.link')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {contactType === 'phone' && (
                      <div className="space-y-2">
                        <Label htmlFor="phone">
                          {t('profile.phoneNumber')}
                        </Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="972501234567"
                          value={newBenefit.phone_number}
                          onChange={(e) => setNewBenefit({ ...newBenefit, phone_number: e.target.value })}
                        />
                        {errors.phone_number && <p className="text-sm text-destructive">{errors.phone_number}</p>}
                        <p className="text-xs text-muted-foreground">
                          {t('benefitsPage.phoneFormatHint')}
                        </p>
                      </div>
                    )}

                    {contactType === 'link' && (
                      <div className="space-y-2">
                        <Label htmlFor="link">
                          {t('benefitsPage.link')}
                        </Label>
                        <Input
                          id="link"
                          type="url"
                          placeholder="https://..."
                          value={newBenefit.link_url}
                          onChange={(e) => setNewBenefit({ ...newBenefit, link_url: e.target.value })}
                        />
                        {errors.link_url && <p className="text-sm text-destructive">{errors.link_url}</p>}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="logo">
                        {t('benefitsPage.logoOptional')}
                      </Label>
                      <Input
                        id="logo"
                        type="url"
                        placeholder="https://..."
                        value={newBenefit.logo_url}
                        onChange={(e) => setNewBenefit({ ...newBenefit, logo_url: e.target.value })}
                      />
                    </div>

                    <Button 
                      className="w-full" 
                      onClick={handleCreateBenefit}
                      disabled={isCreating}
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                          {t('benefitsPage.publishing')}
                        </>
                      ) : (
                        t('benefitsPage.publishBenefit')
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              </div>
            )}
          </div>
        </div>

        {/* Benefits Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filteredBenefits.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Gift className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {t('benefitsPage.noBenefits')}
              </h3>
              <p className="text-muted-foreground">
                {categoryFilter !== 'all'
                  ? t('benefitsPage.noBenefitsInCategory')
                  : t('benefitsPage.noBenefitsDesc')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredBenefits.map((benefit) => (
              <Card key={benefit.id} className="relative overflow-hidden group hover:shadow-lg transition-shadow flex flex-col">
                {isAdmin && (
                  <div className="absolute top-2 left-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-primary"
                      onClick={() => openEditDialog(benefit)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t('benefitsPage.deleteBenefit')}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('benefitsPage.deleteBenefitConfirm')}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="flex-row-reverse gap-2">
                          <AlertDialogCancel>
                            {t('common.cancel')}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteBenefit(benefit.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t('common.delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-primary"
                      onClick={() => openAnalyticsDialog(benefit)}
                    >
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    {benefit.logo_url ? (
                      <img
                        src={benefit.logo_url}
                        alt={benefit.title}
                        className="w-12 h-12 rounded-lg object-contain bg-muted flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Gift className="w-6 h-6 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base line-clamp-2 min-h-[2.5rem]">{benefit.title}</CardTitle>
                      <Badge variant="outline" className={`mt-1.5 text-xs ${getCategoryColor(benefit.category)}`}>
                        {getCategoryLabel(benefit.category)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col flex-1">
                  <p className="text-sm text-muted-foreground line-clamp-3 min-h-[3.75rem]">
                    {benefit.description}
                  </p>

                  <div className="mt-auto pt-4">
                    {/* Show link button to all users */}
                    {benefit.link_url && (
                      <a
                        href={benefit.link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackClick(benefit.id, 'link', benefit.title)}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {t('benefitsPage.viewDetails')}
                      </a>
                    )}

                    {/* Call and WhatsApp buttons - visible to all users */}
                    {benefit.phone_number && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <a
                          href={`tel:${benefit.phone_number.replace(/\D/g, '')}`}
                          onClick={() => trackClick(benefit.id, 'phone', benefit.title)}
                          className="flex items-center justify-center gap-2 w-full sm:flex-1 py-2.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors"
                        >
                          <Phone className="w-4 h-4" />
                          {t('benefitsPage.call')}
                        </a>
                        <a
                          href={getWhatsAppUrl(benefit.phone_number)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackClick(benefit.id, 'whatsapp', benefit.title)}
                          className="flex items-center justify-center gap-2 w-full sm:flex-1 py-2.5 rounded-md bg-[#25D366] hover:bg-[#20BD5A] text-white font-medium transition-colors"
                        >
                          <MessageCircle className="w-4 h-4" />
                          {t('benefitsPage.whatsapp')}
                        </a>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Edit Benefit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            const resetCategory = categories[0]?.value ?? defaultCategories[0].value;
            setEditingBenefit(null);
            setNewBenefit({ title: '', description: '', category: resetCategory, phone_number: '', link_url: '', logo_url: '' });
            setErrors({});
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t('benefitsPage.editBenefit')}
              </DialogTitle>
              <DialogDescription>
                {t('benefitsPage.editBenefitDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">
                  {t('benefitsPage.benefitName')}
                </Label>
                <Input
                  id="edit-title"
                  placeholder={t('benefitsPage.benefitNamePlaceholder')}
                  value={newBenefit.title}
                  onChange={(e) => setNewBenefit({ ...newBenefit, title: e.target.value })}
                />
                {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">
                  {t('benefitsPage.benefitDescription')}
                </Label>
                <Textarea
                  id="edit-description"
                  placeholder={t('benefitsPage.benefitDescriptionPlaceholder')}
                  className="min-h-[100px]"
                  value={newBenefit.description}
                  onChange={(e) => setNewBenefit({ ...newBenefit, description: e.target.value })}
                />
                {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-category">
                  {t('studyRooms.category')}
                </Label>
                <Select 
                  value={newBenefit.category} 
                  onValueChange={(v) => setNewBenefit({ ...newBenefit, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('benefitsPage.chooseCategory')} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {language === 'he' ? cat.label_he : language === 'es' ? (cat.label_es || cat.label_en) : cat.label_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && <p className="text-sm text-destructive">{errors.category}</p>}
              </div>

              <div className="space-y-2">
                <Label>
                  {t('benefitsPage.contactType')}
                </Label>
                <Select 
                  value={contactType} 
                  onValueChange={(v: 'phone' | 'link') => {
                    setContactType(v);
                    setNewBenefit({ ...newBenefit, phone_number: '', link_url: '' });
                  }}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="phone">
                      {t('benefitsPage.phoneWhatsapp')}
                    </SelectItem>
                    <SelectItem value="link">
                      {t('benefitsPage.link')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {contactType === 'phone' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-phone">
                    {t('profile.phoneNumber')}
                  </Label>
                  <Input
                    id="edit-phone"
                    type="tel"
                    placeholder="972501234567"
                    value={newBenefit.phone_number}
                    onChange={(e) => setNewBenefit({ ...newBenefit, phone_number: e.target.value })}
                  />
                  {errors.phone_number && <p className="text-sm text-destructive">{errors.phone_number}</p>}
                  <p className="text-xs text-muted-foreground">
                    {t('benefitsPage.phoneFormatHint')}
                  </p>
                </div>
              )}

              {contactType === 'link' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-link">
                    {t('benefitsPage.link')}
                  </Label>
                  <Input
                    id="edit-link"
                    type="url"
                    placeholder="https://..."
                    value={newBenefit.link_url}
                    onChange={(e) => setNewBenefit({ ...newBenefit, link_url: e.target.value })}
                  />
                  {errors.link_url && <p className="text-sm text-destructive">{errors.link_url}</p>}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="edit-logo">
                  {t('benefitsPage.logoOptional')}
                </Label>
                <Input
                  id="edit-logo"
                  type="url"
                  placeholder="https://..."
                  value={newBenefit.logo_url}
                  onChange={(e) => setNewBenefit({ ...newBenefit, logo_url: e.target.value })}
                />
              </div>

              <Button 
                className="w-full" 
                onClick={handleUpdateBenefit}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                    {t('benefitsPage.updating')}
                  </>
                ) : (
                  t('benefitsPage.updateBenefit')
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Analytics Dialog */}
        <Dialog open={analyticsDialogOpen} onOpenChange={setAnalyticsDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {t('benefitsPage.clickStatistics')}
              </DialogTitle>
              <DialogDescription>
                {selectedBenefitForAnalytics?.title} - {t('benefitsPage.last30Days')}
              </DialogDescription>
            </DialogHeader>
            <div className="pt-4">
              {loadingAnalytics ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={clicksData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.7)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        interval={4}
                        axisLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                        tickLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                        tickLine={{ stroke: 'hsl(var(--border) / 0.7)' }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))',
                        }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Bar 
                        dataKey="clicks" 
                        fill="hsl(var(--primary))" 
                        radius={[4, 4, 0, 0]}
                        name={t('benefitsPage.clicks')}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-4 text-center text-sm text-muted-foreground">
                {t('benefitsPage.totalClicks').replace('{count}', String(clicksData.reduce((sum, d) => sum + d.clicks, 0)))}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Manage Categories Dialog */}
        <Dialog open={categoriesDialogOpen} onOpenChange={setCategoriesDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {t('benefitsPage.manageCategories')}
              </DialogTitle>
              <DialogDescription>
                {t('benefitsPage.manageCategoriesDesc')}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 pt-4">
              {/* Existing Categories */}
              <div className="space-y-2">
                <Label>{t('benefitsPage.existingCategories')}</Label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={getCategoryColor(cat.value)}>
                          {language === 'he' ? cat.label_he : language === 'es' ? (cat.label_es || cat.label_en) : cat.label_en}
                        </Badge>
                        <span className="text-xs text-muted-foreground">({cat.value})</span>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={deletingCategoryId === cat.id}
                          >
                            {deletingCategoryId === cat.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <X className="w-4 h-4" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t('benefitsPage.deleteCategory')}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('benefitsPage.deleteCategoryConfirm')}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter className="flex-row-reverse gap-2">
                            <AlertDialogCancel>
                              {t('common.cancel')}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {t('common.delete')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add New Category */}
              <div className="border-t pt-4 space-y-3">
                <Label>{t('benefitsPage.addNewCategory')}</Label>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t('benefitsPage.idEnglish')}</Label>
                    <Input
                      placeholder="e.g., real_estate"
                      value={newCategory.value}
                      onChange={(e) => setNewCategory({ ...newCategory, value: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t('benefitsPage.color')}</Label>
                    <Select 
                      value={newCategory.color} 
                      onValueChange={(v) => setNewCategory({ ...newCategory, color: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {colorOptions.map(color => (
                          <SelectItem key={color.value} value={color.value}>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full bg-${color.value}-500`} />
                              {language === 'he' ? color.labelHe : language === 'es' ? color.labelEs : color.labelEn}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t('benefitsPage.hebrewName')}</Label>
                    <Input
                      placeholder={t('benefitsPage.hebrewNamePlaceholder')}
                      value={newCategory.label_he}
                      onChange={(e) => setNewCategory({ ...newCategory, label_he: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t('benefitsPage.englishName')}</Label>
                    <Input
                      placeholder="Real Estate"
                      value={newCategory.label_en}
                      onChange={(e) => setNewCategory({ ...newCategory, label_en: e.target.value })}
                    />
                  </div>
                </div>

                <Button 
                  className="w-full"
                  onClick={handleAddCategory}
                  disabled={isAddingCategory}
                >
                  {isAddingCategory ? (
                    <>
                      <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                      {t('benefitsPage.adding')}
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mx-2" />
                      {t('benefitsPage.addCategory')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
  );
}

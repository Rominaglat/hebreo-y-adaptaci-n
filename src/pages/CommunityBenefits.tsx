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
  color: string;
  order_index: number;
}

// Default categories for fallback
const defaultCategories: Category[] = [
  { id: '1', value: 'marketing', label_he: 'שיווק', label_en: 'Marketing', color: 'pink', order_index: 0 },
  { id: '2', value: 'sales', label_he: 'מכירות', label_en: 'Sales', color: 'green', order_index: 1 },
  { id: '3', value: 'finance', label_he: 'פיננסים', label_en: 'Finance', color: 'blue', order_index: 2 },
  { id: '4', value: 'logistics', label_he: 'לוגיסטיקה', label_en: 'Logistics', color: 'orange', order_index: 3 },
  { id: '5', value: 'technology', label_he: 'טכנולוגיה', label_en: 'Technology', color: 'purple', order_index: 4 },
  { id: '6', value: 'legal', label_he: 'משפטים', label_en: 'Legal', color: 'amber', order_index: 5 },
];

const colorOptions = [
  { value: 'pink', labelHe: 'ורוד', labelEn: 'Pink' },
  { value: 'green', labelHe: 'ירוק', labelEn: 'Green' },
  { value: 'blue', labelHe: 'כחול', labelEn: 'Blue' },
  { value: 'orange', labelHe: 'כתום', labelEn: 'Orange' },
  { value: 'purple', labelHe: 'סגול', labelEn: 'Purple' },
  { value: 'amber', labelHe: 'ענבר', labelEn: 'Amber' },
  { value: 'red', labelHe: 'אדום', labelEn: 'Red' },
  { value: 'teal', labelHe: 'טורקיז', labelEn: 'Teal' },
  { value: 'gray', labelHe: 'אפור', labelEn: 'Gray' },
];

const getBenefitSchema = (categoryValues: string[]) => z.object({
  title: z.string().trim().min(2, 'שם ההטבה חייב להכיל לפחות 2 תווים').max(100),
  description: z.string().trim().min(10, 'התיאור חייב להכיל לפחות 10 תווים').max(1000),
  category: z.string().refine(val => categoryValues.includes(val), 'קטגוריה לא תקינה'),
  phone_number: z.string().trim().max(15).optional().or(z.literal('')),
  link_url: z.string().url('לינק לא תקין').optional().or(z.literal('')),
  logo_url: z.string().url().optional().or(z.literal('')),
  contactType: z.enum(['phone', 'link']),
}).refine(data => {
  if (data.contactType === 'phone') {
    return data.phone_number && data.phone_number.length >= 9;
  } else {
    return data.link_url && data.link_url.length > 0;
  }
}, {
  message: 'יש להזין ערך תקין',
  path: ['phone_number'],
});

export default function CommunityBenefits() {
  const { user, isAdmin } = useAuth();
  const { language } = useLanguage();
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
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'יש למלא את כל השדות' : 'All fields are required',
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
        title: language === 'he' ? 'הקטגוריה נוספה' : 'Category Added',
      });

      setNewCategory({ value: '', label_he: '', label_en: '', color: 'gray' });
      fetchCategories();
    } catch (error: any) {
      console.error('Error adding category:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: error.message?.includes('duplicate') 
          ? (language === 'he' ? 'קטגוריה עם מזהה זה כבר קיימת' : 'A category with this ID already exists')
          : (language === 'he' ? 'לא ניתן להוסיף את הקטגוריה' : 'Could not add category'),
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
        title: language === 'he' ? 'הקטגוריה נמחקה' : 'Category Deleted',
      });

      fetchCategories();
    } catch (error) {
      console.error('Error deleting category:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
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
    const result = getBenefitSchema(categoryValues).safeParse({ ...newBenefit, contactType });

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
        title: language === 'he' ? 'ההטבה פורסמה' : 'Benefit Published',
        description: language === 'he' ? 'ההטבה נוספה בהצלחה' : 'The benefit was added successfully',
      });

      const resetCategory = categories[0]?.value ?? defaultCategories[0].value;
      setNewBenefit({ title: '', description: '', category: resetCategory, phone_number: '', link_url: '', logo_url: '' });
      setDialogOpen(false);
      fetchBenefits();
    } catch (error) {
      console.error('Error creating benefit:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'לא ניתן ליצור את ההטבה' : 'Could not create benefit',
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
        title: language === 'he' ? 'ההטבה נמחקה' : 'Benefit Deleted',
      });

      fetchBenefits();
    } catch (error) {
      console.error('Error deleting benefit:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
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
    const result = getBenefitSchema(categoryValues).safeParse({ ...newBenefit, contactType });
    
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
        title: language === 'he' ? 'ההטבה עודכנה' : 'Benefit Updated',
        description: language === 'he' ? 'ההטבה עודכנה בהצלחה' : 'The benefit was updated successfully',
      });

      const resetCategory = categories[0]?.value ?? defaultCategories[0].value;
      setNewBenefit({ title: '', description: '', category: resetCategory, phone_number: '', link_url: '', logo_url: '' });
      setEditDialogOpen(false);
      setEditingBenefit(null);
      fetchBenefits();
    } catch (error) {
      console.error('Error updating benefit:', error);
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'לא ניתן לעדכן את ההטבה' : 'Could not update benefit',
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
        p_description: `לחיצה על הטבה "${benefitTitle}" - ${clickType}`,
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
    const message = 'היי+%3A%29+הגעתי+אליכם+דרך+קהילת+AI+Agency+School';
    return `https://wa.me/${cleanPhone}?text=${message}`;
  };

  const getCategoryLabel = (category: string) => {
    const cat = categories.find(c => c.value === category);
    return language === 'he' ? cat?.label_he : cat?.label_en;
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
              {language === 'he' ? 'הטבות לקהילה' : 'Community Benefits'}
            </h1>
            <p className="text-muted-foreground mt-1.5">
              {language === 'he' ? 'שיתופי פעולה והטבות בלעדיות לחברי הקהילה' : 'Exclusive partnerships and benefits for community members'}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <Filter className="w-4 h-4 ml-2" />
                <SelectValue placeholder={language === 'he' ? 'כל הקטגוריות' : 'All Categories'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {language === 'he' ? 'כל הקטגוריות' : 'All Categories'}
                </SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {language === 'he' ? cat.label_he : cat.label_en}
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
                  <span className="hidden sm:inline">{language === 'he' ? 'ניהול קטגוריות' : 'Manage Categories'}</span>
                  <span className="sm:hidden">{language === 'he' ? 'קטגוריות' : 'Categories'}</span>
                </Button>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="flex-1 sm:flex-none">
                      <Plus className="w-4 h-4 mx-2" />
                      {language === 'he' ? 'הוספת הטבה' : 'Add Benefit'}
                    </Button>
                  </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      {language === 'he' ? 'הוספת הטבה חדשה' : 'Add New Benefit'}
                    </DialogTitle>
                    <DialogDescription>
                      {language === 'he' ? 'פרסום שיתוף פעולה חדש לחברי הקהילה' : 'Publish a new partnership for community members'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="title">
                        {language === 'he' ? 'שם ההטבה / נותן השירות' : 'Benefit / Provider Name'}
                      </Label>
                      <Input
                        id="title"
                        placeholder={language === 'he' ? 'לדוגמה: 20% הנחה על שירותי עיצוב' : 'e.g., 20% off design services'}
                        value={newBenefit.title}
                        onChange={(e) => setNewBenefit({ ...newBenefit, title: e.target.value })}
                      />
                      {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">
                        {language === 'he' ? 'תיאור ההטבה' : 'Benefit Description'}
                      </Label>
                      <Textarea
                        id="description"
                        placeholder={language === 'he' ? 'תיאור ההטבה ונותן השירות...' : 'Describe the benefit and provider...'}
                        className="min-h-[100px]"
                        value={newBenefit.description}
                        onChange={(e) => setNewBenefit({ ...newBenefit, description: e.target.value })}
                      />
                      {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">
                        {language === 'he' ? 'קטגוריה' : 'Category'}
                      </Label>
                      <Select 
                        value={newBenefit.category} 
                        onValueChange={(v) => setNewBenefit({ ...newBenefit, category: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={language === 'he' ? 'בחירת קטגוריה' : 'Choose a category'} />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {language === 'he' ? cat.label_he : cat.label_en}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.category && <p className="text-sm text-destructive">{errors.category}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label>
                        {language === 'he' ? 'סוג מימוש' : 'Contact Type'}
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
                            {language === 'he' ? 'טלפון / ווטסאפ' : 'Phone / WhatsApp'}
                          </SelectItem>
                          <SelectItem value="link">
                            {language === 'he' ? 'לינק' : 'Link'}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {contactType === 'phone' && (
                      <div className="space-y-2">
                        <Label htmlFor="phone">
                          {language === 'he' ? 'מספר טלפון' : 'Phone Number'}
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
                          {language === 'he' ? 'יש להזין מספר בפורמט בינלאומי (ללא + או מקפים)' : 'Enter number in international format (without + or dashes)'}
                        </p>
                      </div>
                    )}

                    {contactType === 'link' && (
                      <div className="space-y-2">
                        <Label htmlFor="link">
                          {language === 'he' ? 'לינק' : 'Link'}
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
                        {language === 'he' ? 'לוגו (אופציונלי)' : 'Logo (optional)'}
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
                          {language === 'he' ? 'מפרסם...' : 'Publishing...'}
                        </>
                      ) : (
                        language === 'he' ? 'פרסום הטבה' : 'Publish Benefit'
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
                {language === 'he' ? 'אין הטבות עדיין' : 'No Benefits Yet'}
              </h3>
              <p className="text-muted-foreground">
                {categoryFilter !== 'all' 
                  ? (language === 'he' ? 'אין הטבות בקטגוריה זו' : 'No benefits in this category')
                  : (language === 'he' ? 'הטבות חדשות יפורסמו כאן בקרוב' : 'New benefits will be published here soon')}
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
                            {language === 'he' ? 'מחיקת הטבה' : 'Delete Benefit'}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {language === 'he' ? 'האם למחוק את ההטבה?' : 'Are you sure you want to delete this benefit?'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="flex-row-reverse gap-2">
                          <AlertDialogCancel>
                            {language === 'he' ? 'ביטול' : 'Cancel'}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteBenefit(benefit.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {language === 'he' ? 'מחיקה' : 'Delete'}
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
                        {language === 'he' ? 'לפרטים' : 'View Details'}
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
                          {language === 'he' ? 'חייג' : 'Call'}
                        </a>
                        <a
                          href={getWhatsAppUrl(benefit.phone_number)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackClick(benefit.id, 'whatsapp', benefit.title)}
                          className="flex items-center justify-center gap-2 w-full sm:flex-1 py-2.5 rounded-md bg-[#25D366] hover:bg-[#20BD5A] text-white font-medium transition-colors"
                        >
                          <MessageCircle className="w-4 h-4" />
                          {language === 'he' ? 'ווטסאפ' : 'WhatsApp'}
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
                {language === 'he' ? 'עריכת הטבה' : 'Edit Benefit'}
              </DialogTitle>
              <DialogDescription>
                {language === 'he' ? 'עדכון פרטי ההטבה' : 'Update benefit details'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">
                  {language === 'he' ? 'שם ההטבה / נותן השירות' : 'Benefit / Provider Name'}
                </Label>
                <Input
                  id="edit-title"
                  placeholder={language === 'he' ? 'לדוגמה: 20% הנחה על שירותי עיצוב' : 'e.g., 20% off design services'}
                  value={newBenefit.title}
                  onChange={(e) => setNewBenefit({ ...newBenefit, title: e.target.value })}
                />
                {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">
                  {language === 'he' ? 'תיאור ההטבה' : 'Benefit Description'}
                </Label>
                <Textarea
                  id="edit-description"
                  placeholder={language === 'he' ? 'תיאור ההטבה ונותן השירות...' : 'Describe the benefit and provider...'}
                  className="min-h-[100px]"
                  value={newBenefit.description}
                  onChange={(e) => setNewBenefit({ ...newBenefit, description: e.target.value })}
                />
                {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-category">
                  {language === 'he' ? 'קטגוריה' : 'Category'}
                </Label>
                <Select 
                  value={newBenefit.category} 
                  onValueChange={(v) => setNewBenefit({ ...newBenefit, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'he' ? 'בחירת קטגוריה' : 'Choose a category'} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {language === 'he' ? cat.label_he : cat.label_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && <p className="text-sm text-destructive">{errors.category}</p>}
              </div>

              <div className="space-y-2">
                <Label>
                  {language === 'he' ? 'סוג מימוש' : 'Contact Type'}
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
                      {language === 'he' ? 'טלפון / ווטסאפ' : 'Phone / WhatsApp'}
                    </SelectItem>
                    <SelectItem value="link">
                      {language === 'he' ? 'לינק' : 'Link'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {contactType === 'phone' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-phone">
                    {language === 'he' ? 'מספר טלפון' : 'Phone Number'}
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
                    {language === 'he' ? 'יש להזין מספר בפורמט בינלאומי (ללא + או מקפים)' : 'Enter number in international format (without + or dashes)'}
                  </p>
                </div>
              )}

              {contactType === 'link' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-link">
                    {language === 'he' ? 'לינק' : 'Link'}
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
                  {language === 'he' ? 'לוגו (אופציונלי)' : 'Logo (optional)'}
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
                    {language === 'he' ? 'מעדכן...' : 'Updating...'}
                  </>
                ) : (
                  language === 'he' ? 'עדכון הטבה' : 'Update Benefit'
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
                {language === 'he' ? 'סטטיסטיקת לחיצות' : 'Click Statistics'}
              </DialogTitle>
              <DialogDescription>
                {selectedBenefitForAnalytics?.title} - {language === 'he' ? '30 ימים אחרונים' : 'Last 30 days'}
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
                        name={language === 'he' ? 'לחיצות' : 'Clicks'}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-4 text-center text-sm text-muted-foreground">
                {language === 'he' 
                  ? `סה"כ לחיצות: ${clicksData.reduce((sum, d) => sum + d.clicks, 0)}`
                  : `Total clicks: ${clicksData.reduce((sum, d) => sum + d.clicks, 0)}`
                }
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Manage Categories Dialog */}
        <Dialog open={categoriesDialogOpen} onOpenChange={setCategoriesDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {language === 'he' ? 'ניהול קטגוריות' : 'Manage Categories'}
              </DialogTitle>
              <DialogDescription>
                {language === 'he' ? 'הוספה, עריכה או מחיקה של קטגוריות הטבות' : 'Add, edit or delete benefit categories'}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 pt-4">
              {/* Existing Categories */}
              <div className="space-y-2">
                <Label>{language === 'he' ? 'קטגוריות קיימות' : 'Existing Categories'}</Label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={getCategoryColor(cat.value)}>
                          {language === 'he' ? cat.label_he : cat.label_en}
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
                              {language === 'he' ? 'מחיקת קטגוריה' : 'Delete Category'}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {language === 'he' 
                                ? 'האם לאשר? הטבות עם קטגוריה זו לא ימחקו אך הקטגוריה לא תוצג.'
                                : 'Are you sure? Benefits with this category will not be deleted but the category will not be displayed.'}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter className="flex-row-reverse gap-2">
                            <AlertDialogCancel>
                              {language === 'he' ? 'ביטול' : 'Cancel'}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {language === 'he' ? 'מחיקה' : 'Delete'}
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
                <Label>{language === 'he' ? 'הוספת קטגוריה חדשה' : 'Add New Category'}</Label>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{language === 'he' ? 'מזהה (באנגלית)' : 'ID (English)'}</Label>
                    <Input
                      placeholder="e.g., real_estate"
                      value={newCategory.value}
                      onChange={(e) => setNewCategory({ ...newCategory, value: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{language === 'he' ? 'צבע' : 'Color'}</Label>
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
                              {language === 'he' ? color.labelHe : color.labelEn}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{language === 'he' ? 'שם בעברית' : 'Hebrew Name'}</Label>
                    <Input
                      placeholder="נדל״ן"
                      value={newCategory.label_he}
                      onChange={(e) => setNewCategory({ ...newCategory, label_he: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{language === 'he' ? 'שם באנגלית' : 'English Name'}</Label>
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
                      {language === 'he' ? 'בהוספה...' : 'Adding...'}
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mx-2" />
                      {language === 'he' ? 'הוספת קטגוריה' : 'Add Category'}
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

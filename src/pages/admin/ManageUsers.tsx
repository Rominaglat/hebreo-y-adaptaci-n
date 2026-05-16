import { useEffect, useState } from 'react';
import { 
  Users, 
  UserPlus, 
  Search,
  Mail,
  Shield,
  Loader2,
  MoreHorizontal,
  Filter,
  CheckSquare,
  Square,
  BookOpen,
  Lock,
  Key,
  X,
  Pencil,
  Phone,
  Trash2,
  History,
  Eye,
  EyeOff,
  Upload,
  RefreshCw,
  BarChart3,
  Sparkles
} from 'lucide-react';
import { format } from 'date-fns';
import { he, enUS } from 'date-fns/locale';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  DialogFooter,
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
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ImportUsersDialog } from '@/components/admin/ImportUsersDialog';
import { StudentProgressDialog } from '@/components/admin/StudentProgressDialog';
interface UserActivity {
  id: string;
  activity_type: string;
  description: string;
  action: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, any> | null;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  created_at: string;
}

interface UserWithRole {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  join_date: string;
  role: 'admin' | 'instructor' | 'student' | 'super_admin';
  enrolledCourses?: string[];
}

interface Course {
  id: string;
  title: string;
}

export default function ManageUsers() {
  const { isAdmin, isSuperAdmin, isInstructor } = useAuth();
  // Admin/super_admin can perform destructive actions; instructors are view-only.
  const canEdit = isAdmin;
  const canView = isAdmin || isInstructor;
  const { t, language } = useLanguage();
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  
  // Check if this is the main/admin tenant (no courses management needed)
  const isMainTenant = currentTenant?.slug === 'main';
  
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Multi-select state
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkRoleDialogOpen, setBulkRoleDialogOpen] = useState(false);
  const [bulkAccessDialogOpen, setBulkAccessDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkNewRole, setBulkNewRole] = useState<'admin' | 'instructor' | 'student'>('student');
  const [bulkSelectedCourses, setBulkSelectedCourses] = useState<Set<string>>(new Set());
  const [bulkAccessAction, setBulkAccessAction] = useState<'add' | 'remove'>('add');
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  
  // Single user dialogs
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetPersonalityDialogOpen, setResetPersonalityDialogOpen] = useState(false);
  const [isResettingPersonality, setIsResettingPersonality] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithRole | null>(null);
  const [newRole, setNewRole] = useState<'admin' | 'instructor' | 'student' | 'super_admin'>('student');
  const [userCourseAccess, setUserCourseAccess] = useState<Set<string>>(new Set());
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [isUpdatingAccess, setIsUpdatingAccess] = useState(false);
  const [isBulkUpdatingAccess, setIsBulkUpdatingAccess] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [userActivities, setUserActivities] = useState<UserActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [progressUser, setProgressUser] = useState<UserWithRole | null>(null);
  const [isSyncingEmails, setIsSyncingEmails] = useState(false);
  const [editUserForm, setEditUserForm] = useState({
    email: '',
    phone: '',
    full_name: ''
  });
  
  const [inviteForm, setInviteForm] = useState({
    email: '',
    full_name: '',
    role: 'student' as 'admin' | 'instructor' | 'student',
    password: ''
  });

  const inviteSchema = z.object({
    email: z.string().email(t('admin.validEmail')),
    full_name: z.string().min(2, t('admin.nameMinLength')),
    role: z.enum(['admin', 'instructor', 'student'])
  });

  const roleLabels: Record<string, string> = {
    admin: t('admin.admin'),
    instructor: t('admin.instructor'),
    student: t('admin.student'),
    super_admin: language === 'he' ? 'סופר אדמין' : 'Super Admin',
  };

  useEffect(() => {
    if (canView) {
      fetchUsers();
      fetchCourses();
    }
  }, [canView]);

  const fetchCourses = async () => {
    try {
      const { data } = await supabase
        .from('courses')
        .select('id, title')
        .order('title');

      if (data) {
        setCourses(data);
      }
    } catch (error) {
      console.error('Error fetching courses:', error);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);

    try {
      // Fetch user roles (replaces tenant_memberships post multi-tenancy removal).
      // Filter out super_admin users unless we're in the main tenant.
      let rolesQuery = supabase
        .from('user_roles')
        .select('user_id, role');

      if (!isMainTenant) {
        rolesQuery = rolesQuery.neq('role', 'super_admin');
      }

      const { data: roleRows, error: rolesError } = await rolesQuery;

      if (rolesError) throw rolesError;

      if (!roleRows || roleRows.length === 0) {
        setUsers([]);
        return;
      }

      const userIds = Array.from(new Set(roleRows.map((r) => r.user_id)));

      // One role per user — pick the highest-privilege role if a user has multiple.
      const rolePriority: Record<string, number> = {
        super_admin: 4,
        admin: 3,
        instructor: 2,
        student: 1,
      };
      const roleByUser = new Map<string, UserWithRole['role']>();
      for (const r of roleRows) {
        const current = roleByUser.get(r.user_id);
        const incoming = r.role as UserWithRole['role'];
        if (!current || (rolePriority[incoming] ?? 0) > (rolePriority[current] ?? 0)) {
          roleByUser.set(r.user_id, incoming);
        }
      }

      // Fetch all enrollments for this tenant. We page through results because
      // Supabase enforces a default 1000-row limit per request — with ~100
      // users × ~12 courses, the totals exceed that and later users would
      // appear with 0 enrollments. This bug was also corrupting the access
      // dialog: when the dialog was opened, the cached `enrolledCourses`
      // was empty, and saving would diff the empty set against the real DB
      // and DELETE every existing enrollment.
      const fetchAllEnrollments = async () => {
        const PAGE = 1000;
        let from = 0;
        const all: { user_id: string; course_id: string }[] = [];
        // Loop until we get less than a full page back.
        // Hard cap of 50k rows as a safety net.
        while (from < 50000) {
          const { data, error } = await supabase
            .from('enrollments')
            .select('user_id, course_id')
            .in('user_id', userIds)
            .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      };

      const [profilesResult, enrollmentsData] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, join_date, avatar_url, full_name, phone')
          .in('id', userIds)
          .order('join_date', { ascending: false }),
        fetchAllEnrollments(),
      ]);
      const enrollmentsResult = { data: enrollmentsData, error: null as null };

      if (profilesResult.error) throw profilesResult.error;
      if (enrollmentsResult.error) throw enrollmentsResult.error;

      const enrollmentsByUser = new Map<string, Set<string>>();
      (enrollmentsResult.data || []).forEach((e) => {
        const set = enrollmentsByUser.get(e.user_id) ?? new Set<string>();
        set.add(e.course_id);
        enrollmentsByUser.set(e.user_id, set);
      });

      const profiles = profilesResult.data || [];
      setUsers(
        profiles.map((profile) => {
          return {
            id: profile.id,
            email: profile.email,
            join_date: profile.join_date,
            full_name: profile.full_name || profile.email,
            avatar_url: profile.avatar_url || null,
            phone: profile.phone || null,
            role: (roleByUser.get(profile.id) || 'student') as UserWithRole['role'],
            enrolledCourses: Array.from(enrollmentsByUser.get(profile.id) ?? new Set<string>()),
          };
        }),
      );
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const handleSyncEmails = async () => {
    setIsSyncingEmails(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'sync_emails' },
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
      });

      if (response.error) {
        throw response.error;
      }

      const result = response.data;
      toast({
        title: language === 'he' ? 'סנכרון הושלם' : 'Sync Complete',
        description: language === 'he' 
          ? `סונכרנו ${result.synced} אימיילים` 
          : `Synced ${result.synced} emails`,
      });
      
      fetchUsers();
    } catch (error: any) {
      console.error('Error syncing emails:', error);
      toast({
        variant: 'destructive',
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: error.message || (language === 'he' ? 'שגיאה בסנכרון' : 'Failed to sync'),
      });
    } finally {
      setIsSyncingEmails(false);
    }
  };

  const handleInviteUser = async () => {
    setErrors({});
    
    const result = inviteSchema.safeParse(inviteForm);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsInviting(true);

    try {
      const tempPassword = inviteForm.password || generatePassword();
      const { data: sessionData } = await supabase.auth.getSession();

      const response = await supabase.functions.invoke('admin-user-actions', {
        body: {
          action: 'create_user',
          email: inviteForm.email,
          fullName: inviteForm.full_name,
          newPassword: tempPassword,
          role: inviteForm.role,
        },
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
      });

      // supabase.functions.invoke never throws — non-2xx responses come back as
      // { data: null, error: FunctionsHttpError }. The real error body lives in
      // error.context (the raw Response). We must read it to show a useful message.
      if (response.error) {
        let errorMessage = '';
        try {
          const body = await (response.error as any).context?.json?.();
          errorMessage = body?.error || body?.message || '';
        } catch {
          errorMessage = response.error.message || '';
        }
        console.error('create_user error:', errorMessage);
        toast({
          title: t('common.error'),
          description: errorMessage || response.error.message || t('common.error'),
          variant: 'destructive',
        });
        return;
      }

      // Backend returned 2xx but included an error field
      if (response.data?.error) {
        toast({
          title: t('common.error'),
          description: response.data.error,
          variant: 'destructive',
        });
        return;
      }

      if (response.data?.addedToExistingUser) {
        toast({
          title: language === 'he' ? 'משתמש נוסף לארגון' : 'User added to tenant',
          description: language === 'he'
            ? `${inviteForm.email} כבר קיים במערכת ונוסף לארגון הנוכחי.`
            : `${inviteForm.email} already exists and was added to this tenant.`,
        });
      } else {
        toast({
          title: t('admin.userInvited'),
          description: `${inviteForm.email}. ${language === 'he' ? 'סיסמה זמנית' : 'Temp password'}: ${tempPassword}`,
        });
      }

      setInviteForm({ email: '', full_name: '', role: 'student', password: '' });
      setDialogOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.warn('Error inviting user:', error);
      toast({
        title: t('common.error'),
        description: error.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsInviting(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: 'admin' | 'instructor' | 'student' | 'super_admin') => {
    if (newRole === 'super_admin' && !isMainTenant) {
      toast({
        title: t('admin.accessDenied'),
        description: language === 'he'
          ? 'אפשר להעניק הרשאת סופר אדמין רק בטננט הראשי'
          : 'Super Admin can only be granted in the main tenant',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Replace user's role(s) in user_roles (single-role-per-user post tenant_memberships drop).
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: newRole });

      if (error) throw error;

      toast({
        title: t('admin.roleUpdated'),
        description: t('admin.roleUpdatedDesc'),
      });

      fetchUsers();
    } catch (error: any) {
      console.error('Error updating role:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive',
      });
    }
  };

  const handleBulkRoleUpdate = async () => {
    try {
      const userIds = Array.from(selectedUsers);

      // Replace each user's role(s) in user_roles (single-role-per-user post tenant_memberships drop).
      for (const userId of userIds) {
        await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', userId);
        await supabase
          .from('user_roles')
          .insert({ user_id: userId, role: bulkNewRole });
      }

      toast({
        title: language === 'he' ? 'הרשאות עודכנו' : 'Roles Updated',
        description: language === 'he' 
          ? `${userIds.length} משתמשים עודכנו` 
          : `${userIds.length} users updated`,
      });

      setSelectedUsers(new Set());
      setBulkRoleDialogOpen(false);
      fetchUsers();
    } catch (error) {
      console.error('Error bulk updating roles:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    }
  };

  const handleBulkAccessUpdate = async () => {
    setIsBulkUpdatingAccess(true);

    try {
      const userIds = Array.from(selectedUsers);
      const courseIds = Array.from(bulkSelectedCourses);

      if (userIds.length === 0 || courseIds.length === 0) return;

      if (bulkAccessAction === 'add') {
        const { data: existingEnrollments, error: existingError } = await supabase
          .from('enrollments')
          .select('user_id, course_id')
          .in('user_id', userIds)
          .in('course_id', courseIds);

        if (existingError) throw existingError;

        const existingKeys = new Set(
          (existingEnrollments || []).map((e) => `${e.user_id}:${e.course_id}`),
        );

        const rowsToInsert: Array<{ user_id: string; course_id: string }> = [];
        for (const userId of userIds) {
          for (const courseId of courseIds) {
            const key = `${userId}:${courseId}`;
            if (!existingKeys.has(key)) {
              rowsToInsert.push({ user_id: userId, course_id: courseId });
            }
          }
        }

        if (rowsToInsert.length > 0) {
          const { error: insertError } = await supabase.from('enrollments').insert(rowsToInsert);
          if (insertError) throw insertError;
        }
      } else {
        const { error: deleteError } = await supabase
          .from('enrollments')
          .delete()
          .in('user_id', userIds)
          .in('course_id', courseIds);

        if (deleteError) throw deleteError;
      }

      toast({
        title: language === 'he' ? 'גישה עודכנה' : 'Access Updated',
        description: language === 'he' ? `${userIds.length} משתמשים עודכנו` : `${userIds.length} users updated`,
      });

      setSelectedUsers(new Set());
      setBulkSelectedCourses(new Set());
      setBulkAccessDialogOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error bulk updating access:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkUpdatingAccess(false);
    }
  };

  const handleSingleUserRoleUpdate = async () => {
    if (!selectedUser) return;
    await handleUpdateRole(selectedUser.id, newRole);
    setRoleDialogOpen(false);
    setSelectedUser(null);
  };

  const handleSingleUserAccessUpdate = async () => {
    if (!selectedUser) return;

    setIsUpdatingAccess(true);

    try {
      const { data: existingEnrollments, error: existingError } = await supabase
        .from('enrollments')
        .select('course_id')
        .eq('user_id', selectedUser.id);

      if (existingError) throw existingError;

      const existingSet = new Set((existingEnrollments || []).map((e) => e.course_id));
      const desiredSet = userCourseAccess;

      const toAdd = Array.from(desiredSet).filter((courseId) => !existingSet.has(courseId));
      const toRemove = Array.from(existingSet).filter((courseId) => !desiredSet.has(courseId));

      if (toAdd.length > 0) {
        const { error: insertError } = await supabase.from('enrollments').insert(
          toAdd.map((courseId) => ({
            user_id: selectedUser.id,
            course_id: courseId,
          })),
        );
        if (insertError) throw insertError;
      }

      if (toRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from('enrollments')
          .delete()
          .eq('user_id', selectedUser.id)
          .in('course_id', toRemove);

        if (deleteError) throw deleteError;
      }

      toast({
        title: language === 'he' ? 'גישה עודכנה' : 'Access Updated',
        description: language === 'he' ? 'גישת המשתמש לקורסים עודכנה' : 'User course access updated',
      });

      setAccessDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error updating user access:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingAccess(false);
    }
  };

  const openRoleDialog = (user: UserWithRole) => {
    if (user.role === 'super_admin' && !isSuperAdmin) {
      toast({
        title: t('admin.accessDenied'),
        description: language === 'he' ? 'לא ניתן לשנות הרשאות של סופר אדמין' : "You can't change a Super Admin role",
        variant: 'destructive',
      });
      return;
    }

    setSelectedUser(user);
    setNewRole(user.role);
    setRoleDialogOpen(true);
  };

  const openAccessDialog = (user: UserWithRole) => {
    setSelectedUser(user);
    setUserCourseAccess(new Set(user.enrolledCourses || []));
    setAccessDialogOpen(true);
  };

  const openEditDialog = (user: UserWithRole) => {
    setSelectedUser(user);
    setEditUserForm({
      email: user.email,
      phone: user.phone || '',
      full_name: user.full_name
    });
    setEditDialogOpen(true);
  };

  const handleUpdateUserDetails = async () => {
    if (!selectedUser) return;

    setIsUpdatingUser(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();

      // Always send the email in the form; backend will update Auth only if needed.
      const newEmail = editUserForm.email.trim();

      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: {
          action: 'update_user',
          userId: selectedUser.id,
          fullName: editUserForm.full_name.trim(),
          phone: editUserForm.phone.trim(),
          newEmail,
        },
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: t('admin.userUpdated'),
        description: t('admin.userUpdatedDesc'),
      });

      setEditDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error updating user:', error);
      toast({
        title: t('common.error'),
        description: error.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const openResetPasswordDialog = (user: UserWithRole) => {
    setSelectedUser(user);
    setNewPassword('');
    setShowNewPassword(false);
    setResetPasswordDialogOpen(true);
  };

  const openResetPersonalityDialog = (user: UserWithRole) => {
    setSelectedUser(user);
    setResetPersonalityDialogOpen(true);
  };

  const openDeleteDialog = (user: UserWithRole) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const openProgressDialog = (user: UserWithRole) => {
    setProgressUser(user);
    setProgressDialogOpen(true);
  };

  const openActivityDialog = async (user: UserWithRole) => {
    setSelectedUser(user);
    setLoadingActivities(true);
    setActivityDialogOpen(true);

    try {
      const { data, error } = await supabase
        .from('user_activities')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setUserActivities((data || []) as UserActivity[]);
    } catch (error) {
      console.error('Error fetching activities:', error);
      setUserActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !newPassword) {
      toast({
        title: t('common.error'),
        description: t('profile.passwordMinLength'),
        variant: 'destructive',
      });
      return;
    }
    // SEC-014 — enforce policy + HIBP breach check before sending the new
    // password to the edge function.
    const { validatePassword } = await import('@/lib/passwordPolicy');
    const check = await validatePassword(newPassword);
    if (!check.ok) {
      toast({
        title: t('common.error'),
        description: check.error ?? t('profile.passwordMinLength'),
        variant: 'destructive',
      });
      return;
    }

    setIsResettingPassword(true);

    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: {
          action: 'reset_password',
          userId: selectedUser.id,
          newPassword: newPassword
        }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast({
        title: t('admin.passwordReset'),
        description: t('admin.passwordResetDesc'),
      });

      setResetPasswordDialogOpen(false);
      setNewPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      toast({
        title: t('common.error'),
        description: error.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleResetPersonality = async () => {
    if (!selectedUser) return;
    setIsResettingPersonality(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'personality-admin-actions',
        {
          body: {
            action: 'reset_personality',
            target_user_id: selectedUser.id,
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: language === 'he' ? 'השאלון אופס' : 'Assessment reset',
        description: language === 'he'
          ? `${selectedUser.full_name} יכול/ה כעת למלא את שאלון האישיות שוב.`
          : `${selectedUser.full_name} can now retake the personality assessment.`,
      });
      setResetPersonalityDialogOpen(false);
    } catch (err: any) {
      const code = err?.message || '';
      let message = err?.message || (language === 'he' ? 'איפוס נכשל' : 'Reset failed');
      if (code.includes('no_active_assessment')) {
        message = language === 'he'
          ? 'אין שאלון פעיל למשתמש/ת זה/זו.'
          : 'No active assessment for this user.';
      }
      console.error('Error resetting personality:', err);
      toast({
        title: t('common.error'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsResettingPersonality(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setIsDeletingUser(true);

    try {
      // Post tenant_memberships drop: "remove from tenant" no longer exists.
      // For non-super-admin users in non-main tenants, just revoke their roles + enrollments
      // (preserves auth row); otherwise hard-delete via the edge function.
      if (!isMainTenant && selectedUser.role !== 'super_admin') {
        // Revoke all roles + enrollments for the user.
        const { error: rolesError } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', selectedUser.id);

        if (rolesError) throw rolesError;

        await supabase
          .from('enrollments')
          .delete()
          .eq('user_id', selectedUser.id);

        toast({
          title: language === 'he' ? 'המשתמש הוסר מהארגון' : 'User removed from organization',
          description: language === 'he' ? 'המשתמש הוסר מהארגון הזה' : 'User has been removed from this organization',
        });
      } else {
        // In main tenant - actually delete the user completely
        const { data, error } = await supabase.functions.invoke('admin-user-actions', {
          body: {
            action: 'delete_user',
            userId: selectedUser.id
          }
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        toast({
          title: t('admin.userDeleted'),
          description: t('admin.userDeletedDesc'),
        });
      }

      setDeleteDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: t('common.error'),
        description: error.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return;

    setIsBulkDeleting(true);
    let successCount = 0;
    let failedCount = 0;

    try {
      const { data: sessionData } = await supabase.auth.getSession();

      for (const userId of selectedUsers) {
        const user = users.find(u => u.id === userId);
        if (!user) continue;

        try {
          // Post tenant_memberships drop: "remove from tenant" no longer exists.
          // For non-super-admin users in non-main tenants, just revoke roles + enrollments;
          // otherwise hard-delete via the edge function.
          if (!isMainTenant && user.role !== 'super_admin') {
            const { error: rolesError } = await supabase
              .from('user_roles')
              .delete()
              .eq('user_id', userId);

            if (rolesError) throw rolesError;

            await supabase
              .from('enrollments')
              .delete()
              .eq('user_id', userId);

            successCount++;
          } else {
            // In main tenant - actually delete the user completely
            const response = await supabase.functions.invoke('admin-user-actions', {
              body: {
                action: 'delete_user',
                userId: userId
              },
              headers: {
                Authorization: `Bearer ${sessionData.session?.access_token}`,
              },
            });

            if (response.error || response.data?.error) {
              throw new Error(response.data?.error || response.error?.message);
            }
            successCount++;
          }
        } catch (error) {
          console.error(`Error deleting user ${userId}:`, error);
          failedCount++;
        }
      }

      toast({
        title: language === 'he' ? 'מחיקה הושלמה' : 'Deletion completed',
        description: language === 'he' 
          ? `${successCount} משתמשים נמחקו${failedCount > 0 ? `, ${failedCount} נכשלו` : ''}`
          : `${successCount} users deleted${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
        variant: failedCount > 0 ? 'destructive' : 'default',
      });

      setBulkDeleteDialogOpen(false);
      setSelectedUsers(new Set());
      fetchUsers();
    } catch (error: any) {
      console.error('Error in bulk delete:', error);
      toast({
        title: t('common.error'),
        description: error.message || t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'auth': return '🔐';
      case 'enrollment': return '📚';
      case 'lesson': return '📖';
      case 'exam': return '📝';
      case 'profile': return '👤';
      case 'role': return '🛡️';
      case 'course_management': return '🎓';
      case 'progress': return '📊';
      default: return '📌';
    }
  };

  const getActivityLabel = (type: string) => {
    const key = `admin.activity.${type}`;
    const label = t(key);
    return label !== key ? label : type;
  };

  const toggleUserSelection = (userId: string) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin':
      case 'super_admin':
        return 'destructive';
      case 'instructor':
        return 'default';
      default:
        return 'secondary';
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    
    const matchesCourse = courseFilter === 'all' || 
      (user.enrolledCourses && user.enrolledCourses.includes(courseFilter));
    
    return matchesSearch && matchesRole && matchesCourse;
  });

  if (!canView) {
    return (

        <div className="text-center py-12">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t('admin.accessDenied')}</h2>
          <p className="text-muted-foreground">{t('admin.accessDeniedDesc')}</p>
        </div>

    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('admin.manageUsers')}</h1>
              <p className="text-muted-foreground mt-1.5">
                {language === 'he' ? 'ניהול חברים, הרשאות והזמנות' : 'Manage members, roles and invitations'}
              </p>
            </div>

          <div className="flex gap-2">
            {canEdit && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="lg" className="shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all">
                  <UserPlus className="w-4 h-4 mx-2" />
                  {t('admin.inviteUser')}
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('admin.inviteNewUser')}</DialogTitle>
                <DialogDescription>
                  {t('admin.inviteNewUserDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t('admin.userEmail')}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    className={errors.email ? 'border-destructive' : ''}
                  />
                  {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="name">{t('admin.userFullName')}</Label>
                  <Input
                    id="name"
                    placeholder={language === 'he' ? 'ישראל ישראלי' : 'John Doe'}
                    value={inviteForm.full_name}
                    onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
                    className={errors.full_name ? 'border-destructive' : ''}
                  />
                  {errors.full_name && <p className="text-sm text-destructive">{errors.full_name}</p>}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="role">{t('admin.selectRole')}</Label>
                  <Select
                    value={inviteForm.role}
                    onValueChange={(value: 'admin' | 'instructor' | 'student') => 
                      setInviteForm({ ...inviteForm, role: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('admin.selectRole')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">{t('admin.student')}</SelectItem>
                      <SelectItem value="instructor">{t('admin.instructor')}</SelectItem>
                      <SelectItem value="admin">{t('admin.admin')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t('admin.tempPassword')}</Label>
                  <Input
                    id="password"
                    type="text"
                    placeholder={language === 'he' ? 'תיווצר אוטומטית אם ריק' : 'Auto-generated if empty'}
                    value={inviteForm.password}
                    onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('admin.tempPasswordDesc')}
                  </p>
                </div>
                
                <Button 
                  className="w-full" 
                  onClick={handleInviteUser}
                  disabled={isInviting}
                >
                  {isInviting ? (
                    <>
                      <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                      {t('admin.sending')}
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 mx-2" />
                      {t('admin.sendInvite')}
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          )}

          {canEdit && (
          <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Upload className="w-4 h-4 mx-2" />
            {language === 'he' ? 'ייבוא מקובץ' : 'Import from File'}
          </Button>
          )}

          {canEdit && isSuperAdmin && (
            <Button variant="outline" onClick={handleSyncEmails} disabled={isSyncingEmails}>
              {isSyncingEmails ? (
                <Loader2 className="w-4 h-4 mx-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mx-2" />
              )}
              {language === 'he' ? 'סנכרון אימיילים' : 'Sync Emails'}
            </Button>
          )}
          </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3">
          <div className="relative w-full">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t('admin.searchUsers')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
            />
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="w-4 h-4 ml-2" />
                <SelectValue placeholder={language === 'he' ? 'סנן לפי הרשאה' : 'Filter by role'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{language === 'he' ? 'כל ההרשאות' : 'All roles'}</SelectItem>
                <SelectItem value="super_admin">{language === 'he' ? 'סופר אדמין' : 'Super Admin'}</SelectItem>
                <SelectItem value="admin">{t('admin.admin')}</SelectItem>
                <SelectItem value="instructor">{t('admin.instructor')}</SelectItem>
                <SelectItem value="student">{t('admin.student')}</SelectItem>
              </SelectContent>
            </Select>

            {!isMainTenant && (
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <BookOpen className="w-4 h-4 ml-2" />
                  <SelectValue placeholder={language === 'he' ? 'סנן לפי קורס' : 'Filter by course'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'he' ? 'כל הקורסים' : 'All courses'}</SelectItem>
                  {courses.map(course => (
                    <SelectItem key={course.id} value={course.id}>{course.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Bulk Actions — admin/super_admin only (instructors are view-only) */}
        {canEdit && selectedUsers.size > 0 && (
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="py-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-5 h-5 text-primary" />
                  <span className="font-medium">
                    {language === 'he' 
                      ? `${selectedUsers.size} משתמשים נבחרו` 
                      : `${selectedUsers.size} users selected`}
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSelectedUsers(new Set())}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setBulkRoleDialogOpen(true)}
                  >
                    <Lock className="w-4 h-4 ml-2" />
                    {language === 'he' ? 'שנה הרשאות' : 'Change Roles'}
                  </Button>
                  {!isMainTenant && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setBulkAccessDialogOpen(true)}
                    >
                      <BookOpen className="w-4 h-4 ml-2" />
                      {language === 'he' ? 'ניהול גישה' : 'Manage Access'}
                    </Button>
                  )}
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => setBulkDeleteDialogOpen(true)}
                  >
                    <Trash2 className="w-4 h-4 ml-2" />
                    {language === 'he' ? 'מחיקת הנבחרים' : 'Delete Selected'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Users Table - Desktop */}
        <Card className="hidden md:block">
          <CardHeader>
            <CardTitle>{t('admin.existingUsers')} ({filteredUsers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">{t('admin.noUsers')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canEdit && (
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                      )}
                      <TableHead className="text-right">{t('admin.user')}</TableHead>
                      <TableHead className="text-right">{t('admin.role')}</TableHead>
                      {!isMainTenant && (
                        <TableHead className="text-right">{language === 'he' ? 'קורסים' : 'Courses'}</TableHead>
                      )}
                      <TableHead className="text-right">{t('admin.joined')}</TableHead>
                      <TableHead className="text-left">{t('admin.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id} className={selectedUsers.has(user.id) ? 'bg-primary/5' : ''}>
                        {canEdit && (
                          <TableCell>
                            <Checkbox
                              checked={selectedUsers.has(user.id)}
                              onCheckedChange={() => toggleUserSelection(user.id)}
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-9 h-9">
                              <AvatarImage src={user.avatar_url || undefined} />
                              <AvatarFallback className="bg-primary/10 text-primary text-sm">
                                {getInitials(user.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{user.full_name}</p>
                              <p className="text-sm text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(user.role)}>
                            {roleLabels[user.role] ?? user.role}
                          </Badge>
                        </TableCell>
                        {!isMainTenant && (
                          <TableCell>
                            <Badge variant="outline">
                              {user.enrolledCourses?.length || 0}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground">
                          {format(new Date(user.join_date), 'd בMMM yyyy', { locale: language === 'he' ? he : enUS })}
                        </TableCell>
                        <TableCell className="text-left">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {canEdit && (
                                <DropdownMenuItem onClick={() => openEditDialog(user)}>
                                  <Pencil className="w-4 h-4 ml-2" />
                                  {language === 'he' ? 'עריכת פרטים' : 'Edit Details'}
                                </DropdownMenuItem>
                              )}
                              {canEdit && (
                                <DropdownMenuItem onClick={() => openRoleDialog(user)}>
                                  <Lock className="w-4 h-4 ml-2" />
                                  {language === 'he' ? 'שינוי הרשאות' : 'Change Role'}
                                </DropdownMenuItem>
                              )}
                              {(canEdit || (isInstructor && user.role === 'student')) && !isMainTenant && (
                                <DropdownMenuItem onClick={() => openAccessDialog(user)}>
                                  <BookOpen className="w-4 h-4 ml-2" />
                                  {language === 'he' ? 'ניהול גישה לתכנים' : 'Manage Content Access'}
                                </DropdownMenuItem>
                              )}
                              {!isMainTenant && (
                                <DropdownMenuItem onClick={() => openProgressDialog(user)}>
                                  <BarChart3 className="w-4 h-4 ml-2" />
                                  {t('admin.viewProgress')}
                                </DropdownMenuItem>
                              )}
                              {(canEdit || (isInstructor && user.role === 'student')) && <DropdownMenuSeparator />}
                              {(canEdit || (isInstructor && user.role === 'student')) && (
                                <DropdownMenuItem onClick={() => openResetPasswordDialog(user)}>
                                  <Key className="w-4 h-4 ml-2" />
                                  {t('admin.resetPassword')}
                                </DropdownMenuItem>
                              )}
                              {canEdit && (
                                <DropdownMenuItem onClick={() => openResetPersonalityDialog(user)}>
                                  <Sparkles className="w-4 h-4 ml-2" />
                                  {language === 'he' ? 'איפוס שאלון אישיות' : 'Reset personality assessment'}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openActivityDialog(user)}>
                                <History className="w-4 h-4 ml-2" />
                                {t('admin.activityHistory')}
                              </DropdownMenuItem>
                              {canEdit && <DropdownMenuSeparator />}
                              {canEdit && (
                                <DropdownMenuItem
                                  onClick={() => openDeleteDialog(user)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4 ml-2" />
                                  {t('admin.deleteUser')}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Users Cards - Mobile */}
        <div className="md:hidden space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t('admin.existingUsers')} ({filteredUsers.length})</h3>
          </div>
          
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">{t('admin.noUsers')}</p>
              </CardContent>
            </Card>
          ) : (
            filteredUsers.map((user) => (
              <Card key={user.id} className={selectedUsers.has(user.id) ? 'border-primary' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {canEdit && (
                      <Checkbox
                        checked={selectedUsers.has(user.id)}
                        onCheckedChange={() => toggleUserSelection(user.id)}
                        className="mt-1"
                      />
                    )}
                    <Avatar className="w-10 h-10 flex-shrink-0">
                      <AvatarImage src={user.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-sm">
                        {getInitials(user.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{user.full_name}</p>
                          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="flex-shrink-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEdit && (
                              <DropdownMenuItem onClick={() => openEditDialog(user)}>
                                <Pencil className="w-4 h-4 ml-2" />
                                {language === 'he' ? 'עריכת פרטים' : 'Edit Details'}
                              </DropdownMenuItem>
                            )}
                            {canEdit && (
                              <DropdownMenuItem onClick={() => openRoleDialog(user)}>
                                <Lock className="w-4 h-4 ml-2" />
                                {language === 'he' ? 'שינוי הרשאות' : 'Change Role'}
                              </DropdownMenuItem>
                            )}
                            {(canEdit || (isInstructor && user.role === 'student')) && !isMainTenant && (
                              <DropdownMenuItem onClick={() => openAccessDialog(user)}>
                                <BookOpen className="w-4 h-4 ml-2" />
                                {language === 'he' ? 'ניהול גישה לתכנים' : 'Manage Content Access'}
                              </DropdownMenuItem>
                            )}
                            {!isMainTenant && (
                              <DropdownMenuItem onClick={() => openProgressDialog(user)}>
                                <BarChart3 className="w-4 h-4 ml-2" />
                                {t('admin.viewProgress')}
                              </DropdownMenuItem>
                            )}
                            {(canEdit || (isInstructor && user.role === 'student')) && <DropdownMenuSeparator />}
                            {(canEdit || (isInstructor && user.role === 'student')) && (
                              <DropdownMenuItem onClick={() => openResetPasswordDialog(user)}>
                                <Key className="w-4 h-4 ml-2" />
                                {t('admin.resetPassword')}
                              </DropdownMenuItem>
                            )}
                            {canEdit && (
                              <DropdownMenuItem onClick={() => openResetPersonalityDialog(user)}>
                                <Sparkles className="w-4 h-4 ml-2" />
                                {language === 'he' ? 'איפוס שאלון אישיות' : 'Reset personality assessment'}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => openActivityDialog(user)}>
                              <History className="w-4 h-4 ml-2" />
                              {t('admin.activityHistory')}
                            </DropdownMenuItem>
                            {canEdit && <DropdownMenuSeparator />}
                            {canEdit && (
                              <DropdownMenuItem
                                onClick={() => openDeleteDialog(user)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="w-4 h-4 ml-2" />
                                {t('admin.deleteUser')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Badge variant={getRoleBadgeVariant(user.role)} className="text-xs">
                          {roleLabels[user.role] ?? user.role}
                        </Badge>
                        {!isMainTenant && (
                          <Badge variant="outline" className="text-xs">
                            {user.enrolledCourses?.length || 0} {language === 'he' ? 'קורסים' : 'courses'}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(user.join_date), 'd בMMM yyyy', { locale: language === 'he' ? he : enUS })}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Single User Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{language === 'he' ? 'שינוי הרשאות' : 'Change Role'}</DialogTitle>
            <DialogDescription>
              {selectedUser && (language === 'he' 
                ? `שינוי ההרשאות של ${selectedUser.full_name}`
                : `Change role for ${selectedUser.full_name}`)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={newRole} onValueChange={(v: 'admin' | 'instructor' | 'student' | 'super_admin') => setNewRole(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="student">{t('admin.student')}</SelectItem>
                <SelectItem value="instructor">{t('admin.instructor')}</SelectItem>
                <SelectItem value="admin">{t('admin.admin')}</SelectItem>
                {isSuperAdmin && isMainTenant && (
                  <SelectItem value="super_admin">{language === 'he' ? 'סופר אדמין' : 'Super Admin'}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSingleUserRoleUpdate}>
              {language === 'he' ? 'שמור' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single User Access Dialog */}
      <Dialog open={accessDialogOpen} onOpenChange={setAccessDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{language === 'he' ? 'ניהול גישה לתכנים' : 'Manage Content Access'}</DialogTitle>
            <DialogDescription>
              {selectedUser && (language === 'he' 
                ? `בחירת הקורסים שאליהם תהיה גישה עבור ${selectedUser.full_name}`
                : `Select courses ${selectedUser.full_name} should have access to`)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[300px] overflow-y-auto space-y-2">
            {courses.map(course => (
              <div key={course.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded">
                <Checkbox
                  checked={userCourseAccess.has(course.id)}
                  onCheckedChange={(checked) => {
                    const newAccess = new Set(userCourseAccess);
                    if (checked) {
                      newAccess.add(course.id);
                    } else {
                      newAccess.delete(course.id);
                    }
                    setUserCourseAccess(newAccess);
                  }}
                />
                <span>{course.title}</span>
              </div>
            ))}
            {courses.length === 0 && (
              <p className="text-muted-foreground text-center py-4">
                {language === 'he' ? 'אין קורסים זמינים' : 'No courses available'}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAccessDialogOpen(false)}
              disabled={isUpdatingAccess}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSingleUserAccessUpdate} disabled={isUpdatingAccess}>
              {isUpdatingAccess ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {language === 'he' ? 'שומר...' : 'Saving...'}
                </>
              ) : (
                (language === 'he' ? 'שמור' : 'Save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.editUser')}</DialogTitle>
            <DialogDescription>
              {selectedUser && (language === 'he' 
                ? `עדכן את פרטי ${selectedUser.full_name}` 
                : `Update details for ${selectedUser.full_name}`)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit_full_name">{t('admin.userFullName')}</Label>
              <Input
                id="edit_full_name"
                value={editUserForm.full_name}
                onChange={(e) => setEditUserForm({ ...editUserForm, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_email">{t('admin.userEmail')}</Label>
              <div className="relative">
                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="edit_email"
                  type="email"
                  value={editUserForm.email}
                  onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                  className="ps-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_phone">{language === 'he' ? 'טלפון' : 'Phone'}</Label>
              <div className="relative">
                <Phone className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="edit_phone"
                  type="tel"
                  value={editUserForm.phone}
                  onChange={(e) => setEditUserForm({ ...editUserForm, phone: e.target.value })}
                  className="ps-10"
                  placeholder={language === 'he' ? '050-1234567' : '050-1234567'}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdateUserDetails} disabled={isUpdatingUser}>
              {isUpdatingUser ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {language === 'he' ? 'מעדכן...' : 'Updating...'}
                </>
              ) : (
                t('admin.updateUser')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Role Dialog */}
      <Dialog open={bulkRoleDialogOpen} onOpenChange={setBulkRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{language === 'he' ? 'שינוי הרשאות מרובות' : 'Bulk Role Change'}</DialogTitle>
            <DialogDescription>
              {language === 'he' 
                ? `שינוי ההרשאות של ${selectedUsers.size} משתמשים`
                : `Change role for ${selectedUsers.size} users`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={bulkNewRole} onValueChange={(v: 'admin' | 'instructor' | 'student') => setBulkNewRole(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="student">{t('admin.student')}</SelectItem>
                <SelectItem value="instructor">{t('admin.instructor')}</SelectItem>
                <SelectItem value="admin">{t('admin.admin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRoleDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleBulkRoleUpdate}>
              {language === 'he' ? 'עדכן הכל' : 'Update All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Access Dialog */}
      <Dialog open={bulkAccessDialogOpen} onOpenChange={setBulkAccessDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{language === 'he' ? 'ניהול גישה מרובה' : 'Bulk Access Management'}</DialogTitle>
            <DialogDescription>
              {language === 'he' 
                ? `ניהול גישה לקורסים עבור ${selectedUsers.size} משתמשים`
                : `Manage course access for ${selectedUsers.size} users`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex gap-2">
              <Button 
                variant={bulkAccessAction === 'add' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setBulkAccessAction('add')}
              >
                {language === 'he' ? 'הוספת גישה' : 'Add Access'}
              </Button>
              <Button 
                variant={bulkAccessAction === 'remove' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setBulkAccessAction('remove')}
              >
                {language === 'he' ? 'הסרת גישה' : 'Remove Access'}
              </Button>
            </div>
            <div className="max-h-[250px] overflow-y-auto space-y-2">
              {courses.map(course => (
                <div key={course.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded">
                  <Checkbox
                    checked={bulkSelectedCourses.has(course.id)}
                    onCheckedChange={(checked) => {
                      const newCourses = new Set(bulkSelectedCourses);
                      if (checked) {
                        newCourses.add(course.id);
                      } else {
                        newCourses.delete(course.id);
                      }
                      setBulkSelectedCourses(newCourses);
                    }}
                  />
                  <span>{course.title}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkAccessDialogOpen(false)}
              disabled={isBulkUpdatingAccess}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleBulkAccessUpdate}
              disabled={bulkSelectedCourses.size === 0 || isBulkUpdatingAccess}
            >
              {isBulkUpdatingAccess ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {language === 'he' ? 'מעדכן...' : 'Updating...'}
                </>
              ) : (
                (language === 'he' ? 'עדכן הכל' : 'Update All')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.resetPassword')}</DialogTitle>
            <DialogDescription>
              {selectedUser && (language === 'he' 
                ? `הגדר סיסמה חדשה ל-${selectedUser.full_name}` 
                : `Set a new password for ${selectedUser.full_name}`)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new_password">{t('admin.newPassword')}</Label>
              <div className="relative">
                <Input
                  id="new_password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={language === 'he' ? 'לפחות 6 תווים' : 'At least 6 characters'}
                  className="pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleResetPassword} disabled={isResettingPassword || newPassword.length < 6}>
              {isResettingPassword ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {t('admin.resettingPassword')}
                </>
              ) : (
                t('admin.resetPassword')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Personality Assessment Dialog */}
      <AlertDialog open={resetPersonalityDialogOpen} onOpenChange={setResetPersonalityDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'he' ? 'איפוס שאלון אישיות' : 'Reset personality assessment'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUser && (
                language === 'he'
                  ? `השאלון האחרון של ${selectedUser.full_name} ייסגר ולא יוצג עוד בדוח. ${selectedUser.full_name} יוכל/תוכל למלא את השאלון מחדש מיד, ללא המתנה של 7 ימים. ההיסטוריה נשמרת לתיעוד.`
                  : `${selectedUser.full_name}'s most recent assessment will be archived and removed from their report. They will be able to retake immediately, without waiting the 7-day cooldown. History is preserved for audit.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResettingPersonality}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetPersonality}
              disabled={isResettingPersonality}
            >
              {isResettingPersonality ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {language === 'he' ? 'מאפס...' : 'Resetting...'}
                </>
              ) : (
                language === 'he' ? 'איפוס השאלון' : 'Reset assessment'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete User Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isMainTenant 
                ? t('admin.deleteUserConfirm')
                : (language === 'he' ? 'הסרת משתמש מהארגון' : 'Remove User from Organization')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUser && (
                isMainTenant
                  ? (language === 'he' 
                      ? `פעולה זו תמחק את המשתמש ${selectedUser.full_name} לצמיתות מכל המערכת. האם להמשיך?` 
                      : `This will permanently delete ${selectedUser.full_name} from the entire system. Continue?`)
                  : (language === 'he' 
                      ? `פעולה זו תסיר את ${selectedUser.full_name} מהארגון הזה בלבד. המשתמש ימשיך להתקיים במערכת.` 
                      : `This will remove ${selectedUser.full_name} from this organization only. The user will still exist in the system.`)
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeletingUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingUser ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {isMainTenant ? t('admin.deletingUser') : (language === 'he' ? 'בהסרה...' : 'Removing...')}
                </>
              ) : (
                isMainTenant ? t('admin.deleteUser') : (language === 'he' ? 'הסרה מהארגון' : 'Remove from Organization')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activity History Dialog */}
      <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.activityHistory')}</DialogTitle>
            <DialogDescription>
              {selectedUser && (language === 'he' 
                ? `היסטוריית פעילות של ${selectedUser.full_name}` 
                : `Activity history for ${selectedUser.full_name}`)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {loadingActivities ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : userActivities.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {t('admin.noActivities')}
              </div>
            ) : (
              <div className="space-y-3">
                {userActivities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-lg">
                      {getActivityIcon(activity.activity_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-2">
                        <Badge variant="outline" className="text-xs">
                          {getActivityLabel(activity.activity_type)}
                        </Badge>
                        {activity.action && (
                          <Badge variant="secondary" className="text-xs">
                            {activity.action}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(activity.created_at), 'd/M/yyyy HH:mm', { locale: language === 'he' ? he : enUS })}
                        </span>
                      </div>
                      <p className="text-sm mt-1">{activity.description}</p>
                      {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1 bg-background/50 p-2 rounded">
                          {Object.entries(activity.metadata).map(([key, value]) => (
                            <span key={key} className="me-2">
                              <strong>{key}:</strong> {String(value)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivityDialogOpen(false)}>
              {language === 'he' ? 'סגירה' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'he' 
                ? `מחיקת ${selectedUsers.size} משתמשים` 
                : `Delete ${selectedUsers.size} Users`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isMainTenant 
                ? (language === 'he' 
                    ? 'פעולה זו תמחק את המשתמשים לצמיתות מכל המערכת. האם לאשר?'
                    : 'This will permanently delete these users from the entire system. Are you sure?')
                : (language === 'he' 
                    ? 'פעולה זו תסיר את המשתמשים מהארגון הזה. הם עדיין יוכלו לגשת לארגונים אחרים אליהם הם שייכים.' 
                    : 'This will remove these users from this organization. They will still have access to other organizations they belong to.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mx-2" />
                  {language === 'he' ? 'מוחק...' : 'Deleting...'}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mx-2" />
                  {language === 'he' ? 'מחק' : 'Delete'}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Users Dialog */}
      <ImportUsersDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportComplete={fetchUsers}
      />

      {/* Student Progress Dialog */}
      <StudentProgressDialog
        open={progressDialogOpen}
        onOpenChange={setProgressDialogOpen}
        user={progressUser}
      />
    </>
  );
}

import { useEffect, useState } from 'react';
import { 
  Users, 
  UserPlus, 
  Search,
  Mail,
  Shield,
  Loader2,
  MoreHorizontal,
  Mic,
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
  Download,
  RefreshCw,
  BarChart3,
  Clock
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
import { withTimeout } from '@/lib/utils';
import {
  isTimeLimitEligible,
  partitionByTimeLimitEligibility,
  buildAccessLimitBody,
  type AccessLimitBody,
} from '@/lib/accessLimit';
import { ImportUsersDialog } from '@/components/admin/ImportUsersDialog';
import { Progress } from '@/components/ui/progress';
import ExcelJS from 'exceljs';
import { StudentProgressDialog } from '@/components/admin/StudentProgressDialog';
import { AssignmentSubmissionsDialog } from '@/components/admin/AssignmentSubmissionsDialog';
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
  role: 'admin' | 'instructor' | 'student' | 'super_admin' | 'lead';
  enrolledCourses?: string[];
  // Active access time limit (null/absent = unlimited). Set once the limit
  // has fired; `accessRevokedAt` marks it already applied by the sweep.
  accessExpiresAt?: string | null;
  accessRevokedAt?: string | null;
}

interface Course {
  id: string;
  title: string;
}

// supabase.functions.invoke never throws — non-2xx responses come back as
// { error: FunctionsHttpError } whose .message is the generic "non-2xx status
// code". The real server message lives in error.context (the raw Response).
// Mirror handleInviteUser's handling so admins see the actual error.
async function readFunctionError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    return body?.error || body?.message || error?.message || '';
  } catch {
    return error?.message || '';
  }
}

export default function ManageUsers() {
  const { isAdmin, isSuperAdmin, isInstructor, loading: authLoading } = useAuth();
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
  const [bulkNewRole, setBulkNewRole] = useState<'admin' | 'instructor' | 'student' | 'lead'>('student');
  const [bulkSelectedCourses, setBulkSelectedCourses] = useState<Set<string>>(new Set());
  const [bulkAccessAction, setBulkAccessAction] = useState<'add' | 'remove'>('add');
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState({ done: 0, total: 0 });
  
  // Single user dialogs
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithRole | null>(null);
  const [newRole, setNewRole] = useState<'admin' | 'instructor' | 'student' | 'super_admin' | 'lead'>('student');
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
  // Time-limit dialog
  const [timeLimitDialogOpen, setTimeLimitDialogOpen] = useState(false);
  const [isSettingTimeLimit, setIsSettingTimeLimit] = useState(false);
  const [timeLimitMode, setTimeLimitMode] = useState<'hours' | 'date'>('hours');
  const [timeLimitHours, setTimeLimitHours] = useState('24');
  const [timeLimitDate, setTimeLimitDate] = useState('');
  // Bulk time-limit dialog (independent state so it can't bleed into the single dialog)
  const [bulkTimeLimitDialogOpen, setBulkTimeLimitDialogOpen] = useState(false);
  const [isBulkSettingTimeLimit, setIsBulkSettingTimeLimit] = useState(false);
  const [bulkTimeLimitMode, setBulkTimeLimitMode] = useState<'hours' | 'date'>('hours');
  const [bulkTimeLimitHours, setBulkTimeLimitHours] = useState('24');
  const [bulkTimeLimitDate, setBulkTimeLimitDate] = useState('');
  const [bulkTimeLimitProgress, setBulkTimeLimitProgress] = useState({ done: 0, total: 0 });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [progressUser, setProgressUser] = useState<UserWithRole | null>(null);
  const [submissionsDialogOpen, setSubmissionsDialogOpen] = useState(false);
  const [submissionsUser, setSubmissionsUser] = useState<UserWithRole | null>(null);
  const [isSyncingEmails, setIsSyncingEmails] = useState(false);
  const [editUserForm, setEditUserForm] = useState({
    email: '',
    phone: '',
    full_name: ''
  });
  
  const [inviteForm, setInviteForm] = useState({
    email: '',
    full_name: '',
    role: 'student' as 'admin' | 'instructor' | 'student' | 'lead',
    password: ''
  });

  const inviteSchema = z.object({
    email: z.string().email(t('admin.validEmail')),
    full_name: z.string().min(2, t('admin.nameMinLength')),
    role: z.enum(['admin', 'instructor', 'student', 'lead'])
  });

  const roleLabels: Record<string, string> = {
    admin: t('admin.admin'),
    instructor: t('admin.instructor'),
    student: t('admin.student'),
    super_admin: t('manageUsers.superAdmin'),
    lead: t('admin.lead'),
  };

  useEffect(() => {
    // Wait for auth to finish before deciding what to do. Without this gate
    // the page would render with `loading=true` while `canView` is still
    // false, and the spinner would never resolve if auth happens to error
    // out or the user lacks permission.
    if (authLoading) return;
    if (canView) {
      fetchUsers();
      fetchCourses();
    } else {
      setLoading(false);
    }
  }, [authLoading, canView, currentTenant?.id]);

  const fetchCourses = async () => {
    try {
      const { data } = await withTimeout(
        supabase.from('courses').select('id, title').order('title'),
        12000,
        'fetchCourses'
      );

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

      const { data: roleRows, error: rolesError } = await withTimeout(
        rolesQuery,
        12000,
        'fetchUsers/roles'
      );

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
          const { data, error } = await withTimeout(
            supabase
              .from('enrollments')
              .select('user_id, course_id')
              .in('user_id', userIds)
              .range(from, from + PAGE - 1),
            12000,
            'fetchUsers/enrollments'
          );
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      };

      const [profilesResult, enrollmentsData, accessLimitsResult] = await Promise.all([
        withTimeout(
          supabase
            .from('profiles')
            .select('id, email, join_date, avatar_url, full_name, phone')
            .in('id', userIds)
            .order('join_date', { ascending: false }),
          12000,
          'fetchUsers/profiles'
        ),
        fetchAllEnrollments(),
        // Best-effort: a timeout/RLS failure here must not reject the whole
        // load (which would blank the user list) — swallow it to empty so we
        // just drop the expiry badges.
        withTimeout(
          supabase
            .from('access_limits')
            .select('user_id, expires_at, revoked_at')
            .in('user_id', userIds),
          12000,
          'fetchUsers/accessLimits'
        ).then(
          (r) => r,
          () => ({ data: [] as { user_id: string; expires_at: string; revoked_at: string | null }[] }),
        ),
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

      // access_limits read is best-effort — a failure here shouldn't blank out
      // the whole user list, just the expiry badges.
      const accessLimitByUser = new Map<string, { expiresAt: string; revokedAt: string | null }>();
      (accessLimitsResult.data || []).forEach((a) => {
        accessLimitByUser.set(a.user_id, { expiresAt: a.expires_at, revokedAt: a.revoked_at });
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
            accessExpiresAt: accessLimitByUser.get(profile.id)?.expiresAt ?? null,
            accessRevokedAt: accessLimitByUser.get(profile.id)?.revokedAt ?? null,
          };
        }),
      );
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  // Export the visible (filtered) user list as an Excel file in the same
  // shape the import dialog accepts — email, full_name, role, phone.
  // Lets admins round-trip edit-and-reimport (e.g. set everyone's phone
  // so the next import uses it as the initial password).
  const handleExportUsers = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Users');
    ws.columns = [
      { header: 'email', key: 'email', width: 30 },
      { header: 'full_name', key: 'full_name', width: 24 },
      { header: 'role', key: 'role', width: 14 },
      { header: 'phone', key: 'phone', width: 16 },
    ];
    filteredUsers.forEach((u) => {
      ws.addRow({
        email: u.email || '',
        full_name: u.full_name || '',
        role: u.role || 'student',
        phone: u.phone || '',
      });
    });
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
        title: t('manageUsers.syncComplete'),
        description: `${t('manageUsers.syncedPrefix')}${result.synced}${t('manageUsers.syncedSuffix')}`,
      });

      fetchUsers();
    } catch (error: any) {
      console.error('Error syncing emails:', error);
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: error.message || t('manageUsers.syncFailed'),
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
          title: t('manageUsers.userAddedToTenant'),
          description: `${inviteForm.email} ${t('manageUsers.userAddedToTenantDesc')}`,
        });
      } else {
        toast({
          title: t('admin.userInvited'),
          description: `${inviteForm.email}. ${t('manageUsers.tempPasswordLabel')}: ${tempPassword}`,
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

  const handleUpdateRole = async (userId: string, newRole: 'admin' | 'instructor' | 'student' | 'super_admin' | 'lead') => {
    if (newRole === 'super_admin' && !isMainTenant) {
      toast({
        title: t('admin.accessDenied'),
        description: t('manageUsers.superAdminMainOnly'),
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
        title: t('manageUsers.rolesUpdated'),
        description: `${userIds.length} ${t('manageUsers.usersUpdated')}`,
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
        title: t('manageUsers.accessUpdated'),
        description: `${userIds.length} ${t('manageUsers.usersUpdated')}`,
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
        title: t('manageUsers.accessUpdated'),
        description: t('manageUsers.userCourseAccessUpdated'),
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
        description: t('manageUsers.cantChangeSuperAdmin'),
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

  const openTimeLimitDialog = (user: UserWithRole) => {
    setSelectedUser(user);
    // Prefill from any existing (not-yet-fired) limit.
    const pending = user.accessExpiresAt && !user.accessRevokedAt ? user.accessExpiresAt : '';
    if (pending) {
      // datetime-local wants `YYYY-MM-DDTHH:mm` in local time.
      const d = new Date(pending);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
      setTimeLimitMode('date');
      setTimeLimitDate(local);
      setTimeLimitHours('24');
    } else {
      setTimeLimitMode('hours');
      setTimeLimitHours('24');
      setTimeLimitDate('');
    }
    setTimeLimitDialogOpen(true);
  };

  const handleSetTimeLimit = async () => {
    if (!selectedUser) return;

    // Build the request body from the active mode.
    let body: { action: string; userId: string; hours?: number; expiresAt?: string };
    if (timeLimitMode === 'hours') {
      const h = Number(timeLimitHours);
      if (!Number.isFinite(h) || h <= 0) {
        toast({ title: t('common.error'), description: t('manageUsers.timeLimit.invalidHours'), variant: 'destructive' });
        return;
      }
      body = { action: 'set_access_limit', userId: selectedUser.id, hours: h };
    } else {
      if (!timeLimitDate) {
        toast({ title: t('common.error'), description: t('manageUsers.timeLimit.invalidDate'), variant: 'destructive' });
        return;
      }
      const d = new Date(timeLimitDate);
      if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        toast({ title: t('common.error'), description: t('manageUsers.timeLimit.invalidDate'), variant: 'destructive' });
        return;
      }
      body = { action: 'set_access_limit', userId: selectedUser.id, expiresAt: d.toISOString() };
    }

    setIsSettingTimeLimit(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', { body });
      if (error) {
        const msg = await readFunctionError(error);
        toast({ title: t('common.error'), description: msg || t('common.error'), variant: 'destructive' });
        return;
      }
      if (data?.error) {
        toast({ title: t('common.error'), description: data.error, variant: 'destructive' });
        return;
      }

      toast({ title: t('manageUsers.timeLimit.setTitle'), description: t('manageUsers.timeLimit.setDesc') });
      setTimeLimitDialogOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error setting time limit:', error);
      toast({ title: t('common.error'), description: error.message || t('common.error'), variant: 'destructive' });
    } finally {
      setIsSettingTimeLimit(false);
    }
  };

  const handleRemoveTimeLimit = async () => {
    if (!selectedUser) return;
    setIsSettingTimeLimit(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'set_access_limit', userId: selectedUser.id, clear: true },
      });
      if (error) {
        const msg = await readFunctionError(error);
        toast({ title: t('common.error'), description: msg || t('common.error'), variant: 'destructive' });
        return;
      }
      if (data?.error) {
        toast({ title: t('common.error'), description: data.error, variant: 'destructive' });
        return;
      }

      toast({ title: t('manageUsers.timeLimit.removedTitle'), description: t('manageUsers.timeLimit.removedDesc') });
      setTimeLimitDialogOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error removing time limit:', error);
      toast({ title: t('common.error'), description: error.message || t('common.error'), variant: 'destructive' });
    } finally {
      setIsSettingTimeLimit(false);
    }
  };

  const openBulkTimeLimitDialog = () => {
    setBulkTimeLimitMode('hours');
    setBulkTimeLimitHours('24');
    setBulkTimeLimitDate('');
    setBulkTimeLimitProgress({ done: 0, total: 0 });
    setBulkTimeLimitDialogOpen(true);
  };

  // Apply a prebuilt access-limit body to every eligible selected user, looping
  // the same audited `set_access_limit` edge action used for a single user.
  // Ineligible users (admins/instructors/super_admins) are skipped, not sent.
  const runBulkAccessLimit = async (body: AccessLimitBody) => {
    const selected = users.filter((u) => selectedUsers.has(u.id));
    const { eligible, skipped } = partitionByTimeLimitEligibility(selected);
    if (eligible.length === 0) {
      toast({ title: t('common.error'), description: t('manageUsers.timeLimit.noEligible'), variant: 'destructive' });
      return;
    }

    setIsBulkSettingTimeLimit(true);
    setBulkTimeLimitProgress({ done: 0, total: eligible.length });
    let successCount = 0;
    let failedCount = 0;

    try {
      let processed = 0;
      for (const user of eligible) {
        try {
          // No explicit Authorization header: supabase-js auto-attaches the
          // caller's JWT, matching the single-user set/remove handlers.
          const { data, error } = await supabase.functions.invoke('admin-user-actions', {
            body: { ...body, userId: user.id },
          });
          if (error) {
            throw new Error((await readFunctionError(error)) || t('common.error'));
          }
          if (data?.error) {
            throw new Error(data.error);
          }
          successCount++;
        } catch (err) {
          console.error(`Error setting time limit for user ${user.id}:`, err);
          failedCount++;
        }
        processed++;
        setBulkTimeLimitProgress({ done: processed, total: eligible.length });
      }

      // Build a localized summary: "N updated, M skipped, K failed".
      const parts = [`${successCount} ${t('manageUsers.timeLimit.bulkUpdated')}`];
      if (skipped.length > 0) parts.push(`${skipped.length} ${t('manageUsers.timeLimit.bulkSkippedWord')}`);
      if (failedCount > 0) parts.push(`${failedCount} ${t('manageUsers.usersFailed')}`);
      toast({
        title: successCount > 0 ? t('manageUsers.timeLimit.bulkDoneTitle') : t('common.error'),
        description: parts.join(', '),
        variant: failedCount > 0 ? 'destructive' : 'default',
      });

      setBulkTimeLimitDialogOpen(false);
      setSelectedUsers(new Set());
      fetchUsers();
    } catch (error) {
      console.error('Error in bulk time limit:', error);
      toast({ title: t('common.error'), description: (error as Error)?.message || t('common.error'), variant: 'destructive' });
    } finally {
      setIsBulkSettingTimeLimit(false);
    }
  };

  const handleBulkSetTimeLimit = async () => {
    const result = buildAccessLimitBody({
      mode: bulkTimeLimitMode,
      hours: bulkTimeLimitHours,
      date: bulkTimeLimitDate,
    });
    if (!result.ok) {
      const desc =
        result.code === 'invalid_hours'
          ? t('manageUsers.timeLimit.invalidHours')
          : t('manageUsers.timeLimit.invalidDate');
      toast({ title: t('common.error'), description: desc, variant: 'destructive' });
      return;
    }
    await runBulkAccessLimit(result.body);
  };

  const handleBulkRemoveTimeLimit = async () => {
    const result = buildAccessLimitBody({ mode: 'clear' });
    if (result.ok) await runBulkAccessLimit(result.body);
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
          title: t('manageUsers.userRemovedFromOrg'),
          description: t('manageUsers.userRemovedFromOrgDesc'),
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
    setBulkDeleteProgress({ done: 0, total: selectedUsers.size });
    let successCount = 0;
    let failedCount = 0;

    try {
      const { data: sessionData } = await supabase.auth.getSession();

      let processed = 0;
      for (const userId of selectedUsers) {
        const user = users.find(u => u.id === userId);
        if (!user) {
          processed++;
          setBulkDeleteProgress({ done: processed, total: selectedUsers.size });
          continue;
        }

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
        processed++;
        setBulkDeleteProgress({ done: processed, total: selectedUsers.size });
      }

      toast({
        title: t('manageUsers.deletionCompleted'),
        description: `${successCount} ${t('manageUsers.usersDeleted')}${failedCount > 0 ? `, ${failedCount} ${t('manageUsers.usersFailed')}` : ''}`,
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

  // Eligible / skipped breakdown for the bulk time-limit dialog.
  const bulkSelectedUsers = users.filter((u) => selectedUsers.has(u.id));
  const bulkEligibleCount = bulkSelectedUsers.filter((u) => isTimeLimitEligible(u.role)).length;
  const bulkSkippedCount = bulkSelectedUsers.length - bulkEligibleCount;

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
                {t('manageUsers.headerSubtitle')}
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
                    placeholder={t('manageUsers.fullNamePlaceholder')}
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
                    onValueChange={(value: 'admin' | 'instructor' | 'student' | 'lead') =>
                      setInviteForm({ ...inviteForm, role: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('admin.selectRole')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">{t('admin.lead')}</SelectItem>
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
                    placeholder={t('manageUsers.passwordAutoGenerated')}
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
            {t('manageUsers.importFromFile')}
          </Button>
          )}

          {canEdit && (
          <Button variant="outline" onClick={handleExportUsers}>
            <Download className="w-4 h-4 mx-2" />
            {t('manageUsers.exportToFile')}
          </Button>
          )}

          {canEdit && isSuperAdmin && (
            <Button variant="outline" onClick={handleSyncEmails} disabled={isSyncingEmails}>
              {isSyncingEmails ? (
                <Loader2 className="w-4 h-4 mx-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mx-2" />
              )}
              {t('manageUsers.syncEmails')}
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
                <SelectValue placeholder={t('manageUsers.filterByRole')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('manageUsers.allRoles')}</SelectItem>
                <SelectItem value="super_admin">{t('manageUsers.superAdmin')}</SelectItem>
                <SelectItem value="admin">{t('admin.admin')}</SelectItem>
                <SelectItem value="instructor">{t('admin.instructor')}</SelectItem>
                <SelectItem value="student">{t('admin.student')}</SelectItem>
                <SelectItem value="lead">{t('admin.lead')}</SelectItem>
              </SelectContent>
            </Select>

            {!isMainTenant && (
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <BookOpen className="w-4 h-4 ml-2" />
                  <SelectValue placeholder={t('manageUsers.filterByCourse')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('manageUsers.allCourses')}</SelectItem>
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
                    {selectedUsers.size} {t('manageUsers.usersSelected')}
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
                    {t('manageUsers.changeRoles')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openBulkTimeLimitDialog}
                  >
                    <Clock className="w-4 h-4 ml-2" />
                    {t('manageUsers.setTimeLimit')}
                  </Button>
                  {!isMainTenant && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBulkAccessDialogOpen(true)}
                    >
                      <BookOpen className="w-4 h-4 ml-2" />
                      {t('manageUsers.manageAccess')}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setBulkDeleteDialogOpen(true)}
                  >
                    <Trash2 className="w-4 h-4 ml-2" />
                    {t('manageUsers.deleteSelected')}
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
                        <TableHead className="text-right">{t('manageUsers.courses')}</TableHead>
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
                          {user.accessExpiresAt && !user.accessRevokedAt && (
                            <Badge
                              variant="outline"
                              className="ms-1 gap-1"
                              title={t('manageUsers.timeLimit.badgeTitle')}
                            >
                              <Clock className="w-3 h-3" />
                              {format(new Date(user.accessExpiresAt), 'P', {
                                locale: language === 'he' ? he : enUS,
                              })}
                            </Badge>
                          )}
                        </TableCell>
                        {!isMainTenant && (
                          <TableCell>
                            <Badge variant="outline">
                              {user.enrolledCourses?.length || 0}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground">
                          {format(new Date(user.join_date), language === 'he' ? 'd בMMM yyyy' : 'd MMM yyyy', { locale: language === 'he' ? he : enUS })}
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
                                  {t('manageUsers.editDetails')}
                                </DropdownMenuItem>
                              )}
                              {canEdit && (
                                <DropdownMenuItem onClick={() => openRoleDialog(user)}>
                                  <Lock className="w-4 h-4 ml-2" />
                                  {t('manageUsers.changeRole')}
                                </DropdownMenuItem>
                              )}
                              {(canEdit || (isInstructor && user.role === 'student')) && !isMainTenant && (
                                <DropdownMenuItem onClick={() => openAccessDialog(user)}>
                                  <BookOpen className="w-4 h-4 ml-2" />
                                  {t('manageUsers.manageContentAccess')}
                                </DropdownMenuItem>
                              )}
                              {!isMainTenant && (
                                <DropdownMenuItem onClick={() => openProgressDialog(user)}>
                                  <BarChart3 className="w-4 h-4 ml-2" />
                                  {t('admin.viewProgress')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => { setSubmissionsUser(user); setSubmissionsDialogOpen(true); }}>
                                <Mic className="w-4 h-4 ml-2" />
                                {t('assignment.admin.menuItem')}
                              </DropdownMenuItem>
                              {(canEdit || (isInstructor && user.role === 'student')) && <DropdownMenuSeparator />}
                              {(canEdit || (isInstructor && user.role === 'student')) && (
                                <DropdownMenuItem onClick={() => openResetPasswordDialog(user)}>
                                  <Key className="w-4 h-4 ml-2" />
                                  {t('admin.resetPassword')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openActivityDialog(user)}>
                                <History className="w-4 h-4 ml-2" />
                                {t('admin.activityHistory')}
                              </DropdownMenuItem>
                              {canEdit && (user.role === 'student' || user.role === 'lead') && (
                                <DropdownMenuItem onClick={() => openTimeLimitDialog(user)}>
                                  <Clock className="w-4 h-4 ml-2" />
                                  {t('manageUsers.setTimeLimit')}
                                </DropdownMenuItem>
                              )}
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
                                {t('manageUsers.editDetails')}
                              </DropdownMenuItem>
                            )}
                            {canEdit && (
                              <DropdownMenuItem onClick={() => openRoleDialog(user)}>
                                <Lock className="w-4 h-4 ml-2" />
                                {t('manageUsers.changeRole')}
                              </DropdownMenuItem>
                            )}
                            {(canEdit || (isInstructor && user.role === 'student')) && !isMainTenant && (
                              <DropdownMenuItem onClick={() => openAccessDialog(user)}>
                                <BookOpen className="w-4 h-4 ml-2" />
                                {t('manageUsers.manageContentAccess')}
                              </DropdownMenuItem>
                            )}
                            {!isMainTenant && (
                              <DropdownMenuItem onClick={() => openProgressDialog(user)}>
                                <BarChart3 className="w-4 h-4 ml-2" />
                                {t('admin.viewProgress')}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => { setSubmissionsUser(user); setSubmissionsDialogOpen(true); }}>
                              <Mic className="w-4 h-4 ml-2" />
                              {t('assignment.admin.menuItem')}
                            </DropdownMenuItem>
                            {(canEdit || (isInstructor && user.role === 'student')) && <DropdownMenuSeparator />}
                            {(canEdit || (isInstructor && user.role === 'student')) && (
                              <DropdownMenuItem onClick={() => openResetPasswordDialog(user)}>
                                <Key className="w-4 h-4 ml-2" />
                                {t('admin.resetPassword')}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => openActivityDialog(user)}>
                              <History className="w-4 h-4 ml-2" />
                              {t('admin.activityHistory')}
                            </DropdownMenuItem>
                            {canEdit && (user.role === 'student' || user.role === 'lead') && (
                              <DropdownMenuItem onClick={() => openTimeLimitDialog(user)}>
                                <Clock className="w-4 h-4 ml-2" />
                                {t('manageUsers.setTimeLimit')}
                              </DropdownMenuItem>
                            )}
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
                            {user.enrolledCourses?.length || 0} {t('manageUsers.coursesLower')}
                          </Badge>
                        )}
                        {user.accessExpiresAt && !user.accessRevokedAt && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(user.accessExpiresAt), 'P', {
                              locale: language === 'he' ? he : enUS,
                            })}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(user.join_date), language === 'he' ? 'd בMMM yyyy' : 'd MMM yyyy', { locale: language === 'he' ? he : enUS })}
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
            <DialogTitle>{t('manageUsers.changeRole')}</DialogTitle>
            <DialogDescription>
              {selectedUser && `${t('manageUsers.changeRoleFor')} ${selectedUser.full_name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={newRole} onValueChange={(v: 'admin' | 'instructor' | 'student' | 'super_admin' | 'lead') => setNewRole(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lead">{t('admin.lead')}</SelectItem>
                <SelectItem value="student">{t('admin.student')}</SelectItem>
                <SelectItem value="instructor">{t('admin.instructor')}</SelectItem>
                <SelectItem value="admin">{t('admin.admin')}</SelectItem>
                {isSuperAdmin && isMainTenant && (
                  <SelectItem value="super_admin">{t('manageUsers.superAdmin')}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSingleUserRoleUpdate}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single User Access Dialog */}
      <Dialog open={accessDialogOpen} onOpenChange={setAccessDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('manageUsers.manageContentAccess')}</DialogTitle>
            <DialogDescription>
              {selectedUser && `${t('manageUsers.selectCoursesFor')} ${selectedUser.full_name}`}
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
                {t('manageUsers.noCoursesAvailable')}
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
                  {t('manageUsers.saving')}
                </>
              ) : (
                t('common.save')
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
              {selectedUser && `${t('manageUsers.updateDetailsFor')} ${selectedUser.full_name}`}
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
                <Mail className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="edit_email"
                  type="email"
                  dir="ltr"
                  value={editUserForm.email}
                  onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                  className="pe-10 text-start"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_phone">{t('manageUsers.phone')}</Label>
              <div className="relative">
                <Phone className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="edit_phone"
                  type="tel"
                  dir="ltr"
                  value={editUserForm.phone}
                  onChange={(e) => setEditUserForm({ ...editUserForm, phone: e.target.value })}
                  className="pe-10 text-start"
                  placeholder="050-1234567"
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
                  {t('manageUsers.updating')}
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
            <DialogTitle>{t('manageUsers.bulkRoleChange')}</DialogTitle>
            <DialogDescription>
              {`${t('manageUsers.changeRoleFor')} ${selectedUsers.size} ${t('manageUsers.usersLower')}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={bulkNewRole} onValueChange={(v: 'admin' | 'instructor' | 'student' | 'lead') => setBulkNewRole(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lead">{t('admin.lead')}</SelectItem>
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
              {t('manageUsers.updateAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Access Dialog */}
      <Dialog open={bulkAccessDialogOpen} onOpenChange={setBulkAccessDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('manageUsers.bulkAccessManagement')}</DialogTitle>
            <DialogDescription>
              {`${t('manageUsers.manageAccessFor')} ${selectedUsers.size} ${t('manageUsers.usersLower')}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex gap-2">
              <Button
                variant={bulkAccessAction === 'add' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setBulkAccessAction('add')}
              >
                {t('manageUsers.addAccess')}
              </Button>
              <Button
                variant={bulkAccessAction === 'remove' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setBulkAccessAction('remove')}
              >
                {t('manageUsers.removeAccess')}
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
                  {t('manageUsers.updating')}
                </>
              ) : (
                t('manageUsers.updateAll')
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
              {selectedUser && `${t('manageUsers.setNewPasswordFor')} ${selectedUser.full_name}`}
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
                  placeholder={t('manageUsers.passwordMinChars')}
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

      {/* Time Limit Dialog */}
      <Dialog open={timeLimitDialogOpen} onOpenChange={setTimeLimitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('manageUsers.timeLimit.title')}</DialogTitle>
            <DialogDescription>
              {selectedUser && `${t('manageUsers.timeLimit.description')} ${selectedUser.full_name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {selectedUser?.accessExpiresAt && !selectedUser?.accessRevokedAt && (
              <div className="text-sm rounded-md bg-muted p-3 flex items-center gap-2">
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span>
                  {t('manageUsers.timeLimit.currentlyExpires')}{' '}
                  {format(new Date(selectedUser.accessExpiresAt), 'PPpp', {
                    locale: language === 'he' ? he : enUS,
                  })}
                </span>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant={timeLimitMode === 'hours' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setTimeLimitMode('hours')}
              >
                {t('manageUsers.timeLimit.modeHours')}
              </Button>
              <Button
                type="button"
                variant={timeLimitMode === 'date' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setTimeLimitMode('date')}
              >
                {t('manageUsers.timeLimit.modeDate')}
              </Button>
            </div>

            {timeLimitMode === 'hours' ? (
              <div className="space-y-2">
                <Label htmlFor="time_limit_hours">{t('manageUsers.timeLimit.hoursLabel')}</Label>
                <Input
                  id="time_limit_hours"
                  type="number"
                  min="1"
                  value={timeLimitHours}
                  onChange={(e) => setTimeLimitHours(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="time_limit_date">{t('manageUsers.timeLimit.dateLabel')}</Label>
                <Input
                  id="time_limit_date"
                  type="datetime-local"
                  value={timeLimitDate}
                  onChange={(e) => setTimeLimitDate(e.target.value)}
                />
              </div>
            )}

            <p className="text-xs text-muted-foreground">{t('manageUsers.timeLimit.hint')}</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {selectedUser?.accessExpiresAt && !selectedUser?.accessRevokedAt && (
              <Button
                variant="ghost"
                className="text-destructive focus:text-destructive me-auto"
                onClick={handleRemoveTimeLimit}
                disabled={isSettingTimeLimit}
              >
                {t('manageUsers.timeLimit.remove')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setTimeLimitDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSetTimeLimit} disabled={isSettingTimeLimit}>
              {isSettingTimeLimit ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {t('manageUsers.timeLimit.saving')}
                </>
              ) : (
                t('manageUsers.timeLimit.set')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Time-Limit Dialog */}
      <Dialog
        open={bulkTimeLimitDialogOpen}
        onOpenChange={(open) => {
          // Block close while the loop is in flight so we don't leave a partial state.
          if (isBulkSettingTimeLimit && !open) return;
          setBulkTimeLimitDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('manageUsers.timeLimit.bulkTitle')}</DialogTitle>
            <DialogDescription>{t('manageUsers.timeLimit.bulkDescription')}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="text-sm rounded-md bg-muted p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span>
                  {t('manageUsers.timeLimit.bulkEligible').replace('{count}', String(bulkEligibleCount))}
                </span>
              </div>
              {bulkSkippedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('manageUsers.timeLimit.bulkSkipped').replace('{count}', String(bulkSkippedCount))}
                </p>
              )}
            </div>

            {bulkEligibleCount === 0 ? (
              <p className="text-sm text-destructive">{t('manageUsers.timeLimit.noEligible')}</p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={bulkTimeLimitMode === 'hours' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setBulkTimeLimitMode('hours')}
                  >
                    {t('manageUsers.timeLimit.modeHours')}
                  </Button>
                  <Button
                    type="button"
                    variant={bulkTimeLimitMode === 'date' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setBulkTimeLimitMode('date')}
                  >
                    {t('manageUsers.timeLimit.modeDate')}
                  </Button>
                </div>

                {bulkTimeLimitMode === 'hours' ? (
                  <div className="space-y-2">
                    <Label htmlFor="bulk_time_limit_hours">{t('manageUsers.timeLimit.hoursLabel')}</Label>
                    <Input
                      id="bulk_time_limit_hours"
                      type="number"
                      min="1"
                      value={bulkTimeLimitHours}
                      onChange={(e) => setBulkTimeLimitHours(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="bulk_time_limit_date">{t('manageUsers.timeLimit.dateLabel')}</Label>
                    <Input
                      id="bulk_time_limit_date"
                      type="datetime-local"
                      value={bulkTimeLimitDate}
                      onChange={(e) => setBulkTimeLimitDate(e.target.value)}
                    />
                  </div>
                )}

                <p className="text-xs text-muted-foreground">{t('manageUsers.timeLimit.hint')}</p>
              </>
            )}

            {isBulkSettingTimeLimit && bulkTimeLimitProgress.total > 0 && (
              <div className="space-y-2 py-2">
                <Progress
                  value={Math.round((bulkTimeLimitProgress.done / bulkTimeLimitProgress.total) * 100)}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground text-center">
                  {t('manageUsers.bulkProgress')
                    .replace('{done}', String(bulkTimeLimitProgress.done))
                    .replace('{total}', String(bulkTimeLimitProgress.total))}
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {bulkEligibleCount > 0 && (
              <Button
                variant="ghost"
                className="text-destructive focus:text-destructive me-auto"
                onClick={handleBulkRemoveTimeLimit}
                disabled={isBulkSettingTimeLimit}
              >
                {t('manageUsers.timeLimit.remove')}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setBulkTimeLimitDialogOpen(false)}
              disabled={isBulkSettingTimeLimit}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleBulkSetTimeLimit} disabled={isBulkSettingTimeLimit || bulkEligibleCount === 0}>
              {isBulkSettingTimeLimit ? (
                <>
                  <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                  {t('manageUsers.timeLimit.saving')}
                </>
              ) : (
                t('manageUsers.timeLimit.set')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isMainTenant
                ? t('admin.deleteUserConfirm')
                : t('manageUsers.removeUserFromOrg')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUser && (
                isMainTenant
                  ? `${t('manageUsers.deleteUserPermanentPrefix')}${selectedUser.full_name}${t('manageUsers.deleteUserPermanentSuffix')}`
                  : `${t('manageUsers.removeUserFromOrgPrefix')}${selectedUser.full_name}${t('manageUsers.removeUserFromOrgSuffix')}`
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
                  {isMainTenant ? t('admin.deletingUser') : t('manageUsers.removing')}
                </>
              ) : (
                isMainTenant ? t('admin.deleteUser') : t('manageUsers.removeFromOrg')
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
              {selectedUser && `${t('manageUsers.activityHistoryFor')} ${selectedUser.full_name}`}
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
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={(open) => {
          // Block close while delete is in flight so the user can't dismiss
          // mid-loop and end up with a partial state plus no progress UI.
          if (isBulkDeleting && !open) return;
          setBulkDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`${t('manageUsers.deletePrefix')}${selectedUsers.size}${t('manageUsers.deleteSuffix')}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isMainTenant
                ? t('manageUsers.bulkDeletePermanent')
                : t('manageUsers.bulkRemoveFromOrg')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isBulkDeleting && bulkDeleteProgress.total > 0 && (
            <div className="space-y-2 py-2">
              <Progress
                value={Math.round((bulkDeleteProgress.done / bulkDeleteProgress.total) * 100)}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground text-center">
                {t('manageUsers.bulkProgress')
                  .replace('{done}', String(bulkDeleteProgress.done))
                  .replace('{total}', String(bulkDeleteProgress.total))}
              </p>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mx-2" />
                  {t('manageUsers.deleting')}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mx-2" />
                  {t('common.delete')}
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

      {/* Assignment Submissions Dialog */}
      <AssignmentSubmissionsDialog
        open={submissionsDialogOpen}
        onOpenChange={setSubmissionsDialogOpen}
        user={submissionsUser}
      />
    </>
  );
}

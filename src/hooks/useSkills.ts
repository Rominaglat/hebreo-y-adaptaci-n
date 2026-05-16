import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface Skill {
  id: string;
  name: string;
  description: string | null;
  long_description: string | null;
  author_id: string | null;
  category: string;
  tags: string[];
  trigger_pattern: string | null;
  icon_name: string | null;
  current_version_id: string | null;
  status: 'draft' | 'submitted' | 'scanning' | 'approved' | 'rejected';
  is_featured: boolean;
  download_count: number;
  avg_rating: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  author_name?: string;
  author_avatar?: string;
}

export interface SkillVersion {
  id: string;
  skill_id: string;
  version: number;
  file_path: string;
  file_hash: string;
  content_preview: string | null;
  status: 'submitted' | 'scanning' | 'approved' | 'rejected';
  scan_result: any;
  scan_completed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  submitted_by: string;
  created_at: string;
}

export interface SkillRating {
  id: string;
  skill_id: string;
  user_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  user_avatar?: string;
}

export type SkillSortBy = 'newest' | 'popular' | 'top_rated';
export type SkillCategory = 'general' | 'coding' | 'devops' | 'testing' | 'documentation' | 'security' | 'design' | 'data';

export const SKILL_CATEGORIES: SkillCategory[] = ['general', 'coding', 'devops', 'testing', 'documentation', 'security', 'design', 'data'];

interface SkillsFilter {
  search?: string;
  category?: string;
  sortBy?: SkillSortBy;
  page?: number;
  pageSize?: number;
}

export const SKILLS_PAGE_SIZE = 24;

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${data.session?.access_token}`,
  };
}

export function useSkills(filters: SkillsFilter = {}) {
  const { search, category, sortBy = 'newest', page = 0, pageSize = SKILLS_PAGE_SIZE } = filters;

  return useQuery({
    queryKey: ['skills', 'approved', search, category, sortBy, page, pageSize],
    queryFn: async () => {
      let query = supabase
        .from('skills' as any)
        .select('*', { count: 'exact' })
        .eq('status', 'approved');

      if (category && category !== 'all') {
        query = query.eq('category', category);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
      }

      switch (sortBy) {
        case 'popular':
          query = query.order('download_count', { ascending: false });
          break;
        case 'top_rated':
          query = query.order('avg_rating', { ascending: false });
          break;
        case 'newest':
        default:
          query = query.order('created_at', { ascending: false });
          break;
      }

      query = query.range(page * pageSize, (page + 1) * pageSize - 1);

      const { data, error, count } = await query;
      if (error) throw error;
      return { skills: (data || []) as Skill[], total: count || 0 };
    },
  });
}

export function useMySkills() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['skills', 'mine', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('skills' as any)
        .select('*')
        .eq('author_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as Skill[];
    },
    enabled: !!user,
  });
}

export function useSkillDetail(skillId: string | undefined) {
  return useQuery({
    queryKey: ['skill', skillId],
    queryFn: async () => {
      if (!skillId) return null;
      const { data, error } = await supabase
        .from('skills' as any)
        .select('*')
        .eq('id', skillId)
        .single();

      if (error) throw error;
      return data as Skill;
    },
    enabled: !!skillId,
  });
}

export function useSkillVersions(skillId: string | undefined) {
  return useQuery({
    queryKey: ['skill_versions', skillId],
    queryFn: async () => {
      if (!skillId) return [];
      const { data, error } = await supabase
        .from('skill_versions' as any)
        .select('*')
        .eq('skill_id', skillId)
        .order('version', { ascending: false });

      if (error) throw error;
      return (data || []) as SkillVersion[];
    },
    enabled: !!skillId,
  });
}

export function useSkillRatings(skillId: string | undefined) {
  return useQuery({
    queryKey: ['skill_ratings', skillId],
    queryFn: async () => {
      if (!skillId) return [];
      const { data, error } = await supabase
        .from('skill_ratings' as any)
        .select('*')
        .eq('skill_id', skillId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as SkillRating[];
    },
    enabled: !!skillId,
  });
}

export function useUserSkillRating(skillId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['skill_rating', skillId, user?.id],
    queryFn: async () => {
      if (!skillId || !user) return null;
      const { data, error } = await supabase
        .from('skill_ratings' as any)
        .select('*')
        .eq('skill_id', skillId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return data as SkillRating | null;
    },
    enabled: !!skillId && !!user,
  });
}

export function useSubmitSkill() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
      long_description?: string;
      category: string;
      tags?: string[];
      trigger_pattern?: string;
      icon_name?: string;
      file_content: string;
      skill_id?: string; // for new version of existing skill
    }) => {
      const headers = await getAuthHeaders();
      const response = await supabase.functions.invoke('skill-submit', {
        body: { action: 'submit', ...params },
        headers,
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });
}

export function useRateSkill() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { skill_id: string; rating: number; review_text?: string }) => {
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('skill_ratings' as any)
        .upsert({
          skill_id: params.skill_id,
          user_id: user.id,
          rating: params.rating,
          review_text: params.review_text || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'skill_id,user_id' });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['skill_ratings', variables.skill_id] });
      queryClient.invalidateQueries({ queryKey: ['skill_rating', variables.skill_id] });
      queryClient.invalidateQueries({ queryKey: ['skill', variables.skill_id] });
    },
  });
}

export function useDownloadSkill() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { skill_id: string; skill_name: string }) => {
      if (!user) throw new Error('Not authenticated');

      // Get file content via edge function
      const headers = await getAuthHeaders();
      const response = await supabase.functions.invoke('skill-submit', {
        body: { action: 'get_file_content', skill_id: params.skill_id },
        headers,
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);

      const content = response.data.content;

      // Record download
      await supabase.from('skill_downloads' as any).insert({
        skill_id: params.skill_id,
        user_id: user.id,
      });

      // Trigger browser download
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${params.skill_name.replace(/[^a-zA-Z0-9-_]/g, '_')}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return content;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['skill', variables.skill_id] });
    },
  });
}

export function useAdminSkillAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      action: 'approve' | 'reject' | 'feature' | 'rescan' | 'delete';
      version_id?: string;
      skill_id?: string;
      notes?: string;
      is_featured?: boolean;
    }) => {
      const headers = await getAuthHeaders();
      const response = await supabase.functions.invoke('skill-admin-actions', {
        body: params,
        headers,
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill'] });
      queryClient.invalidateQueries({ queryKey: ['skill_versions'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });
}

export function useUpdateSkillMetadata() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      skill_id: string;
      name?: string;
      description?: string;
      long_description?: string;
      category?: string;
      tags?: string[];
      trigger_pattern?: string;
      icon_name?: string;
    }) => {
      const headers = await getAuthHeaders();
      const response = await supabase.functions.invoke('skill-submit', {
        body: { action: 'update_metadata', ...params },
        headers,
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill', variables.skill_id] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });
}

/**
 * Admin-only: fetch full file content for any skill version (not just approved ones).
 */
export function useFetchVersionContent() {
  return useMutation({
    mutationFn: async (params: { version_id: string }) => {
      const headers = await getAuthHeaders();
      const response = await supabase.functions.invoke('skill-admin-actions', {
        body: { action: 'get_version_content', version_id: params.version_id },
        headers,
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.content as string;
    },
  });
}

export interface AuditLogEntry {
  id: string;
  action: string;
  skill_id: string | null;
  version_id: string | null;
  actor_id: string | null;
  notes: string | null;
  metadata: any;
  created_at: string;
}

export function useSkillAuditLog(skillId?: string) {
  return useQuery({
    queryKey: ['skill_audit_log', skillId],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await supabase.functions.invoke('skill-admin-actions', {
        body: { action: 'list_audit_log', skill_id: skillId },
        headers,
      });
      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);
      return (response.data?.entries || []) as AuditLogEntry[];
    },
  });
}

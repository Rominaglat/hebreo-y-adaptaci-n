import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface RecommendedCourse {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  module_count: number;
  reason: string; // human-readable reason (legacy/fallback)
  reasonType: 'popular' | 'new' | 'unfinished' | 'next' | 'kg_similar';
  /**
   * Translation-friendly metadata. The consumer should prefer rendering
   * via i18n keyed off `reasonType` + this payload instead of the raw
   * `reason` string above (which is left in Hebrew for fallback).
   */
  reasonData?: {
    progress?: number; // for unfinished: rounded percent
    sharedConcepts?: number; // for kg_similar concept-overlap
    kgSource?: 'concept_overlap' | 'fallback' | string;
  };
}

interface KgRecommendation {
  course_id: string;
  course_title: string;
  description: string | null;
  thumbnail_url: string | null;
  shared_concepts: number;
  total_mentions: number;
}

interface EnrolledCourseRow {
  course_id: string;
  progress_percentage: number | null;
  courses: {
    id: string;
    title: string;
    description: string | null;
    thumbnail_url: string | null;
  } | null;
}

interface CourseRow {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  created_at: string;
  is_published: boolean;
}

/**
 * Generates personalized course recommendations.
 *
 * Strategy (in priority order):
 * 1. Unfinished courses (progress > 0 && < 100) — continue progress
 * 2. KG-based "courses similar to what you've started" via the kg-recommend
 *    edge function (concept overlap with already-enrolled courses)
 * 3. Newest published courses the user hasn't enrolled in — new on platform
 *
 * The KG step is best-effort: if it fails (function down, tenant not in KG,
 * etc.) we silently fall through to the "newest courses" heuristic.
 */
export function useRecommendations(limit = 4) {
  const { user, session } = useAuth();
  const [recommendations, setRecommendations] = useState<RecommendedCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        // Fetch enrolled courses with progress
        const { data: enrolled } = await supabase
          .from('enrollments')
          .select(
            `course_id, progress_percentage, courses(id, title, description, thumbnail_url)`
          )
          .eq('user_id', user.id);

        const enrolledRows = (enrolled || []) as unknown as EnrolledCourseRow[];
        const enrolledIds = new Set(enrolledRows.map((e) => e.course_id));

        // 1. Unfinished courses (in progress)
        const unfinished: RecommendedCourse[] = enrolledRows
          .filter((e) => e.courses && (e.progress_percentage ?? 0) > 0 && (e.progress_percentage ?? 0) < 100)
          .sort((a, b) => (b.progress_percentage ?? 0) - (a.progress_percentage ?? 0))
          .slice(0, limit)
          .map((e) => ({
            id: e.courses!.id,
            title: e.courses!.title,
            description: e.courses!.description,
            thumbnail_url: e.courses!.thumbnail_url,
            module_count: 0,
            // Legacy fallback: prefer translating via reasonType + reasonData in the consumer.
            reason: `${Math.round(e.progress_percentage ?? 0)}%`,
            reasonType: 'unfinished' as const,
            reasonData: { progress: Math.round(e.progress_percentage ?? 0) },
          }));

        let remaining = limit - unfinished.length;

        // 2. KG-based concept-overlap recommendations (best-effort)
        let kgRecs: RecommendedCourse[] = [];
        if (remaining > 0 && session) {
          try {
            const resp = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kg-recommend`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ limit: remaining + 4 }),
              }
            );
            if (resp.ok) {
              const data = await resp.json();
              const recs = (data.recommendations || []) as KgRecommendation[];
              kgRecs = recs
                .filter((r) => !enrolledIds.has(r.course_id))
                .slice(0, remaining)
                .map((r) => ({
                  id: r.course_id,
                  title: r.course_title,
                  description: r.description,
                  thumbnail_url: r.thumbnail_url,
                  module_count: 0,
                  // Legacy fallback: prefer translating via reasonType + reasonData in the consumer.
                  reason: data.source === 'concept_overlap'
                    ? `${r.shared_concepts}`
                    : '',
                  reasonType: 'kg_similar' as const,
                  reasonData: {
                    sharedConcepts: r.shared_concepts,
                    kgSource: data.source,
                  },
                }));
            }
          } catch (e) {
            console.warn('kg-recommend failed, falling back to newest', e);
          }
        }

        remaining = limit - unfinished.length - kgRecs.length;

        // 3. Fill remaining slots with newest courses not enrolled (and not in kgRecs)
        const kgRecIds = new Set(kgRecs.map((r) => r.id));
        let newCourses: RecommendedCourse[] = [];
        if (remaining > 0) {
          const { data: latest } = await supabase
            .from('courses')
            .select('id, title, description, thumbnail_url, created_at, is_published')
            .eq('is_published', true)
            .order('created_at', { ascending: false })
            .limit(remaining + 8); // fetch extra to filter out enrolled

          const courseRows = (latest || []) as CourseRow[];
          newCourses = courseRows
            .filter((c) => !enrolledIds.has(c.id) && !kgRecIds.has(c.id))
            .slice(0, remaining)
            .map((c) => ({
              id: c.id,
              title: c.title,
              description: c.description,
              thumbnail_url: c.thumbnail_url,
              module_count: 0,
              // Legacy fallback: prefer translating via reasonType in the consumer.
              reason: '',
              reasonType: 'new' as const,
            }));
        }

        if (!cancelled) {
          setRecommendations([...unfinished, ...kgRecs, ...newCourses]);
        }
      } catch (e) {
        console.error('Failed to compute recommendations', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, session, limit]);

  return { recommendations, loading };
}

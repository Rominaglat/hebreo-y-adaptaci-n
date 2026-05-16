import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

type BookmarkType = 'favorite' | 'watch_later';

export function useLessonBookmarks(lessonIds: string[]) {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const makeKey = (lessonId: string, type: BookmarkType) => `${lessonId}_${type}`;

  const fetchBookmarks = useCallback(async () => {
    if (!user || lessonIds.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('lesson_bookmarks')
        .select('lesson_id, bookmark_type')
        .eq('user_id', user.id)
        .in('lesson_id', lessonIds);

      if (error) throw error;
      const set = new Set<string>();
      (data || []).forEach(row => set.add(makeKey(row.lesson_id, row.bookmark_type as BookmarkType)));
      setBookmarks(set);
    } catch (error) {
      console.error('Error fetching bookmarks:', error);
    }
  }, [user, lessonIds.join(',')]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const isBookmarked = useCallback((lessonId: string, type: BookmarkType) => {
    return bookmarks.has(makeKey(lessonId, type));
  }, [bookmarks]);

  const toggleBookmark = useCallback(async (lessonId: string, type: BookmarkType) => {
    if (!user || loading) return;
    setLoading(true);
    const key = makeKey(lessonId, type);
    const wasBookmarked = bookmarks.has(key);

    // Optimistic update
    setBookmarks(prev => {
      const next = new Set(prev);
      if (wasBookmarked) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

    try {
      if (wasBookmarked) {
        const { error } = await supabase
          .from('lesson_bookmarks')
          .delete()
          .eq('user_id', user.id)
          .eq('lesson_id', lessonId)
          .eq('bookmark_type', type);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('lesson_bookmarks')
          .insert({
            user_id: user.id,
            lesson_id: lessonId,
            bookmark_type: type,
          });
        if (error) throw error;
      }
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      // Revert optimistic update
      setBookmarks(prev => {
        const next = new Set(prev);
        if (wasBookmarked) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [user, bookmarks, loading]);

  return { isBookmarked, toggleBookmark, loading };
}

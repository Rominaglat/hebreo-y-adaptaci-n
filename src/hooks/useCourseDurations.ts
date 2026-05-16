import { useState, useEffect, useRef } from 'react';

interface CourseLesson {
  id: string;
  video_url: string | null;
  lesson_type: string;
}

interface CourseModule {
  id: string;
  lessons: CourseLesson[];
}

interface CourseWithModules {
  id: string;
  modules: CourseModule[];
}

// Global cache for video durations (persists across component mounts)
const videoDurationCache: Record<string, number> = {};
// Negative cache: video IDs we already know fail (private/unlisted videos
// that the public oEmbed API can't access). Skipped to avoid re-issuing
// 403/404 requests on every navigation.
const videoDurationFailures = new Set<string>();

// Load cache from localStorage on init
try {
  const cached = localStorage.getItem('vimeo_duration_cache');
  if (cached) {
    const parsed = JSON.parse(cached);
    Object.assign(videoDurationCache, parsed);
  }
  const failedRaw = sessionStorage.getItem('vimeo_oembed_failures');
  if (failedRaw) {
    for (const id of JSON.parse(failedRaw) as string[]) {
      videoDurationFailures.add(id);
    }
  }
} catch {
  // Ignore storage errors
}

function markFailure(videoId: string) {
  videoDurationFailures.add(videoId);
  try {
    sessionStorage.setItem(
      'vimeo_oembed_failures',
      JSON.stringify([...videoDurationFailures])
    );
  } catch {
    // Ignore storage errors
  }
}

// Save cache to localStorage (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function saveCacheToStorage() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem('vimeo_duration_cache', JSON.stringify(videoDurationCache));
    } catch (e) {
      // Ignore storage errors
    }
  }, 1000);
}

export function useCourseDurations(courses: CourseWithModules[]) {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (courses.length === 0) return;

    // Abort previous fetch if still running
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const fetchAllDurations = async () => {
      const newDurations: Record<string, number> = {};
      const uncachedVideos: { courseId: string; videoId: string }[] = [];

      // First pass: calculate from cache and collect uncached videos
      for (const course of courses) {
        let totalSeconds = 0;
        let hasUncached = false;

        for (const module of course.modules || []) {
          for (const lesson of module.lessons || []) {
            if (lesson.lesson_type === 'video' && lesson.video_url) {
              const videoId = extractVimeoId(lesson.video_url);
              if (videoId) {
                if (videoDurationCache[videoId] !== undefined) {
                  totalSeconds += videoDurationCache[videoId];
                } else {
                  hasUncached = true;
                  uncachedVideos.push({ courseId: course.id, videoId });
                }
              }
            }
          }
        }

        // If all videos are cached, set duration immediately
        if (!hasUncached && totalSeconds > 0) {
          newDurations[course.id] = Math.round(totalSeconds / 60);
        }
      }

      // Set cached durations immediately
      if (Object.keys(newDurations).length > 0) {
        setDurations(prev => ({ ...prev, ...newDurations }));
      }

      // Batch fetch uncached videos (limit concurrent requests)
      if (uncachedVideos.length > 0) {
        const uniqueVideoIds = [...new Set(uncachedVideos.map(v => v.videoId))];
        const batchSize = 5; // Fetch 5 at a time
        
        for (let i = 0; i < uniqueVideoIds.length; i += batchSize) {
          if (abortControllerRef.current?.signal.aborted) break;
          
          const batch = uniqueVideoIds.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map(videoId => getVimeoDuration(videoId))
          );

          results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value !== null) {
              videoDurationCache[batch[index]] = result.value;
            }
          });

          saveCacheToStorage();

          // Recalculate durations with new cache data
          const updatedDurations: Record<string, number> = {};
          for (const course of courses) {
            let totalSeconds = 0;
            for (const module of course.modules || []) {
              for (const lesson of module.lessons || []) {
                if (lesson.lesson_type === 'video' && lesson.video_url) {
                  const videoId = extractVimeoId(lesson.video_url);
                  if (videoId && videoDurationCache[videoId] !== undefined) {
                    totalSeconds += videoDurationCache[videoId];
                  }
                }
              }
            }
            if (totalSeconds > 0) {
              updatedDurations[course.id] = Math.round(totalSeconds / 60);
            }
          }

          if (!abortControllerRef.current?.signal.aborted) {
            setDurations(prev => ({ ...prev, ...updatedDurations }));
          }
        }
      }
    };

    fetchAllDurations();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [courses]);

  return durations;
}

function extractVimeoId(url: string): string | null {
  const match = url.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  return match ? match[1] : null;
}

async function getVimeoDuration(videoId: string): Promise<number | null> {
  if (videoDurationFailures.has(videoId)) return null;
  try {
    const response = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`);
    if (!response.ok) {
      markFailure(videoId);
      return null;
    }
    const data = await response.json();
    return data?.duration || null;
  } catch {
    markFailure(videoId);
    return null;
  }
}

export function formatCourseDuration(minutes: number, t: (key: string) => string): string {
  if (minutes < 60) {
    return `${minutes} ${t('courses.minutes')}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} ${t('courses.hours')}`;
  }
  return `${hours}:${remainingMinutes.toString().padStart(2, '0')} ${t('courses.hours')}`;
}

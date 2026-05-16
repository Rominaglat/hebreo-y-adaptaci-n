import { useState, useEffect } from 'react';

export function useVideoDuration(lessons: { id: string; video_url: string | null; lesson_type: string }[]) {
  const [durations, setDurations] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchDurations = async () => {
      const newDurations: Record<string, string> = {};
      
      for (const lesson of lessons) {
        if (lesson.lesson_type === 'video' && lesson.video_url) {
          const duration = await getVideoDuration(lesson.video_url);
          if (duration) {
            newDurations[lesson.id] = duration;
          }
        }
      }
      
      if (Object.keys(newDurations).length > 0) {
        setDurations(prev => ({ ...prev, ...newDurations }));
      }
    };

    if (lessons.length > 0) {
      fetchDurations();
    }
  }, [lessons]);

  return durations;
}

async function getVideoDuration(url: string): Promise<string | null> {
  // Extract Vimeo video ID from various URL formats
  // Supports: vimeo.com/123456789, player.vimeo.com/video/123456789
  const vimeoMatch = url.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  if (vimeoMatch) {
    return getVimeoDuration(vimeoMatch[1]);
  }

  // Check if it's a YouTube URL
  const youtubeMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (youtubeMatch) {
    // YouTube API requires an API key - skip for now
    return null;
  }

  return null;
}

// Cache failed video IDs in sessionStorage so we don't re-issue requests that
// will always 403/404 (private/unlisted Vimeo videos that aren't accessible
// via the public oEmbed API). This avoids spamming the browser network log
// with the same failed requests on every navigation.
const FAILED_KEY = 'vimeo_oembed_failures';
function isKnownFailure(videoId: string): boolean {
  try {
    const raw = sessionStorage.getItem(FAILED_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as string[]).includes(videoId);
  } catch {
    return false;
  }
}
function markFailure(videoId: string) {
  try {
    const raw = sessionStorage.getItem(FAILED_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(videoId)) {
      list.push(videoId);
      sessionStorage.setItem(FAILED_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore storage errors
  }
}

async function getVimeoDuration(videoId: string): Promise<string | null> {
  if (isKnownFailure(videoId)) return null;
  try {
    // Use oEmbed API which works for public videos. Private/unlisted videos
    // return 403/404 here — that's expected and handled silently.
    const response = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`);
    if (!response.ok) {
      markFailure(videoId);
      return null;
    }

    const data = await response.json();
    if (data && data.duration) {
      const totalSeconds = data.duration;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  } catch {
    markFailure(videoId);
  }
  return null;
}

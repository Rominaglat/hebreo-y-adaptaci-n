import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Json } from '@/integrations/supabase/types';
import { useLanguage } from '@/contexts/LanguageContext';

interface VideoState {
  playing: boolean;
  currentTime: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface UseSyncedVideoProps {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
}

export const useSyncedVideo = ({ roomId, userId, userName, isHost }: UseSyncedVideoProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [sharedVideoUrl, setSharedVideoUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState>({
    playing: false,
    currentTime: 0,
    updatedAt: null,
    updatedBy: null,
  });
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSeeking = useRef(false);
  const isLocalAction = useRef(false);
  const syncDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // Live mirrors of state read inside the realtime subscription. Reading these
  // from refs (instead of listing them as effect deps) stops the channel from
  // being torn down and recreated on every single video-state change — that
  // churn was dropping sync events mid-resubscribe.
  const sharedVideoUrlRef = useRef<string | null>(sharedVideoUrl);
  const lastSyncTimeRef = useRef<number>(lastSyncTime);
  useEffect(() => { sharedVideoUrlRef.current = sharedVideoUrl; }, [sharedVideoUrl]);
  useEffect(() => { lastSyncTimeRef.current = lastSyncTime; }, [lastSyncTime]);

  // Fetch initial video state
  useEffect(() => {
    const fetchVideoState = async () => {
      const { data, error } = await supabase
        .from('rooms')
        .select('shared_video_url, shared_video_state')
        .eq('id', roomId)
        .maybeSingle();

      if (data) {
        setSharedVideoUrl(data.shared_video_url);
        if (data.shared_video_state && typeof data.shared_video_state === 'object') {
          const rawState = data.shared_video_state as Record<string, unknown>;
          const state: VideoState = {
            playing: Boolean(rawState.playing),
            currentTime: Number(rawState.currentTime) || 0,
            updatedAt: rawState.updatedAt as string | null,
            updatedBy: rawState.updatedBy as string | null,
          };
          setVideoState(state);
          
          // Sync video to initial state
          if (videoRef.current && state.currentTime > 0) {
            videoRef.current.currentTime = state.currentTime;
          }
        }
      }
    };

    fetchVideoState();
  }, [roomId]);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel(`room-video-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const newData = payload.new as any;
          
          // Update shared video URL
          if (newData.shared_video_url !== sharedVideoUrlRef.current) {
            sharedVideoUrlRef.current = newData.shared_video_url;
            setSharedVideoUrl(newData.shared_video_url);
            if (newData.shared_video_url) {
              toast({
                title: t('syncedVideo.sharedTitle'),
                description: t('syncedVideo.sharedDesc'),
              });
            }
          }

          // Update video state
          if (newData.shared_video_state && typeof newData.shared_video_state === 'object') {
            const rawState = newData.shared_video_state as Record<string, unknown>;
            const state: VideoState = {
              playing: Boolean(rawState.playing),
              currentTime: Number(rawState.currentTime) || 0,
              updatedAt: rawState.updatedAt as string | null,
              updatedBy: rawState.updatedBy as string | null,
            };
            
            // Only apply if it's from someone else and newer
            const stateTime = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
            if (state.updatedBy !== userId && stateTime > lastSyncTimeRef.current) {
              lastSyncTimeRef.current = stateTime;
              setVideoState(state);
              setLastSyncTime(stateTime);

              // Sync the video element — skip if we're currently doing a
              // local action (otherwise the local play/seek fights with
              // the broadcast).
              if (videoRef.current && !isSeeking.current && !isLocalAction.current) {
                const timeDiff = Math.abs(videoRef.current.currentTime - state.currentTime);
                if (timeDiff > 1) {
                  isSeeking.current = true;
                  videoRef.current.currentTime = state.currentTime;
                  setTimeout(() => { isSeeking.current = false; }, 500);
                }

                if (state.playing && videoRef.current.paused) {
                  videoRef.current.play().catch(() => {});
                } else if (!state.playing && !videoRef.current.paused) {
                  videoRef.current.pause();
                }
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // sharedVideoUrl / lastSyncTime are intentionally read via refs (above) and
    // omitted here so the channel is created ONCE per room, not re-created on
    // every video-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId, toast, t]);

  // Update video in database. Collaborative: ANY participant may choose/clear
  // the shared video (the room owner asked for shared control).
  const updateSharedVideo = useCallback(async (url: string | null) => {
    const videoStateJson: Json = {
      playing: false,
      currentTime: 0,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    
    const { error } = await supabase
      .from('rooms')
      .update({
        shared_video_url: url,
        shared_video_state: videoStateJson,
      })
      .eq('id', roomId);

    if (!error) {
      setSharedVideoUrl(url);
      setLastSyncTime(Date.now());
    }
  }, [roomId, userId, isHost]);

  // Update video state (play/pause/seek) - debounced to prevent flooding.
  // Collaborative: anyone can play/pause/seek for the room.
  const updateVideoState = useCallback(async (playing: boolean, currentTime: number) => {
    // Clear any pending debounce
    if (syncDebounceRef.current) {
      clearTimeout(syncDebounceRef.current);
    }

    // Mark that we're doing a local action
    isLocalAction.current = true;

    const newState: VideoState = {
      playing,
      currentTime,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    const stateJson: Json = {
      playing: newState.playing,
      currentTime: newState.currentTime,
      updatedAt: newState.updatedAt,
      updatedBy: newState.updatedBy,
    };

    const { error } = await supabase
      .from('rooms')
      .update({
        shared_video_state: stateJson,
      })
      .eq('id', roomId);

    if (!error) {
      setVideoState(newState);
      setLastSyncTime(Date.now());
    }

    // Reset local action flag after a delay
    syncDebounceRef.current = setTimeout(() => {
      isLocalAction.current = false;
    }, 300);
  }, [roomId, userId, isHost]);

  // Video event handlers
  const handlePlay = useCallback(() => {
    if (videoRef.current && !isSeeking.current) {
      updateVideoState(true, videoRef.current.currentTime);
    }
  }, [updateVideoState]);

  const handlePause = useCallback(() => {
    if (videoRef.current && !isSeeking.current) {
      updateVideoState(false, videoRef.current.currentTime);
    }
  }, [updateVideoState]);

  const handleSeek = useCallback(() => {
    if (videoRef.current) {
      updateVideoState(!videoRef.current.paused, videoRef.current.currentTime);
    }
  }, [updateVideoState]);

  return {
    sharedVideoUrl,
    videoState,
    videoRef,
    updateSharedVideo,
    updateVideoState,
    handlePlay,
    handlePause,
    handleSeek,
  };
};

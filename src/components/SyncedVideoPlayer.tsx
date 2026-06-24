import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, X, Volume2, VolumeX, SkipBack, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { useLanguage } from '@/contexts/LanguageContext';

// Max amplification via Web Audio GainNode. 1.0 = native, 2.0 = 200%.
const MAX_VOLUME = 2;

interface SyncedVideoPlayerProps {
  videoUrl: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  onPlay: () => void;
  onPause: () => void;
  onSeek: () => void;
  onClose: () => void;
  canClose?: boolean;
  // When false, the transport controls (play/pause/seek/skip) are disabled —
  // only the host drives playback; everyone else follows the synced state.
  canControl?: boolean;
  videoState: {
    playing: boolean;
    currentTime: number;
  };
  // Exposes a post-gain MediaStream of the video's audio so the recorder can
  // mix it in. An HTMLMediaElement allows only ONE MediaElementAudioSourceNode
  // for its lifetime — this component already claims it for the gain node — so
  // the recorder must NOT call createMediaElementSource again; it consumes this
  // stream via createMediaStreamSource instead.
  onAudioStreamReady?: (stream: MediaStream | null) => void;
  // Report a local play/pause/seek to the sync layer (host-driven). Used by the
  // YouTube/Vimeo iframe path, which can't go through the <video> handlers.
  onReportState?: (playing: boolean, currentTime: number) => void;
}

// Lazy-load the YouTube IFrame API once (mirrors LessonVideoPlayer).
let ytApiPromise: Promise<void> | null = null;
const loadYouTubeApi = (): Promise<void> => {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const w = window as any;
    if (w.YT && w.YT.Player) { resolve(); return; }
    const prevCb = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prevCb === 'function') prevCb();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  });
  return ytApiPromise;
};

const SyncedVideoPlayer = ({
  videoUrl,
  videoRef,
  onPlay,
  onPause,
  onSeek,
  onClose,
  canClose = true,
  canControl = true,
  videoState,
  onAudioStreamReady,
  onReportState,
}: SyncedVideoPlayerProps) => {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(videoState.playing);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const captureDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // --- YouTube/Vimeo iframe sync ---
  const iframeContainerRef = useRef<HTMLDivElement | null>(null);
  const iframePlayerRef = useRef<any>(null);
  const iframeKindRef = useRef<'youtube' | 'vimeo' | null>(null);
  // Latest props read inside long-lived player callbacks (avoid stale closures).
  const canControlRef = useRef(canControl);
  const onReportStateRef = useRef(onReportState);
  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { onReportStateRef.current = onReportState; }, [onReportState]);

  // Convert video URL to embeddable format or direct video
  const getVideoSrc = () => {
    // If it's a YouTube URL, extract video ID
    const youtubeMatch = videoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&\s]+)/);
    if (youtubeMatch) {
      return { type: 'youtube', id: youtubeMatch[1] };
    }
    // If it's a Vimeo URL
    const vimeoMatch = videoUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeoMatch) {
      return { type: 'vimeo', id: vimeoMatch[1] };
    }
    // Direct video URL
    return { type: 'direct', url: videoUrl };
  };

  const videoSrc = getVideoSrc();

  // Handle time update
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Handle loaded metadata
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      // Sync to initial state
      if (videoState.currentTime > 0) {
        videoRef.current.currentTime = videoState.currentTime;
      }
      if (videoState.playing) {
        videoRef.current.play().catch(console.error);
      }
      // Wire up Web Audio gain for amplification beyond native 100%
      initGain();
    }
  };

  // Initialise an AudioContext + GainNode in front of the video element so we
  // can amplify quiet shared videos beyond the 1.0 cap of HTMLMediaElement.
  const initGain = () => {
    if (!videoRef.current || audioContextRef.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = ctx.createMediaElementSource(videoRef.current);
      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      // Also fan the post-gain audio into a MediaStream so the recorder can
      // capture it without re-claiming the element's source node.
      const captureDest = ctx.createMediaStreamDestination();
      gain.connect(captureDest);
      audioContextRef.current = ctx;
      sourceNodeRef.current = source;
      gainNodeRef.current = gain;
      captureDestRef.current = captureDest;
      onAudioStreamReady?.(captureDest.stream);
    } catch (err) {
      // Non-fatal: if the browser blocks it, native volume still works.
      console.warn('[SyncedVideoPlayer] Failed to init gain node:', err);
    }
  };

  // Apply volume + mute to both the element and the gain node.
  useEffect(() => {
    if (videoRef.current) {
      // Keep element volume at 1 and scale via gain — simpler mental model.
      videoRef.current.volume = 1;
      videoRef.current.muted = isMuted;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted, videoRef]);

  // ---- YouTube/Vimeo iframe sync ----------------------------------------
  // Mirror of the incoming synced target so a player created later (onReady)
  // can snap to the current position.
  const videoStateRef = useRef(videoState);
  useEffect(() => { videoStateRef.current = videoState; }, [videoState]);

  // Drive the embedded player toward a target {playing, currentTime}. Seeks
  // only past a 1.5s drift so it doesn't fight itself; idempotent for the
  // host (already at that state), so no feedback loop.
  const applyState = useCallback((target: { playing: boolean; currentTime: number }) => {
    const player = iframePlayerRef.current;
    const kind = iframeKindRef.current;
    if (!player || !kind) return;
    try {
      if (kind === 'youtube') {
        const cur = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
        if (Math.abs(cur - target.currentTime) > 1.5 && typeof player.seekTo === 'function') {
          player.seekTo(target.currentTime, true);
        }
        const w = window as any;
        const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : null;
        const isPlaying = state === w?.YT?.PlayerState?.PLAYING;
        if (target.playing && !isPlaying) player.playVideo?.();
        else if (!target.playing && isPlaying) player.pauseVideo?.();
      } else {
        // Vimeo — promise-based API.
        player.getCurrentTime().then((cur: number) => {
          if (Math.abs(cur - target.currentTime) > 1.5) {
            player.setCurrentTime(target.currentTime).catch(() => {});
          }
        }).catch(() => {});
        player.getPaused().then((paused: boolean) => {
          if (target.playing && paused) player.play().catch(() => {});
          else if (!target.playing && !paused) player.pause().catch(() => {});
        }).catch(() => {});
      }
    } catch {
      /* noop */
    }
  }, []);

  // Re-apply whenever the synced target changes.
  useEffect(() => {
    applyState(videoState);
  }, [videoState.playing, videoState.currentTime, applyState]);

  // Create the YouTube/Vimeo player and wire bidirectional sync. Recreated
  // only when the underlying video changes.
  useEffect(() => {
    const src = getVideoSrc();
    if (src.type !== 'youtube' && src.type !== 'vimeo') return;
    const container = iframeContainerRef.current;
    if (!container) return;

    let player: any = null;
    let cancelled = false;
    iframeKindRef.current = src.type;

    const report = (playing: boolean, time: number) => {
      if (canControlRef.current) onReportStateRef.current?.(playing, time);
    };

    if (src.type === 'youtube') {
      loadYouTubeApi().then(() => {
        if (cancelled) return;
        const mount = document.createElement('div');
        mount.style.width = '100%';
        mount.style.height = '100%';
        container.innerHTML = '';
        container.appendChild(mount);
        const w = window as any;
        player = new w.YT.Player(mount, {
          width: '100%',
          height: '100%',
          videoId: src.id,
          playerVars: {
            autoplay: 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            controls: canControlRef.current ? 1 : 0,
            disablekb: canControlRef.current ? 0 : 1,
          },
          events: {
            onReady: () => {
              iframePlayerRef.current = player;
              applyState(videoStateRef.current);
            },
            onStateChange: (e: any) => {
              const time = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
              if (e.data === w.YT.PlayerState.PLAYING) report(true, time);
              else if (e.data === w.YT.PlayerState.PAUSED) report(false, time);
            },
          },
        });
      });
    } else {
      import('@vimeo/player').then(({ default: Player }) => {
        if (cancelled) return;
        container.style.position = 'relative';
        const mount = document.createElement('div');
        mount.style.position = 'absolute';
        mount.style.inset = '0';
        container.innerHTML = '';
        container.appendChild(mount);
        player = new Player(mount, {
          id: parseInt(src.id, 10),
          autoplay: false,
          controls: canControlRef.current,
        });
        iframePlayerRef.current = player;
        player.ready().then(() => {
          const iframe = mount.querySelector('iframe');
          if (iframe) {
            iframe.style.position = 'absolute';
            iframe.style.inset = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
          }
          applyState(videoStateRef.current);
        }).catch(() => {});
        player.on('play', async () => {
          try { report(true, await player.getCurrentTime()); } catch { /* noop */ }
        });
        player.on('pause', async () => {
          try { report(false, await player.getCurrentTime()); } catch { /* noop */ }
        });
        player.on('seeked', async (d: any) => {
          try {
            const paused = await player.getPaused();
            report(!paused, d?.seconds ?? await player.getCurrentTime());
          } catch { /* noop */ }
        });
      });
    }

    return () => {
      cancelled = true;
      iframePlayerRef.current = null;
      iframeKindRef.current = null;
      if (player && typeof player.destroy === 'function') {
        try {
          const r = player.destroy();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch {
          /* noop */
        }
      }
      if (container) container.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      // Release AudioContext resources on unmount.
      try {
        onAudioStreamReady?.(null);
        sourceNodeRef.current?.disconnect();
        gainNodeRef.current?.disconnect();
        captureDestRef.current?.disconnect();
        audioContextRef.current?.close();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle play/pause
  const togglePlayPause = () => {
    if (!canControl) return;
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(console.error);
      } else {
        videoRef.current.pause();
      }
    }
  };

  // Handle play event
  const handlePlayEvent = () => {
    setIsPlaying(true);
    onPlay();
  };

  // Handle pause event
  const handlePauseEvent = () => {
    setIsPlaying(false);
    onPause();
  };

  // Seek forward/backward
  const seek = (seconds: number) => {
    if (!canControl) return;
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration));
      onSeek();
    }
  };

  // Handle seek via slider
  const handleSliderChange = (value: number[]) => {
    if (!canControl) return;
    if (videoRef.current) {
      videoRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
      onSeek();
    }
  };

  // Format time
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Auto-hide controls
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // For YouTube/Vimeo embeds, mount a JS-API-controlled player (see the
  // iframe-sync effect above) so playback stays in sync across the room.
  if (videoSrc.type === 'youtube' || videoSrc.type === 'vimeo') {
    return (
      <div className="relative w-full h-full bg-black rounded-xl overflow-hidden">
        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-20 bg-black/50 hover:bg-black/70 text-white"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </Button>
        )}
        {/* The YT.Player / Vimeo Player is injected here by the effect. */}
        <div ref={iframeContainerRef} className="w-full h-full" />
        {/* Non-host click blocker: stops participants from driving the embedded
            player's native UI out of sync — only the host controls playback. */}
        {!canControl && <div className="absolute inset-0 z-10" />}
        {/* Synced indicator. */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1 pointer-events-none">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-white/80">{t('videoPlayer.syncedWithAll')}</span>
        </div>
      </div>
    );
  }

  // For direct video URLs
  return (
    <div 
      className="relative w-full h-full bg-black rounded-xl overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={videoSrc.url}
        className="w-full h-full object-contain"
        // data-synced-video lets the recording canvas treat this as the
        // primary tile (gets the big slot, just like a screen share).
        data-synced-video="true"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={handlePlayEvent}
        onPause={handlePauseEvent}
        onSeeked={onSeek}
        playsInline
      />

      {/* Controls overlay */}
      <div 
        className={cn(
          "absolute inset-0 flex flex-col justify-end transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

        {/* Close button */}
        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </Button>
        )}

        {/* Center play button */}
        <button
          onClick={togglePlayPause}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/90 hover:bg-primary flex items-center justify-center transition-transform hover:scale-110"
        >
          {isPlaying ? (
            <Pause className="w-8 h-8 sm:w-10 sm:h-10 text-primary-foreground" />
          ) : (
            <Play className="w-8 h-8 sm:w-10 sm:h-10 text-primary-foreground ml-1" />
          )}
        </button>

        {/* Bottom controls */}
        <div className="relative z-10 p-3 sm:p-4 space-y-2">
          {/* Progress bar */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-xs sm:text-sm text-white min-w-[40px]">{formatTime(currentTime)}</span>
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSliderChange}
              className="flex-1"
            />
            <span className="text-xs sm:text-sm text-white min-w-[40px]">{formatTime(duration)}</span>
          </div>

          {/* Control buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 sm:w-10 sm:h-10 text-white hover:bg-white/20"
                onClick={() => seek(-10)}
              >
                <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-10 h-10 sm:w-12 sm:h-12 text-white hover:bg-white/20"
                onClick={togglePlayPause}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 sm:w-6 sm:h-6" />
                ) : (
                  <Play className="w-5 h-5 sm:w-6 sm:h-6" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 sm:w-10 sm:h-10 text-white hover:bg-white/20"
                onClick={() => seek(10)}
              >
                <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 sm:w-10 sm:h-10 text-white hover:bg-white/20"
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? t('videoPlayer.unmute') : t('videoPlayer.mute')}
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : (
                  <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                min={0}
                max={MAX_VOLUME}
                step={0.05}
                onValueChange={(v) => {
                  const next = v[0] ?? 1;
                  setVolume(next);
                  if (next > 0 && isMuted) setIsMuted(false);
                }}
                className="w-20 sm:w-28"
                aria-label={t('videoPlayer.volume')}
              />
              <span className="text-[10px] sm:text-xs text-white/70 min-w-[32px] tabular-nums">
                {Math.round((isMuted ? 0 : volume) * 100)}%
              </span>
            </div>
          </div>

          {/* Sync indicator */}
          <div className="flex items-center justify-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-white/70">{t('videoPlayer.syncedWithAll')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyncedVideoPlayer;

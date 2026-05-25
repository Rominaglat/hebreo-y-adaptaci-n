import { useEffect, useRef, useState } from 'react';
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
  videoState: {
    playing: boolean;
    currentTime: number;
  };
}

const SyncedVideoPlayer = ({
  videoUrl,
  videoRef,
  onPlay,
  onPause,
  onSeek,
  onClose,
  canClose = true,
  videoState,
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
      source.connect(gain).connect(ctx.destination);
      audioContextRef.current = ctx;
      sourceNodeRef.current = source;
      gainNodeRef.current = gain;
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

  useEffect(() => {
    return () => {
      // Release AudioContext resources on unmount.
      try {
        sourceNodeRef.current?.disconnect();
        gainNodeRef.current?.disconnect();
        audioContextRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  // Toggle play/pause
  const togglePlayPause = () => {
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
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration));
      onSeek();
    }
  };

  // Handle seek via slider
  const handleSliderChange = (value: number[]) => {
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

  // For YouTube/Vimeo embeds, use iframe
  if (videoSrc.type === 'youtube' || videoSrc.type === 'vimeo') {
    const embedUrl = videoSrc.type === 'youtube' 
      ? `https://www.youtube.com/embed/${videoSrc.id}?enablejsapi=1&autoplay=0`
      : `https://player.vimeo.com/video/${videoSrc.id}`;

    return (
      <div className="relative w-full h-full bg-black rounded-xl overflow-hidden">
        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </Button>
        )}
        <iframe
          src={embedUrl}
          className="w-full h-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
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

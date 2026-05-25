import { useCallback, useRef } from 'react';
import { MicOff, VideoOff, Monitor, Hand, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing?: boolean;
  isLocal?: boolean;
  isLarge?: boolean;
  isSpeaking?: boolean;
  isHandRaised?: boolean;
  isHost?: boolean;
}

const VideoTile = ({
  stream,
  name,
  isMuted,
  isVideoOn,
  isScreenSharing,
  isLocal = false,
  isLarge = false,
  isSpeaking = false,
  isHandRaised = false,
  isHost = false,
}: VideoTileProps) => {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Callback ref so the stream is attached the moment the <video> element
  // mounts. The previous useEffect approach broke camera toggling: turning
  // the camera off unmounts the <video> (replaced with initials), turning
  // it back on mounts a NEW <video> element — but the useEffect on
  // `[stream]` doesn't re-fire because the stream reference is unchanged,
  // so the new element never got srcObject and stayed black.
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    if (videoRef.current && videoRef.current !== el) {
      // Release the previous element's reference so the underlying
      // MediaStream isn't held twice.
      videoRef.current.srcObject = null;
    }
    videoRef.current = el;
    if (el && stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Check if there's actually a video track to display
  const hasVideoTrack = stream?.getVideoTracks().some(track => track.enabled && track.readyState === 'live');
  const shouldShowVideo = stream && (isScreenSharing || (isVideoOn && hasVideoTrack));

  return (
    <div
      className={cn(
        // w-full h-full so the tile fills whatever container it's in
        // (grid cell, flex slot, or spotlight area). Without these the tile
        // sat at min-h-[120px] inside taller flex parents — that's what
        // made the screen share appear as a small strip with huge black
        // space below.
        "glass rounded-2xl relative overflow-hidden flex items-center justify-center min-h-[120px] w-full h-full transition-all duration-150",
        isLarge ? "col-span-2 row-span-2" : "",
        isLocal && !isSpeaking && "ring-2 ring-primary",
        // Active speaker — green ring + glow. Wins over the local-user ring
        // so even your own tile pulses when you talk.
        isSpeaking && "ring-4 ring-green-400 shadow-[0_0_24px_rgba(74,222,128,0.45)]",
      )}
    >
      {shouldShowVideo ? (
        <video
          ref={setVideoEl}
          autoPlay
          playsInline
          muted={isLocal}
          // data-screen-share lets the recording canvas pick the screen
          // share out of the pile of <video> elements and give it the big
          // slot instead of dropping it into an even grid.
          data-screen-share={isScreenSharing ? "true" : undefined}
          data-local={isLocal ? "true" : undefined}
          className={cn(
            // Cameras get object-cover (fills the tile, crops to fit —
            // matches viewer expectation). Screen shares get object-contain
            // so the full screen is visible without cropping.
            "absolute inset-0 w-full h-full",
            isScreenSharing ? "object-contain bg-black" : "object-cover",
            isLocal && !isScreenSharing && "transform scale-x-[-1]"
          )}
        />
      ) : (
        <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center text-2xl font-bold text-primary-foreground shadow-glow">
          {initials}
        </div>
      )}

      {/* Top-right corner: screen share + raised-hand stack */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        {isHandRaised && (
          <div className="px-2.5 py-1.5 rounded-full bg-amber-400/95 text-amber-950 flex items-center gap-1.5 shadow-lg animate-bounce">
            <Hand className="w-4 h-4" />
            <span className="text-xs font-semibold">{t('videoTile.handRaised')}</span>
          </div>
        )}
        {isScreenSharing && (
          <div className="px-3 py-1.5 rounded-full glass flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" />
            <span className="text-xs font-medium text-foreground">{t('videoTile.screenShare')}</span>
          </div>
        )}
      </div>

      {/* Host crown — top-left so it doesn't crowd the right-side stack. */}
      {isHost && (
        <div className="absolute top-3 left-3 px-2 py-1 rounded-full glass flex items-center gap-1.5">
          <Crown className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-medium text-foreground">{t('videoTile.host')}</span>
        </div>
      )}

      {/* Name + status pill */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
        <div className="flex items-center gap-2 glass px-3 py-1.5 rounded-full">
          <span className="text-sm font-medium text-foreground">
            {name} {isLocal && `(${t('videoTile.you')})`}
          </span>
          {isMuted && <MicOff className="w-3 h-3 text-destructive" />}
          {!isVideoOn && !isScreenSharing && <VideoOff className="w-3 h-3 text-muted-foreground" />}
        </div>
      </div>
    </div>
  );
};

export default VideoTile;

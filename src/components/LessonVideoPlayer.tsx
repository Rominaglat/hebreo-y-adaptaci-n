import { useCallback, useEffect, useRef } from 'react';
import { useWatchTime, type ReadPosition } from '@/hooks/useWatchTime';

interface LessonVideoPlayerProps {
  videoUrl: string;
  lessonId: string;
  autoplay?: boolean;
  onEnded?: () => void;
}

type VideoSource =
  | { type: 'youtube'; id: string }
  | { type: 'vimeo'; id: string }
  | { type: 'direct'; url: string };

const detectSource = (url: string): VideoSource | null => {
  const ytRegex = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|live\/|watch\?v=|&v=)([^#&?]*).*/;
  const ytMatch = url.match(ytRegex);
  if (ytMatch && ytMatch[2].length === 11) return { type: 'youtube', id: ytMatch[2] };

  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) return { type: 'vimeo', id: vimeoMatch[1] };

  if (/^https?:\/\//.test(url)) return { type: 'direct', url };
  return null;
};

let ytApiPromise: Promise<void> | null = null;
const loadYouTubeApi = (): Promise<void> => {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const w = window as any;
    if (w.YT && w.YT.Player) {
      resolve();
      return;
    }
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

export default function LessonVideoPlayer({ videoUrl, lessonId, autoplay, onEnded }: LessonVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Set by whichever player is mounted; lets watch time skip a frozen video.
  const positionRef = useRef<ReadPosition | null>(null);
  const readPosition = useCallback(() => positionRef.current?.() ?? null, []);
  // Stable callbacks: safe to call from the player events registered below.
  const watch = useWatchTime(lessonId, readPosition);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const source = detectSource(videoUrl);

  useEffect(() => {
    if (!source || source.type === 'direct') return;
    const container = containerRef.current;
    if (!container) return;

    let player: any = null;
    let cancelled = false;
    positionRef.current = null;

    if (source.type === 'youtube') {
      loadYouTubeApi().then(() => {
        if (cancelled || !container) return;
        const mountPoint = document.createElement('div');
        mountPoint.style.width = '100%';
        mountPoint.style.height = '100%';
        container.innerHTML = '';
        container.appendChild(mountPoint);

        const w = window as any;
        positionRef.current = () => (typeof player?.getCurrentTime === 'function' ? player.getCurrentTime() : null);
        player = new w.YT.Player(mountPoint, {
          width: '100%',
          height: '100%',
          videoId: source.id,
          playerVars: {
            autoplay: autoplay ? 1 : 0,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onStateChange: (event: any) => {
              // Buffering counts as stopped; YouTube reports PLAYING again once it resumes.
              if (event.data === w.YT.PlayerState.PLAYING) watch.playing();
              else watch.stopped();
              if (event.data === w.YT.PlayerState.ENDED) {
                onEndedRef.current?.();
              }
            },
            onError: () => watch.stopped(),
          },
        });
      });
    } else if (source.type === 'vimeo') {
      import('@vimeo/player').then(({ default: Player }) => {
        if (cancelled || !container) return;
        container.style.position = 'relative';
        const mountPoint = document.createElement('div');
        mountPoint.style.position = 'absolute';
        mountPoint.style.inset = '0';
        container.innerHTML = '';
        container.appendChild(mountPoint);

        player = new Player(mountPoint, {
          id: parseInt(source.id, 10),
          autoplay: !!autoplay,
          controls: true,
        });
        positionRef.current = () => player.getCurrentTime();
        player.ready().then(() => {
          const iframe = mountPoint.querySelector('iframe');
          if (iframe) {
            iframe.style.position = 'absolute';
            iframe.style.inset = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
          }
        }).catch(() => {});
        player.on('play', () => watch.playing());
        player.on('playing', () => watch.playing());
        player.on('pause', () => watch.stopped());
        player.on('bufferstart', () => watch.stopped());
        player.on('bufferend', () => {
          player.getPaused().then((paused: boolean) => { if (!paused) watch.playing(); }).catch(() => {});
        });
        // A playback error sends no pause; without this the clock would keep running.
        player.on('error', () => watch.stopped());
        player.on('ended', () => {
          watch.stopped();
          onEndedRef.current?.();
        });
      });
    }

    return () => {
      cancelled = true;
      positionRef.current = null;
      if (player && typeof player.destroy === 'function') {
        try {
          const result = player.destroy();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch {
          /* noop */
        }
      }
      if (container) container.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, lessonId]);

  if (!source) return null;

  if (source.type === 'direct') {
    return (
      <video
        key={lessonId}
        ref={(el) => {
          videoRef.current = el;
          positionRef.current = el ? () => videoRef.current?.currentTime ?? null : null;
        }}
        src={source.url}
        className="w-full h-full"
        controls
        autoPlay={autoplay}
        onPlaying={watch.playing}
        onPause={watch.stopped}
        onWaiting={watch.stopped}
        onError={watch.stopped}
        onEnded={() => {
          watch.stopped();
          onEndedRef.current?.();
        }}
      />
    );
  }

  return <div ref={containerRef} className="w-full h-full" />;
}

import { useEffect, useRef } from 'react';

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
  const ytRegex = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
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

    if (source.type === 'youtube') {
      loadYouTubeApi().then(() => {
        if (cancelled || !container) return;
        const mountPoint = document.createElement('div');
        mountPoint.style.width = '100%';
        mountPoint.style.height = '100%';
        container.innerHTML = '';
        container.appendChild(mountPoint);

        const w = window as any;
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
              if (event.data === w.YT.PlayerState.ENDED) {
                onEndedRef.current?.();
              }
            },
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
        player.ready().then(() => {
          const iframe = mountPoint.querySelector('iframe');
          if (iframe) {
            iframe.style.position = 'absolute';
            iframe.style.inset = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
          }
        }).catch(() => {});
        player.on('ended', () => onEndedRef.current?.());
      });
    }

    return () => {
      cancelled = true;
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
        src={source.url}
        className="w-full h-full"
        controls
        autoPlay={autoplay}
        onEnded={() => onEndedRef.current?.()}
      />
    );
  }

  return <div ref={containerRef} className="w-full h-full" />;
}

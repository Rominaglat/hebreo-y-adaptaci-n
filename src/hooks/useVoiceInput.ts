import { useEffect, useRef, useState, useCallback } from 'react';

const WAVEFORM_BARS = 24;
const METER_FPS = 20; // throttle state updates

// Use a stable empty levels array reference so consumers don't re-render
const ZERO_LEVELS: readonly number[] = Object.freeze(Array(WAVEFORM_BARS).fill(0));

// Web Speech API types (browsers expose these via vendor prefixes)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

interface UseVoiceInputOptions {
  lang?: string; // 'he-IL' | 'en-US'
  onResult?: (transcript: string) => void;
}

/**
 * Voice-to-text using the Web Speech API. Also exposes a live recording timer
 * (`elapsedMs`) and an audio-level array (`levels`) sampled from the mic via a
 * separate getUserMedia + AnalyserNode pipeline, so the UI can render a
 * waveform while recording.
 */
export function useVoiceInput({ lang = 'he-IL', onResult }: UseVoiceInputOptions = {}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Timer state
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);

  // Audio meter state
  const [levels, setLevels] = useState<number[]>(() => Array(WAVEFORM_BARS).fill(0));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const supported = typeof window !== 'undefined' && getRecognitionCtor() !== null;

  // ─── Timer ─────────────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    if (timerIntervalRef.current !== null) window.clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setElapsedMs(0);
  }, []);

  // ─── Audio meter (waveform via getUserMedia + AnalyserNode) ────────────────
  const stopMeter = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    sourceRef.current = null;
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => { /* ignore */ });
    }
    audioContextRef.current = null;
    setLevels([...ZERO_LEVELS]);
  }, []);

  const startMeter = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // deno-lint-ignore no-explicit-any
      const Ctx: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
      const ctx = new Ctx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const minFrameMs = 1000 / METER_FPS;
      let lastUpdate = 0;

      const tick = (now: number) => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        if (now - lastUpdate >= minFrameMs) {
          lastUpdate = now;
          // Bucket the frequency bins into WAVEFORM_BARS bars; ignore the very
          // top of the spectrum (rarely informative for voice).
          const usable = Math.floor(data.length * 0.75);
          const bucketSize = Math.max(1, Math.floor(usable / WAVEFORM_BARS));
          const bars: number[] = new Array(WAVEFORM_BARS);
          for (let i = 0; i < WAVEFORM_BARS; i++) {
            let sum = 0;
            const start = i * bucketSize;
            const end = Math.min(start + bucketSize, usable);
            for (let j = start; j < end; j++) sum += data[j];
            // Normalise 0..1 and apply a soft gamma so quiet sound is visible
            const avg = sum / Math.max(1, end - start) / 255;
            bars[i] = Math.pow(avg, 0.7);
          }
          setLevels(bars);
        }
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch (e) {
      // Mic access denied or unavailable — silently degrade (no waveform).
      console.warn('audio meter unavailable:', e);
      stopMeter();
    }
  }, [stopMeter]);

  // Lazy-init recognition
  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      const combined = (finalText || interimText).trim();
      setTranscript(combined);
      if (finalText && onResult) {
        onResult(finalText.trim());
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(event.error || 'unknown_error');
      setIsListening(false);
    };

    rec.onend = () => setIsListening(false);
    rec.onstart = () => setIsListening(true);

    recognitionRef.current = rec;
    return rec;
  }, [lang, onResult]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch (e) {
        // ignore
      }
      stopTimer();
      stopMeter();
    };
  }, [stopTimer, stopMeter]);

  const start = useCallback(() => {
    setError(null);
    setTranscript('');
    const rec = ensureRecognition();
    if (!rec) {
      setError('not_supported');
      return;
    }
    try {
      rec.lang = lang;
      rec.start();
    } catch (e) {
      // start() throws if already running — ignore
    }
    startTimer();
    // Fire-and-forget: meter init is async (mic permission)
    void startMeter();
  }, [ensureRecognition, lang, startTimer, startMeter]);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch (e) {
      // ignore
    }
    stopTimer();
    stopMeter();
  }, [stopTimer, stopMeter]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return {
    supported,
    isListening,
    transcript,
    error,
    elapsedMs,
    levels,
    start,
    stop,
    toggle,
  };
}

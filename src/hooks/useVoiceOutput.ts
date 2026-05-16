import { useEffect, useRef, useState, useCallback } from 'react';

interface UseVoiceOutputOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
}

/**
 * Text-to-speech using the browser SpeechSynthesis API.
 * Tracks which message is currently being spoken (by id).
 */
export function useVoiceOutput({ lang = 'he-IL', rate = 1, pitch = 1 }: UseVoiceOutputOptions = {}) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Pre-load voices (some browsers load them async)
  useEffect(() => {
    if (!supported) return;
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, [supported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  const speak = useCallback(
    (text: string, id: string) => {
      if (!supported) return;
      // If already speaking this id — toggle off
      if (speakingId === id) {
        stop();
        return;
      }
      // Cancel any previous utterance
      window.speechSynthesis.cancel();

      // Strip markdown and links for cleaner speech
      const cleaned = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_~#>]/g, '')
        .trim();

      const utt = new SpeechSynthesisUtterance(cleaned);
      utt.lang = lang;
      utt.rate = rate;
      utt.pitch = pitch;

      // Try to pick a Hebrew voice
      const voices = voicesRef.current;
      const langPrefix = lang.split('-')[0];
      const match = voices.find((v) => v.lang.startsWith(langPrefix));
      if (match) utt.voice = match;

      utt.onend = () => setSpeakingId(null);
      utt.onerror = () => setSpeakingId(null);

      utteranceRef.current = utt;
      setSpeakingId(id);
      window.speechSynthesis.speak(utt);
    },
    [supported, speakingId, stop, lang, rate, pitch]
  );

  return {
    supported,
    speakingId,
    speak,
    stop,
  };
}

import { useCallback, useRef, useState } from 'react';

// Records real audio (MediaRecorder → Blob) for assignment submissions.
// NOTE: distinct from useVoiceInput, which is speech-to-text and stores no audio.

export type AudioRecorderStatus = 'idle' | 'recording' | 'recorded';

export interface AudioRecorderState {
  status: AudioRecorderStatus;
  blob: Blob | null;
  url: string | null;      // object URL for local playback
  durationSec: number;
  error: string | null;
}

const INITIAL: AudioRecorderState = { status: 'idle', blob: null, url: null, durationSec: 0, error: null };

export function useAudioRecorder() {
  const [state, setState] = useState<AudioRecorderState>(INITIAL);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const durationSec = Math.round((performance.now() - startedRef.current) / 1000);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setState({ status: 'recorded', blob, url, durationSec, error: null });
      };
      startedRef.current = performance.now();
      mr.start();
      recorderRef.current = mr;
      setState({ status: 'recording', blob: null, url: null, durationSec: 0, error: null });
    } catch (e) {
      setState((s) => ({ ...s, status: 'idle', error: e instanceof Error ? e.message : 'microphone unavailable' }));
    }
  }, []);

  const stop = useCallback(() => {
    const mr = recorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
  }, []);

  const reset = useCallback(() => {
    setState((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url);
      return INITIAL;
    });
  }, []);

  return { ...state, start, stop, reset };
}

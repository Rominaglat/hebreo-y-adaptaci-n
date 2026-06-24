// "You're muted but talking" detector (Google Meet parity).
//
// When the user mutes, the mic track is disabled (track.enabled = false), so a
// normal analyser would only see silence. To still detect that they're trying
// to speak, we analyse a CLONE of the mic track — the clone has an independent
// `enabled` flag, so it stays live while the real track is muted. The clone is
// never added to any peer connection, so nothing is actually transmitted.

import { useEffect, useState } from "react";

const SPEAKING_THRESHOLD = 0.05; // normalized RMS
const ENTER_MS = 400; // sustained speech before we nudge
const SAMPLE_MS = 200;

interface UseMutedSpeakingHintProps {
  localStream: MediaStream | null;
  isMuted: boolean;
}

export function useMutedSpeakingHint({ localStream, isMuted }: UseMutedSpeakingHintProps): boolean {
  const [mutedSpeaking, setMutedSpeaking] = useState(false);

  useEffect(() => {
    if (!isMuted || !localStream) {
      setMutedSpeaking(false);
      return;
    }
    const micTrack = localStream.getAudioTracks()[0];
    if (!micTrack) {
      setMutedSpeaking(false);
      return;
    }

    let clone: MediaStreamTrack | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let aboveSince: number | null = null;

    try {
      clone = micTrack.clone();
      clone.enabled = true; // independent of the muted original
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(new MediaStream([clone]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      timer = setInterval(() => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length) / 255;
        if (rms > SPEAKING_THRESHOLD) {
          if (aboveSince === null) aboveSince = performance.now();
          else if (performance.now() - aboveSince > ENTER_MS) setMutedSpeaking(true);
        } else {
          aboveSince = null;
          setMutedSpeaking(false);
        }
      }, SAMPLE_MS);
    } catch {
      setMutedSpeaking(false);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (clone) clone.stop();
      if (ctx) ctx.close().catch(() => {});
      setMutedSpeaking(false);
    };
  }, [isMuted, localStream]);

  return mutedSpeaking;
}

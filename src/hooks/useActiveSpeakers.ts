// Active-speaker detection for the meeting room.
//
// Approach:
//   - Each client samples its own outgoing audio every ~250ms via WebAudio
//     analyser nodes. (Sampling remote streams locally also works but burns
//     significantly more CPU per peer.)
//   - When the local user crosses a "speaking" threshold for >150ms (to
//     filter out micro-noise) we broadcast a `speaking` event on a Supabase
//     realtime channel. We broadcast `silent` when we drop below threshold
//     for >500ms (debounced — talking always has gaps).
//   - Remote peers track who's currently speaking in a Set<userId> that the
//     UI uses to ring the tile in green.
//
// The hook is intentionally separate from useWebRTC so it can be unmounted
// without tearing down peer connections.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SPEAKING_THRESHOLD = 0.04;     // 0..1 normalized RMS
const SPEAKING_ENTER_MS = 150;
const SPEAKING_EXIT_MS = 500;
const SAMPLE_INTERVAL_MS = 200;

interface UseActiveSpeakersProps {
  roomId: string;
  localUserId: string;
  localStream: MediaStream | null;
  isMuted: boolean;
}

export function useActiveSpeakers({
  roomId,
  localUserId,
  localStream,
  isMuted,
}: UseActiveSpeakersProps) {
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLocalSpeakingRef = useRef(false);
  const aboveThresholdSinceRef = useRef<number | null>(null);
  const belowThresholdSinceRef = useRef<number | null>(null);

  // Subscribe to remote speaker events.
  useEffect(() => {
    const channel = supabase
      .channel(`speakers-${roomId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "speaking" }, ({ payload }) => {
        const uid = payload?.userId as string | undefined;
        if (!uid) return;
        setSpeakers((prev) => {
          if (prev.has(uid)) return prev;
          const next = new Set(prev);
          next.add(uid);
          return next;
        });
      })
      .on("broadcast", { event: "silent" }, ({ payload }) => {
        const uid = payload?.userId as string | undefined;
        if (!uid) return;
        setSpeakers((prev) => {
          if (!prev.has(uid)) return prev;
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId]);

  // Sample local mic + broadcast speaking/silent transitions.
  useEffect(() => {
    if (!localStream || isMuted) {
      // Reset state when muted so we don't show a stale green ring.
      if (isLocalSpeakingRef.current) {
        isLocalSpeakingRef.current = false;
        channelRef.current?.send({
          type: "broadcast",
          event: "silent",
          payload: { userId: localUserId },
        });
        setSpeakers((prev) => {
          if (!prev.has(localUserId)) return prev;
          const next = new Set(prev);
          next.delete(localUserId);
          return next;
        });
      }
      return;
    }

    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      sourceRef.current = source;

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      sampleTimerRef.current = setInterval(() => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length) / 255;
        const now = performance.now();

        if (rms > SPEAKING_THRESHOLD) {
          belowThresholdSinceRef.current = null;
          if (aboveThresholdSinceRef.current === null) {
            aboveThresholdSinceRef.current = now;
          } else if (
            !isLocalSpeakingRef.current &&
            now - aboveThresholdSinceRef.current > SPEAKING_ENTER_MS
          ) {
            isLocalSpeakingRef.current = true;
            channelRef.current?.send({
              type: "broadcast",
              event: "speaking",
              payload: { userId: localUserId },
            });
            // Reflect the local speaker in our own set too so the tile rings.
            setSpeakers((prev) => {
              if (prev.has(localUserId)) return prev;
              const next = new Set(prev);
              next.add(localUserId);
              return next;
            });
          }
        } else {
          aboveThresholdSinceRef.current = null;
          if (belowThresholdSinceRef.current === null) {
            belowThresholdSinceRef.current = now;
          } else if (
            isLocalSpeakingRef.current &&
            now - belowThresholdSinceRef.current > SPEAKING_EXIT_MS
          ) {
            isLocalSpeakingRef.current = false;
            channelRef.current?.send({
              type: "broadcast",
              event: "silent",
              payload: { userId: localUserId },
            });
            setSpeakers((prev) => {
              if (!prev.has(localUserId)) return prev;
              const next = new Set(prev);
              next.delete(localUserId);
              return next;
            });
          }
        }
      }, SAMPLE_INTERVAL_MS);
    } catch (err) {
      console.warn("[ActiveSpeakers] WebAudio init failed:", err);
    }

    return () => {
      if (sampleTimerRef.current) {
        clearInterval(sampleTimerRef.current);
        sampleTimerRef.current = null;
      }
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current = null;
      }
      if (analyserRef.current) {
        try { analyserRef.current.disconnect(); } catch {}
        analyserRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [localStream, isMuted, localUserId]);

  return speakers;
}

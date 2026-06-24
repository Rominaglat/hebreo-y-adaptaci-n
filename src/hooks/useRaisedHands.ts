// Raised-hands tracker for the meeting room.
//
// Uses Supabase BROADCAST (reliable real-time fan-out) for raise/lower/lower-all
// — presence updates proved unreliable for self/peer sync. Late-join replay is
// handled with a tiny request/answer handshake: a freshly-subscribed client
// asks "who has a hand up?" and anyone currently raised re-announces.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseRaisedHandsProps {
  roomId: string;
  localUserId: string;
}

export function useRaisedHands({ roomId, localUserId }: UseRaisedHandsProps) {
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Our own current state — so we can re-announce on a late joiner's request
  // and re-raise after a reconnect.
  const localRaisedRef = useRef(false);

  useEffect(() => {
    const channel = supabase
      .channel(`raised-hands-${roomId}`, { config: { broadcast: { self: true } } })
      .on("broadcast", { event: "raise" }, ({ payload }) => {
        const uid = payload?.userId as string | undefined;
        if (!uid) return;
        setRaisedHands((prev) => {
          if (prev.has(uid)) return prev;
          const next = new Set(prev);
          next.add(uid);
          return next;
        });
      })
      .on("broadcast", { event: "lower" }, ({ payload }) => {
        const uid = payload?.userId as string | undefined;
        if (!uid) return;
        setRaisedHands((prev) => {
          if (!prev.has(uid)) return prev;
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
      })
      .on("broadcast", { event: "lower-all" }, () => {
        localRaisedRef.current = false;
        setRaisedHands(new Set());
      })
      // Late joiner asks for the current state; anyone raised re-announces.
      .on("broadcast", { event: "request-hands" }, () => {
        if (localRaisedRef.current) {
          channel.send({ type: "broadcast", event: "raise", payload: { userId: localUserId } });
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Pull existing raised hands…
          channel.send({ type: "broadcast", event: "request-hands", payload: {} });
          // …and re-assert our own state (covers reconnects).
          if (localRaisedRef.current) {
            channel.send({ type: "broadcast", event: "raise", payload: { userId: localUserId } });
          }
        }
      });

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, localUserId]);

  const raiseHand = useCallback(() => {
    localRaisedRef.current = true;
    setRaisedHands((prev) => {
      const n = new Set(prev);
      n.add(localUserId);
      return n;
    });
    channelRef.current?.send({ type: "broadcast", event: "raise", payload: { userId: localUserId } });
  }, [localUserId]);

  const lowerHand = useCallback(() => {
    localRaisedRef.current = false;
    setRaisedHands((prev) => {
      const n = new Set(prev);
      n.delete(localUserId);
      return n;
    });
    channelRef.current?.send({ type: "broadcast", event: "lower", payload: { userId: localUserId } });
  }, [localUserId]);

  const lowerAllHands = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "lower-all", payload: {} });
  }, []);

  const isLocalRaised = raisedHands.has(localUserId);

  return { raisedHands, isLocalRaised, raiseHand, lowerHand, lowerAllHands };
}

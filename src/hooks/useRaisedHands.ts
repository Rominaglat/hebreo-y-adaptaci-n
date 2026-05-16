// Raised-hands tracker for the meeting room.
//
// Broadcast-only state — we don't persist this to Postgres because a hand
// raise is ephemeral by definition (you raise to ask a question, the host
// acknowledges, you lower). Anyone who joins later gets a clean board.
//
// The hook returns the current set of user_ids with raised hands plus
// toggle/lower/clear helpers wired to the same broadcast channel.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseRaisedHandsProps {
  roomId: string;
  localUserId: string;
}

export function useRaisedHands({ roomId, localUserId }: UseRaisedHandsProps) {
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
        setRaisedHands(new Set());
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId]);

  const raiseHand = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "raise",
      payload: { userId: localUserId },
    });
  }, [localUserId]);

  const lowerHand = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "lower",
      payload: { userId: localUserId },
    });
  }, [localUserId]);

  const lowerAllHands = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "lower-all",
      payload: {},
    });
  }, []);

  const isLocalRaised = raisedHands.has(localUserId);

  return { raisedHands, isLocalRaised, raiseHand, lowerHand, lowerAllHands };
}

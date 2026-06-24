// Raised-hands tracker for the meeting room.
//
// Backed by Supabase PRESENCE (not fire-and-forget broadcast) so that:
//   * a participant who joins mid-meeting immediately sees every hand that is
//     already raised (presence sends the full state on sync), and
//   * a raised hand disappears automatically when its owner leaves/disconnects
//     (presence 'leave'), instead of lingering forever.
//
// Each client tracks its own `{ userId, raised }` state; the public set is
// derived from the presence state of everyone on the channel. "Lower all" is a
// host broadcast that asks each client to lower its own hand.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseRaisedHandsProps {
  roomId: string;
  localUserId: string;
}

interface HandPresence {
  userId: string;
  raised: boolean;
}

export function useRaisedHands({ roomId, localUserId }: UseRaisedHandsProps) {
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Remember our own raised state so a channel re-subscribe re-tracks it.
  const localRaisedRef = useRef(false);

  useEffect(() => {
    const channel = supabase.channel(`raised-hands-${roomId}`, {
      config: { presence: { key: localUserId } },
    });

    const rebuild = () => {
      const state = channel.presenceState<HandPresence>();
      const next = new Set<string>();
      Object.values(state).forEach((entries) => {
        entries.forEach((e) => {
          if (e.raised && e.userId) next.add(e.userId);
        });
      });
      setRaisedHands(next);
    };

    channel
      .on("presence", { event: "sync" }, rebuild)
      .on("presence", { event: "join" }, rebuild)
      .on("presence", { event: "leave" }, rebuild)
      // Host "lower all": each client lowers its own hand.
      .on("broadcast", { event: "lower-all" }, () => {
        localRaisedRef.current = false;
        channel.track({ userId: localUserId, raised: false });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track({ userId: localUserId, raised: localRaisedRef.current });
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
    channelRef.current?.track({ userId: localUserId, raised: true });
  }, [localUserId]);

  const lowerHand = useCallback(() => {
    localRaisedRef.current = false;
    channelRef.current?.track({ userId: localUserId, raised: false });
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

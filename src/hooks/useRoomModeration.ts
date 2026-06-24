// Host moderation for the meeting room.
//
// Google Meet hosts can force-mute, remove (eject), and end the call for
// everyone. Force-mute and end-call are delivered as broadcast COMMANDS that
// the targeted client obeys locally (the host can't flip another participant's
// mic track remotely, exactly like Meet). Removal additionally DELETEs the
// participant row — the DB `room_participants_host_kick` RLS policy authorizes
// the host — so the kicked user also vanishes from everyone's roster.
//
// Every client subscribes; only the host calls the action helpers.

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseRoomModerationProps {
  roomId: string;
  localUserId: string;
  /** Fired on the targeted client when the host force-mutes it. */
  onForceMute: () => void;
  /** Fired on the targeted client when the host removes it. */
  onKicked: () => void;
  /** Fired on every client when the host ends the call for everyone. */
  onEndCall: () => void;
}

export function useRoomModeration({
  roomId,
  localUserId,
  onForceMute,
  onKicked,
  onEndCall,
}: UseRoomModerationProps) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Keep the latest callbacks without re-subscribing the channel.
  const cbRef = useRef({ onForceMute, onKicked, onEndCall });
  useEffect(() => {
    cbRef.current = { onForceMute, onKicked, onEndCall };
  }, [onForceMute, onKicked, onEndCall]);

  useEffect(() => {
    const channel = supabase
      .channel(`moderation-${roomId}`)
      .on("broadcast", { event: "mute" }, ({ payload }) => {
        if (payload?.target === localUserId) cbRef.current.onForceMute();
      })
      .on("broadcast", { event: "kick" }, ({ payload }) => {
        if (payload?.target === localUserId) cbRef.current.onKicked();
      })
      .on("broadcast", { event: "end" }, () => {
        cbRef.current.onEndCall();
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, localUserId]);

  const muteParticipant = useCallback((targetUserId: string) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "mute",
      payload: { target: targetUserId },
    });
  }, []);

  const removeParticipant = useCallback(
    async (targetUserId: string) => {
      // Tell the target immediately (snappy UX)…
      channelRef.current?.send({
        type: "broadcast",
        event: "kick",
        payload: { target: targetUserId },
      });
      // …and authoritatively remove their row so they leave everyone's roster
      // even if the broadcast was missed. RLS (room_participants_host_kick)
      // permits the host to delete rows in their own room.
      const { error } = await supabase
        .from("room_participants")
        .delete()
        .eq("room_id", roomId)
        .eq("user_id", targetUserId);
      if (error) console.warn("[moderation] Failed to remove participant:", error);
    },
    [roomId],
  );

  const endCallForAll = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "end",
      payload: {},
    });
  }, []);

  return { muteParticipant, removeParticipant, endCallForAll };
}

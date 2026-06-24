import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DrawingStroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
  userId: string;
  userName: string;
}

export interface CursorPosition {
  x: number;
  y: number;
  userId: string;
  userName: string;
  /** Receiver-side last-seen stamp, used to prune stale cursors. */
  ts?: number;
}

interface UseWhiteboardProps {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
}

export const useWhiteboard = ({ roomId, userId, userName, isHost }: UseWhiteboardProps) => {
  const [strokes, setStrokes] = useState<DrawingStroke[]>([]);
  const [cursors, setCursors] = useState<Map<string, CursorPosition>>(new Map());
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<{ userId: string; userName: string }[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Live mirror of `strokes` so the replay-on-join handler (which runs inside
  // the channel subscription, with a stale closure over state) can answer with
  // the current board without re-subscribing.
  const strokesRef = useRef<DrawingStroke[]>([]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // Initialize channel
  useEffect(() => {
    const channel = supabase.channel(`whiteboard-${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: `user-${userId}` },
      },
    });

    channel
      .on('broadcast', { event: 'stroke' }, ({ payload }) => {
        const stroke = payload as DrawingStroke;
        setStrokes(prev => [...prev, stroke]);
      })
      // Late-join replay: a freshly-joined peer asks for the current board;
      // anyone who has strokes answers with the full set. The requester merges
      // by stroke id so multiple answers (or a race with live strokes) dedupe.
      .on('broadcast', { event: 'request-strokes' }, () => {
        if (strokesRef.current.length > 0) {
          channel.send({
            type: 'broadcast',
            event: 'replay-strokes',
            payload: { strokes: strokesRef.current },
          });
        }
      })
      .on('broadcast', { event: 'replay-strokes' }, ({ payload }) => {
        const incoming = (payload?.strokes ?? []) as DrawingStroke[];
        if (incoming.length === 0) return;
        setStrokes(prev => {
          const have = new Set(prev.map(s => s.id));
          const merged = [...prev];
          incoming.forEach(s => { if (!have.has(s.id)) merged.push(s); });
          return merged.length === prev.length ? prev : merged;
        });
      })
      .on('broadcast', { event: 'stroke-update' }, ({ payload }) => {
        const { id, point } = payload as { id: string; point: { x: number; y: number } };
        setStrokes(prev => prev.map(s => 
          s.id === id ? { ...s, points: [...s.points, point] } : s
        ));
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        const cursor = payload as CursorPosition;
        if (cursor.userId !== userId) {
          setCursors(prev => new Map(prev).set(cursor.userId, { ...cursor, ts: Date.now() }));
        }
      })
      .on('broadcast', { event: 'clear' }, () => {
        setStrokes([]);
      })
      .on('broadcast', { event: 'request-draw' }, ({ payload }) => {
        if (isHost) {
          setPendingRequests(prev => {
            if (prev.some(r => r.userId === payload.userId)) return prev;
            return [...prev, { userId: payload.userId, userName: payload.userName }];
          });
        }
      })
      .on('broadcast', { event: 'approve-draw' }, ({ payload }) => {
        if (payload.userId === userId) {
          setIsDrawingEnabled(true);
        }
        setApprovedUsers(prev => new Set(prev).add(payload.userId));
      })
      .on('broadcast', { event: 'revoke-draw' }, ({ payload }) => {
        if (payload.userId === userId) {
          setIsDrawingEnabled(false);
        }
        setApprovedUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(payload.userId);
          return newSet;
        });
        // Mirror the host's local clear so every peer sees the revoked
        // user's strokes disappear too.
        setStrokes(prev => prev.filter(s => s.userId !== payload.userId));
      })
      .subscribe((status) => {
        // On join, pull the existing board from whoever already has it.
        if (status === 'SUBSCRIBED' && strokesRef.current.length === 0) {
          channel.send({ type: 'broadcast', event: 'request-strokes', payload: {} });
        }
      });

    channelRef.current = channel;

    // Host can always draw
    if (isHost) {
      setIsDrawingEnabled(true);
      setApprovedUsers(new Set([userId]));
    }

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, isHost]);

  // Prune stale remote cursors (the previous implementation was a no-op, so
  // a peer's cursor lingered forever after they stopped moving / left). Drop
  // any cursor not refreshed in the last 3s.
  useEffect(() => {
    const interval = setInterval(() => {
      setCursors(prev => {
        const now = Date.now();
        let changed = false;
        const newMap = new Map(prev);
        newMap.forEach((cursor, key) => {
          if (cursor.ts && now - cursor.ts > 3000) {
            newMap.delete(key);
            changed = true;
          }
        });
        return changed ? newMap : prev;
      });
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  const addStroke = useCallback((stroke: DrawingStroke) => {
    setStrokes(prev => [...prev, stroke]);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'stroke',
      payload: stroke,
    });
  }, []);

  const updateStroke = useCallback((id: string, point: { x: number; y: number }) => {
    setStrokes(prev => prev.map(s => 
      s.id === id ? { ...s, points: [...s.points, point] } : s
    ));
    channelRef.current?.send({
      type: 'broadcast',
      event: 'stroke-update',
      payload: { id, point },
    });
  }, []);

  const broadcastCursor = useCallback((x: number, y: number) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { x, y, userId, userName },
    });
  }, [userId, userName]);

  const clearBoard = useCallback(() => {
    setStrokes([]);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'clear',
      payload: {},
    });
  }, []);

  const requestDrawAccess = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'request-draw',
      payload: { userId, userName },
    });
  }, [userId, userName]);

  const approveDrawAccess = useCallback((targetUserId: string) => {
    setPendingRequests(prev => prev.filter(r => r.userId !== targetUserId));
    setApprovedUsers(prev => new Set(prev).add(targetUserId));
    channelRef.current?.send({
      type: 'broadcast',
      event: 'approve-draw',
      payload: { userId: targetUserId },
    });
  }, []);

  const revokeDrawAccess = useCallback((targetUserId: string) => {
    setApprovedUsers(prev => {
      const newSet = new Set(prev);
      newSet.delete(targetUserId);
      return newSet;
    });
    // Drop everything the revoked user drew. Leaving their strokes on the
    // board after revoking access is confusing — and rejoining peers would
    // still see the strokes via the broadcast history.
    setStrokes(prev => prev.filter(s => s.userId !== targetUserId));
    channelRef.current?.send({
      type: 'broadcast',
      event: 'revoke-draw',
      payload: { userId: targetUserId },
    });
  }, []);

  return {
    strokes,
    cursors,
    isDrawingEnabled,
    pendingRequests,
    approvedUsers,
    addStroke,
    updateStroke,
    broadcastCursor,
    clearBoard,
    requestDrawAccess,
    approveDrawAccess,
    revokeDrawAccess,
  };
};

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
      .on('broadcast', { event: 'stroke-update' }, ({ payload }) => {
        const { id, point } = payload as { id: string; point: { x: number; y: number } };
        setStrokes(prev => prev.map(s => 
          s.id === id ? { ...s, points: [...s.points, point] } : s
        ));
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        const cursor = payload as CursorPosition;
        if (cursor.userId !== userId) {
          setCursors(prev => new Map(prev).set(cursor.userId, cursor));
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
      .subscribe();

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

  // Remove cursor when user is inactive
  useEffect(() => {
    const interval = setInterval(() => {
      setCursors(prev => {
        const now = Date.now();
        const newMap = new Map(prev);
        // Remove cursors that haven't been updated in 3 seconds
        newMap.forEach((_, key) => {
          // We'll handle this through presence instead
        });
        return newMap;
      });
    }, 3000);

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

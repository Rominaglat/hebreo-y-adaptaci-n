import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface RoomParticipant {
  id: string;
  user_id: string;
  user_name: string;
}

export interface Room {
  id: string;
  name: string;
  description: string | null;
  category: string;
  max_participants: number;
  is_locked: boolean;
  is_live: boolean;
  is_recording: boolean;
  recording_url: string | null;
  host_id: string | null;
  host_name: string;
  created_at: string;
  participants_count?: number;
  participants?: RoomParticipant[];
}

export const useRooms = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRooms = useCallback(async () => {
    const { data: roomsData, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching rooms:', error);
      return;
    }

    // Get participants for each room
    const roomsWithParticipants = await Promise.all(
      (roomsData || []).map(async (room) => {
        const { data: participants, count } = await supabase
          .from('room_participants')
          .select('id, user_id, user_name', { count: 'exact' })
          .eq('room_id', room.id);
        
        return {
          ...room,
          participants_count: count || 0,
          participants: participants || [],
        };
      })
    );

    setRooms(roomsWithParticipants);
    setLoading(false);
  }, []);

  const createRoom = useCallback(async (roomData: {
    name: string;
    description?: string;
    category: string;
    max_participants: number;
    is_locked: boolean;
    is_live?: boolean;
    is_recording?: boolean;
    host_name: string;
    host_id?: string;
  }) => {
    // Get current user for host_id
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('rooms')
      .insert([{
        ...roomData,
        host_id: user?.id || null,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating room:', error);
      throw error;
    }

    await fetchRooms();
    return data;
  }, [fetchRooms]);

  const updateRoom = useCallback(async (roomId: string, roomData: {
    name?: string;
    description?: string;
    category?: string;
    max_participants?: number;
    is_locked?: boolean;
    is_live?: boolean;
  }) => {
    const { data, error } = await supabase
      .from('rooms')
      .update(roomData)
      .eq('id', roomId)
      .select()
      .single();

    if (error) {
      console.error('Error updating room:', error);
      throw error;
    }

    await fetchRooms();
    return data;
  }, [fetchRooms]);

  const deleteRoom = useCallback(async (roomId: string) => {
    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId);

    if (error) {
      console.error('Error deleting room:', error);
      throw error;
    }

    await fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    fetchRooms();

    // Subscribe to room changes
    const channel = supabase
      .channel('rooms-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
        },
        () => {
          fetchRooms();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_participants',
        },
        () => {
          fetchRooms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRooms]);

  return {
    rooms,
    loading,
    createRoom,
    updateRoom,
    deleteRoom,
    refreshRooms: fetchRooms,
  };
};

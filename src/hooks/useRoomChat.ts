import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  message: string;
  created_at: string;
}

interface UseRoomChatProps {
  roomId: string;
  userId: string;
  userName: string;
}

export const useRoomChat = ({ roomId, userId, userName }: UseRoomChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch existing messages
  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('room_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      console.error('Error fetching messages:', error);
      return;
    }

    setMessages(data || []);
    setLoading(false);
  }, [roomId]);

  // Send a new message
  const sendMessage = useCallback(async (messageText: string) => {
    if (!messageText.trim()) return;

    const { error } = await supabase
      .from('room_messages')
      .insert({
        room_id: roomId,
        user_id: userId,
        user_name: userName,
        message: messageText.trim(),
      });

    if (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }, [roomId, userId, userName]);

  // Subscribe to realtime updates
  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel(`room-chat-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage;
          setMessages((prev) => [...prev, newMessage]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'room_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const deletedId = payload.old.id;
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, fetchMessages]);

  return {
    messages,
    loading,
    sendMessage,
  };
};

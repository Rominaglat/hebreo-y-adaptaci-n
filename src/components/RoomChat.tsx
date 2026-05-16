import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRoomChat, ChatMessage } from '@/hooks/useRoomChat';
import { cn } from '@/lib/utils';

interface RoomChatProps {
  roomId: string;
  userId: string;
  userName: string;
}

const RoomChat = ({ roomId, userId, userName }: RoomChatProps) => {
  const { messages, loading, sendMessage } = useRoomChat({ roomId, userId, userName });
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive. We use a plain div
  // (not shadcn's ScrollArea — its ref points to the wrapper, not the
  // viewport, so scrollTop assignments were silently ignored).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;

    setSending(true);
    try {
      await sendMessage(newMessage);
      setNewMessage('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area — plain scrolling div so we control scrollTop. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 min-h-0">
        <div className="space-y-3 py-2">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              אין הודעות עדיין. התחילו את השיחה!
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.user_id === userId}
                formatTime={formatTime}
                getInitials={getInitials}
              />
            ))
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="p-2 border-t border-border shrink-0">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="כתבו הודעה…"
            className="flex-1 text-sm"
            disabled={sending}
            autoComplete="off"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!newMessage.trim() || sending}
            className="shrink-0 h-9 w-9"
            aria-label="שליחת הודעה"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  formatTime: (date: string) => string;
  getInitials: (name: string) => string;
}

const MessageBubble = ({ message, isOwn, formatTime, getInitials }: MessageBubbleProps) => {
  return (
    <div className={cn('flex gap-2', isOwn ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
          isOwn ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
        )}
      >
        {getInitials(message.user_name)}
      </div>

      {/* Message content */}
      <div className={cn('max-w-[75%] space-y-0.5', isOwn ? 'text-left' : 'text-right')}>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{message.user_name}</span>
          <span>•</span>
          <span>{formatTime(message.created_at)}</span>
        </div>
        <div
          className={cn(
            'px-3 py-1.5 rounded-2xl text-sm break-words',
            isOwn
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-secondary text-secondary-foreground rounded-tl-sm'
          )}
        >
          {message.message}
        </div>
      </div>
    </div>
  );
};

export default RoomChat;

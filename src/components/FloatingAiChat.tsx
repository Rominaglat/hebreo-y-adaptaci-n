import { useState, useRef, useEffect, useCallback } from 'react';
import { Headset, X, Send, Plus, MessageSquare, Trash2, Loader2, GripVertical, BookOpen, Mic, MicOff, Volume2, VolumeX, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAiChat, ChatMessage, Conversation } from '@/hooks/useAiChat';
import { VoiceWaveform, formatRecordingTime } from '@/components/VoiceWaveform';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useVoiceOutput } from '@/hooks/useVoiceOutput';
import { useNavigate, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';

// Default mascot served from /public/jason.png + default name
const DEFAULT_MASCOT = '/jason.png';
const DEFAULT_NAME = 'ג\u0027ייסון';

// ─── Contextual prompts ───
interface QuickPrompt {
  icon: string;
  text: string;
}

function getContextualPrompts(pathname: string): QuickPrompt[] {
  // Course detail page (specific lesson context)
  if (/^\/courses\/[a-f0-9-]+/.test(pathname) && !pathname.endsWith('/edit')) {
    return [
      { icon: '📝', text: 'סכם לי את השיעור הנוכחי' },
      { icon: '💡', text: 'הסבר את הקונספט בפשטות' },
      { icon: '🎯', text: 'תן לי דוגמה מהעולם האמיתי' },
    ];
  }
  // Courses list
  if (pathname.startsWith('/courses')) {
    return [
      { icon: '🎓', text: 'אילו קורסים מומלצים בשבילי?' },
      { icon: '🚀', text: 'מה כדאי ללמוד למתחילים?' },
      { icon: '⏱️', text: 'איזה קורס קצר ויעיל?' },
    ];
  }
  // Study rooms
  if (pathname.startsWith('/study-rooms')) {
    return [
      { icon: '👥', text: 'מה הן שיטות לימוד יעילות בקבוצה?' },
      { icon: '💬', text: 'תן לי טיפים לדיון מקצועי' },
    ];
  }
  // Calendar
  if (pathname.startsWith('/calendar')) {
    return [
      { icon: '📅', text: 'איך לנהל את הזמן שלי בלימוד?' },
      { icon: '⏰', text: 'תן לי טיפ לתכנון יומי' },
    ];
  }
  // Profile
  if (pathname.startsWith('/profile')) {
    return [
      { icon: '🎯', text: 'איך לבנות מטרות למידה ברורות?' },
      { icon: '📈', text: 'איך אפשר לעקוב אחרי ההתקדמות שלי?' },
    ];
  }
  // Skills library
  if (pathname.startsWith('/skills')) {
    return [
      { icon: '✨', text: 'אילו סקילים הכי מבוקשים בתחום שלי?' },
      { icon: '🛠️', text: 'איך אני בונה סקיל איכותי?' },
    ];
  }
  // Default — dashboard
  return [
    { icon: '📚', text: 'מה כדאי לי ללמוד היום?' },
    { icon: '💡', text: 'תן לי טיפ למידה לימוד' },
    { icon: '🎯', text: 'איך אני יכול להתקדם מהר יותר?' },
  ];
}

// ─── Draggable hook ───
function useDraggable(initialPos: { x: number; y: number }) {
  const [pos, setPos] = useState(initialPos);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    hasMoved.current = false;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    hasMoved.current = true;
    const newX = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - offset.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - offset.current.y));
    setPos({ x: newX, y: newY });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return { pos, setPos, onPointerDown, onPointerMove, onPointerUp, hasMoved };
}

// ─── Main Component ───
export function FloatingAiChat() {
  const { user } = useAuth();
  const { tenantSettings } = useTenant();
  const { completeStep } = useOnboarding();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  // Resolve assistant name + avatar from tenant settings, with defaults
  const assistantName = tenantSettings?.ai_assistant_name?.trim() || DEFAULT_NAME;
  const assistantAvatar = tenantSettings?.ai_assistant_avatar_url || DEFAULT_MASCOT;

  // Avatar load state — driven by React, not DOM mutations.
  // Reset whenever the avatar URL changes.
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => { setAvatarFailed(false); }, [assistantAvatar]);

  // Extract course_id from URL if on a course page
  const currentCourseId = (() => {
    const match = location.pathname.match(/^\/courses\/([a-f0-9-]+)/);
    return match ? match[1] : undefined;
  })();

  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    conversations, currentConversationId, messages, isLoading,
    loadConversations, loadMessages, startNewChat, deleteConversation,
    sendMessage, cancelStream,
  } = useAiChat();

  // Voice input — appends final transcript to input field
  const voiceInput = useVoiceInput({
    lang: 'he-IL',
    onResult: (text) => {
      setInputValue((prev) => (prev ? `${prev} ${text}`.trim() : text));
      // Refocus input after voice ends
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  });

  // Voice output — controlled per-message
  const voiceOutput = useVoiceOutput({ lang: 'he-IL' });

  // Stop any ongoing speech when chat closes
  useEffect(() => {
    if (!isOpen) voiceOutput.stop();
  }, [isOpen, voiceOutput]);

  // FAB drag — anchored to bottom-LEFT (user preference).
  // FAB is 64px wide (w-16); +24px margin from edges; +110px above bottom edge
  // so it never sits flush against the viewport.
  const fab = useDraggable({
    x: 24,
    y: typeof window !== 'undefined' ? window.innerHeight - 110 : 600,
  });

  // Window drag
  const [windowPos, setWindowPos] = useState({ x: 0, y: 0 });
  const [windowSize, setWindowSize] = useState({ w: 400, h: 520 });
  const windowDragging = useRef(false);
  const windowOffset = useRef({ x: 0, y: 0 });

  // Resize
  const resizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  useEffect(() => {
    if (isOpen && user) {
      loadConversations();
    }
  }, [isOpen, user, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Center window on open
  useEffect(() => {
    if (isOpen && !isMobile) {
      // Position window so it expands from FAB location
      const targetX = Math.max(10, Math.min(fab.pos.x - windowSize.w + 60, window.innerWidth - windowSize.w - 10));
      const targetY = Math.max(10, Math.min(fab.pos.y - windowSize.h + 60, window.innerHeight - windowSize.h - 10));
      setWindowPos({ x: targetX, y: targetY });
    }
  }, [isOpen, isMobile]);

  // Window drag handlers
  const onWindowDragStart = useCallback((e: React.PointerEvent) => {
    if (isMobile) return;
    windowDragging.current = true;
    windowOffset.current = { x: e.clientX - windowPos.x, y: e.clientY - windowPos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [windowPos, isMobile]);

  const onWindowDragMove = useCallback((e: React.PointerEvent) => {
    if (!windowDragging.current) return;
    const newX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - windowOffset.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - windowOffset.current.y));
    setWindowPos({ x: newX, y: newY });
  }, []);

  const onWindowDragEnd = useCallback(() => {
    windowDragging.current = false;
  }, []);

  // Resize handlers — RTL: handle is at bottom-right corner.
  // Dragging right grows width (window stays anchored to its left edge).
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const dw = e.clientX - resizeStart.current.x;
      const dh = e.clientY - resizeStart.current.y;
      setWindowSize({
        w: Math.max(320, Math.min(800, resizeStart.current.w + dw)),
        h: Math.max(400, Math.min(900, resizeStart.current.h + dh)),
      });
    };
    const onMouseUp = () => { resizing.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    resizing.current = true;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: windowSize.w, h: windowSize.h };
    e.preventDefault();
  }, [windowSize]);

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isLoading) return;
    const msg = inputValue;
    setInputValue('');
    sendMessage(msg, currentCourseId);
  }, [inputValue, isLoading, sendMessage, currentCourseId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectConversation = (conv: Conversation) => {
    loadMessages(conv.id);
    setShowHistory(false);
  };

  const handleClose = useCallback(() => {
    setIsClosing(true);
    cancelStream();
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 350);
  }, [cancelStream]);

  if (!user) return null;

  return (
    <>
      {/* FAB */}
      {!isOpen && (
        <div
          className="fixed z-[9999] cursor-grab active:cursor-grabbing touch-none animate-fab-in"
          style={{ left: fab.pos.x, top: fab.pos.y }}
          onPointerDown={fab.onPointerDown}
          onPointerMove={fab.onPointerMove}
          onPointerUp={(e) => {
            fab.onPointerUp();
            if (!fab.hasMoved.current) {
              setIsOpen(true);
              completeStep('aria_chat');
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`פתיחת ${assistantName} - העוזר שלך`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen(true);
              completeStep('aria_chat');
            }
          }}
        >
          <div className="relative group select-none">
            {/* Pulsing glow ring */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary to-accent blur-xl opacity-50 group-hover:opacity-75 transition-opacity duration-300 scale-110 pointer-events-none" />
            {/* Assistant mascot FAB */}
            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:scale-110 transition-all duration-300 ease-out-cubic flex items-center justify-center overflow-hidden pointer-events-none">
              {!avatarFailed ? (
                <img
                  key={assistantAvatar}
                  src={assistantAvatar}
                  alt={assistantName}
                  draggable={false}
                  className="w-14 h-14 object-cover rounded-full drop-shadow-md pointer-events-none select-none"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <Bot className="w-7 h-7 text-primary-foreground" />
              )}
            </div>
            {/* Sparkle indicator */}
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent border-2 border-background animate-pulse pointer-events-none" />
          </div>
        </div>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div
          className={cn(
            "fixed z-[9999] flex flex-col bg-card border border-border/60 shadow-2xl shadow-primary/10 overflow-hidden",
            isMobile
              ? "inset-0 rounded-none"
              : "rounded-2xl",
            isMobile
              ? (isClosing ? "animate-slide-down" : "animate-slide-up")
              : (isClosing ? "animate-chat-out" : "animate-chat-in")
          )}
          style={isMobile ? undefined : {
            left: windowPos.x,
            top: windowPos.y,
            width: windowSize.w,
            height: windowSize.h,
            transformOrigin: `${fab.pos.x - windowPos.x + 28}px ${fab.pos.y - windowPos.y + 28}px`,
          }}
        >
          {/* Header — premium gradient */}
          <div
            className={cn(
              "flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary via-primary to-accent text-primary-foreground select-none shrink-0 relative overflow-hidden",
              !isMobile && "cursor-grab active:cursor-grabbing"
            )}
            onPointerDown={onWindowDragStart}
            onPointerMove={onWindowDragMove}
            onPointerUp={onWindowDragEnd}
          >
            {/* Decorative shimmer */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(255,255,255,0.15),transparent_50%)] pointer-events-none" />
            <div className="flex items-center gap-2.5 relative">
              <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center overflow-hidden">
                {!avatarFailed ? (
                  <img
                    key={assistantAvatar}
                    src={assistantAvatar}
                    alt={assistantName}
                    className="w-8 h-8 object-cover rounded-lg"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <Bot className="w-5 h-5 text-primary-foreground" />
                )}
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-sm leading-tight">{assistantName}</span>
                <span className="text-[10px] opacity-80 leading-tight">עוזר AI אישי</span>
              </div>
            </div>
            <div className="flex items-center gap-1 relative">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-white/20 rounded-lg"
                onClick={() => { setShowHistory(!showHistory); }}
                title="שיחות קודמות"
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-white/20 rounded-lg"
                onClick={() => startNewChat()}
                title="שיחה חדשה"
              >
                <Plus className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-white/20 rounded-lg"
                onClick={handleClose}
                title="סגור"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* History panel */}
            {showHistory && (
              <div className="absolute inset-0 z-10 bg-card flex flex-col">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <span className="font-medium text-sm">שיחות קודמות</span>
                  <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {conversations.length === 0 ? (
                      <p className="text-center text-muted-foreground text-sm py-8">אין שיחות קודמות</p>
                    ) : (
                      conversations.map(conv => (
                        <div
                          key={conv.id}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-muted transition-colors text-sm",
                            currentConversationId === conv.id && "bg-muted"
                          )}
                          onClick={() => handleSelectConversation(conv)}
                        >
                          <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{conv.title}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                            onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Messages */}
            <ScrollArea className="flex-1" dir="rtl">
              <div className="p-4 space-y-4 min-h-full">
                {messages.length === 0 && !isLoading && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="relative mb-4">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary to-accent blur-2xl opacity-50" />
                      <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-xl shadow-primary/30 overflow-hidden">
                        <img
                          key={assistantAvatar}
                          src={assistantAvatar}
                          alt={assistantName}
                          className="w-20 h-20 object-cover rounded-2xl drop-shadow-lg"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-foreground font-bold text-base">היי, אני {assistantName}! 👋</p>
                    <p className="text-muted-foreground text-xs mt-1.5 max-w-[240px]">שאל אותי כל שאלה על חומר הלימוד</p>

                    {/* Quick action prompts — contextual to current page */}
                    <div className="mt-5 w-full space-y-2 px-2">
                      {getContextualPrompts(location.pathname).map((prompt) => (
                        <button
                          key={prompt.text}
                          onClick={() => sendMessage(prompt.text, currentCourseId)}
                          className="w-full flex items-center gap-2.5 text-right text-xs px-3 py-2.5 rounded-xl border border-border/60 bg-background hover:bg-primary/5 hover:border-primary/40 transition-all duration-200 group"
                        >
                          <span className="text-base flex-shrink-0">{prompt.icon}</span>
                          <span className="text-foreground group-hover:text-primary transition-colors text-right flex-1">{prompt.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => {
                  const messageId = `msg-${i}`;
                  return (
                    <MessageBubble
                      key={i}
                      messageId={messageId}
                      message={msg}
                      onNavigate={(path) => { handleClose(); setTimeout(() => navigate(path), 400); }}
                      voiceOutput={voiceOutput}
                    />
                  );
                })}

                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-xl px-4 py-3.5 max-w-[85%] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border/60 shrink-0 bg-muted/30">
            <div className="flex items-end gap-2">
              {voiceInput.isListening ? (
                /* Recording bar — replaces textarea while mic is active */
                <div
                  className="flex-1 flex items-center gap-3 rounded-xl border border-red-500/60 ring-2 ring-red-500/20 bg-background px-4 min-h-[42px] shadow-sm"
                  dir="ltr"
                >
                  {/* Pulsing red dot */}
                  <span className="relative flex shrink-0">
                    <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-60" />
                    <span className="relative w-2 h-2 rounded-full bg-red-500" />
                  </span>
                  {/* Timer */}
                  <span className="text-xs font-mono tabular-nums text-red-600 dark:text-red-400 shrink-0 min-w-[34px]">
                    {formatRecordingTime(voiceInput.elapsedMs)}
                  </span>
                  {/* Waveform fills the rest */}
                  <div className="flex-1 h-6 text-red-500 dark:text-red-400">
                    <VoiceWaveform levels={voiceInput.levels} color="currentColor" />
                  </div>
                </div>
              ) : (
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="שאל שאלה..."
                  className="flex-1 resize-none rounded-xl border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 transition-colors min-h-[42px] max-h-[120px] shadow-sm border-border/60 focus-visible:ring-primary/30 focus-visible:border-primary/50"
                  dir="rtl"
                  rows={1}
                  disabled={isLoading}
                />
              )}
              {voiceInput.supported && (
                <Button
                  size="icon"
                  variant="outline"
                  className={cn(
                    "h-[42px] w-[42px] rounded-xl shrink-0 transition-all border-border/60",
                    voiceInput.isListening
                      ? "bg-red-500 text-white border-red-500 hover:bg-red-600 animate-pulse-glow"
                      : "hover:bg-primary/5 hover:border-primary/40 hover:text-primary"
                  )}
                  onClick={voiceInput.toggle}
                  disabled={isLoading}
                  title={voiceInput.isListening ? 'עצירת הקלטה' : 'הקלטה בקול'}
                >
                  {voiceInput.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              <Button
                size="icon"
                className="h-[42px] w-[42px] rounded-xl shrink-0 bg-gradient-to-br from-primary to-accent shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:scale-105 transition-all"
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Resize handle — bottom-right corner (RTL: chat anchored to right side) */}
          {!isMobile && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
              onMouseDown={onResizeStart}
              aria-label="שנה גודל"
            >
              <GripVertical className="w-3 h-3 text-muted-foreground rotate-45 translate-x-0.5 translate-y-0.5" />
            </div>
          )}
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.4); }
          50% { box-shadow: 0 0 0 8px hsl(var(--primary) / 0); }
        }
        .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }

        @keyframes fab-in {
          0% { opacity: 0; transform: scale(0.3); }
          60% { transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
        .animate-fab-in { animation: fab-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }

        @keyframes chat-in {
          0% { 
            opacity: 0; 
            transform: scale(0.1);
            border-radius: 50%;
          }
          50% {
            opacity: 1;
            border-radius: 24px;
          }
          100% { 
            opacity: 1; 
            transform: scale(1);
            border-radius: 12px;
          }
        }
        .animate-chat-in { animation: chat-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards; }

        @keyframes chat-out {
          0% { 
            opacity: 1; 
            transform: scale(1);
            border-radius: 12px;
          }
          50% {
            border-radius: 24px;
          }
          100% { 
            opacity: 0; 
            transform: scale(0.1);
            border-radius: 50%;
          }
        }
        .animate-chat-out { animation: chat-out 0.35s cubic-bezier(0.55, 0, 1, 0.45) forwards; }

        @keyframes slide-up {
          0% { transform: translateY(100%); }
          100% { transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.3s cubic-bezier(0.22, 1, 0.36, 1); }

        @keyframes slide-down {
          0% { transform: translateY(0); }
          100% { transform: translateY(100%); }
        }
        .animate-slide-down { animation: slide-down 0.3s cubic-bezier(0.55, 0, 1, 0.45) forwards; }
      `}</style>
    </>
  );
}

// ─── Markdown sanitization ───
//
// LLMs (especially Gemini) sometimes emit malformed markdown links that confuse
// react-markdown and end up rendered as raw text. Common bugs we fix here:
//   1. URL wrapped in quotes:  [text]("/url")  → [text](/url)
//   2. Trailing punctuation in title:  [title."](/url) → [title"](/url)
//   3. Stray closing-quote dragged into the URL: [text](/url")  → [text](/url)
//   4. Whitespace inside the parentheses: [text]( /url )  → [text](/url)
function sanitizeMarkdownLinks(content: string): string {
  if (!content) return content;
  let out = content;
  // Strip wrapping quotes (single or double, ASCII or curly) around URLs
  out = out.replace(
    /\]\(\s*["'\u201C\u201D\u2018\u2019]?(\/[^\s"'\u201C\u201D\u2018\u2019)]+|https?:\/\/[^\s"'\u201C\u201D\u2018\u2019)]+)["'\u201C\u201D\u2018\u2019]?\s*\)/g,
    '](\u200B$1)',
  );
  // Restore the marker → real char (the \u200B was a placeholder so we don't
  // accidentally double-process)
  out = out.replace(/\(\u200B/g, '(');
  return out;
}

// ─── Message Bubble ───
interface VoiceOutputControls {
  supported: boolean;
  speakingId: string | null;
  speak: (text: string, id: string) => void;
  stop: () => void;
}

function MessageBubble({
  message,
  messageId,
  onNavigate,
  voiceOutput,
}: {
  message: ChatMessage;
  messageId: string;
  onNavigate: (path: string) => void;
  voiceOutput?: VoiceOutputControls;
}) {
  const isUser = message.role === 'user';
  const isSpeaking = voiceOutput?.speakingId === messageId;
  const sources = message.sources?.filter((s: any) => s.lesson_id) || [];
  const uniqueSources = sources.filter((s: any, i: number, arr: any[]) =>
    arr.findIndex((x: any) => x.lesson_id === s.lesson_id) === i
  );

  // Filter sources to only show ones actually referenced in the response content
  const referencedSources = uniqueSources.filter((s: any) => {
    if (!message.content) return false;
    const content = message.content;
    // Check if lesson_id or course_id appears in links, or if course/lesson title is mentioned
    return (
      content.includes(s.lesson_id) ||
      content.includes(s.course_id) ||
      (s.lesson_title && content.includes(s.lesson_title)) ||
      (s.course_title && content.includes(s.course_title))
    );
  });
  // Use referenced sources if any found, otherwise fall back to first 3 unique sources
  const displayedSources = referencedSources.length > 0 ? referencedSources : uniqueSources.slice(0, 3);

  return (
    <div className={cn("flex flex-col animate-fade-in", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 max-w-[85%] text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-gradient-to-br from-primary to-accent text-primary-foreground rounded-br-md"
            : "bg-muted/80 text-foreground border border-border/40 rounded-bl-md"
        )}
        dir="rtl"
        style={{ textAlign: 'right' }}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 chat-prose-rtl">
            <ReactMarkdown
              components={{
                pre: ({ children }) => <pre dir="ltr" style={{ textAlign: 'left', direction: 'ltr' }}>{children}</pre>,
                code: ({ children, className, ...props }) => {
                  const isBlock = className?.includes('language-');
                  if (isBlock) return <code dir="ltr" className={className} {...props}>{children}</code>;
                  return <code className={className} {...props}>{children}</code>;
                },
                a: ({ href, children }) => {
                  if (href?.startsWith('/')) {
                    return (
                      <button
                        className="text-primary underline hover:text-primary/80 cursor-pointer font-medium"
                        onClick={() => onNavigate(href)}
                      >
                        {children}
                      </button>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {sanitizeMarkdownLinks(message.content)}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Voice playback button for AI messages */}
      {!isUser && voiceOutput?.supported && message.content && (
        <button
          onClick={() => voiceOutput.speak(message.content, messageId)}
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
            isSpeaking
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-primary hover:bg-primary/5"
          )}
          title={isSpeaking ? 'עצירת השמעה' : 'השמעה בקול'}
        >
          {isSpeaking ? (
            <>
              <VolumeX className="w-3 h-3" />
              <span>עצירה</span>
            </>
          ) : (
            <>
              <Volume2 className="w-3 h-3" />
              <span>השמע</span>
            </>
          )}
        </button>
      )}

      {/* Source tags */}
      {!isUser && displayedSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[85%]" dir="rtl">
          {displayedSources.map((source: any, i: number) => (
            <Badge
              key={i}
              variant="outline"
              className="cursor-pointer text-xs gap-1 px-2 py-0.5 hover:bg-primary/10 transition-colors"
              onClick={() => onNavigate(`/courses/${source.course_id}?lesson=${source.lesson_id}`)}
            >
              <BookOpen className="w-3 h-3" />
              <span className="truncate max-w-[180px]">
                {source.course_title && source.lesson_title
                  ? `${source.course_title} · ${source.lesson_title}`
                  : source.lesson_title || source.course_title || 'מקור'}
              </span>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

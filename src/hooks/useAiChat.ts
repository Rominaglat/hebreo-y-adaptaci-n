import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { parseChatEvent, type ChatEvent } from '@/lib/aiChatStream';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
  created_at?: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`;

/** A send that got no answer — kept so the student can retry with one tap. */
export interface FailedSend { content: string; courseId?: string; lessonId?: string }

export type AnswerRating = 1 | -1;

export function useAiChat() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [failedSend, setFailedSend] = useState<FailedSend | null>(null);
  // 👍/👎 the student gave, by chat_messages.id
  const [ratings, setRatings] = useState<Record<string, AnswerRating>>({});
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setIsLoadingConversations(true);
    try {
      const { data, error } = await supabase
        .from('chat_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setConversations((data || []) as Conversation[]);
    } catch (e) {
      console.error('Error loading conversations:', e);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      const loaded = (data || []) as ChatMessage[];
      setMessages(loaded);
      setCurrentConversationId(conversationId);
      setFailedSend(null);
      const answerIds = loaded.filter(m => m.role === 'assistant' && m.id).map(m => m.id as string);
      if (answerIds.length > 0) {
        const { data: rows } = await supabase
          .from('chat_message_feedback')
          .select('message_id, rating')
          .in('message_id', answerIds);
        setRatings(Object.fromEntries((rows ?? []).map(r => [r.message_id, r.rating as AnswerRating])));
      } else {
        setRatings({});
      }
    } catch (e) {
      console.error('Error loading messages:', e);
    }
  }, []);

  const createConversation = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    try {
      const { data, error } = await supabase
        .from('chat_conversations')
        .insert({
          user_id: user.id,
          title: t('aiChat.newChat'),
        })
        .select()
        .single();

      if (error) throw error;
      const conv = data as Conversation;
      setConversations(prev => [conv, ...prev]);
      setCurrentConversationId(conv.id);
      setMessages([]);
      return conv.id;
    } catch (e) {
      console.error('Error creating conversation:', e);
      return null;
    }
  }, [user, t]);

  const startNewChat = useCallback(async () => {
    setMessages([]);
    setCurrentConversationId(null);
    setFailedSend(null);
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await supabase.from('chat_conversations').delete().eq('id', conversationId);
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      if (currentConversationId === conversationId) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error('Error deleting conversation:', e);
    }
  }, [currentConversationId]);

  const sendMessage = useCallback(async (
    content: string,
    courseId?: string,
    lessonId?: string,
    opts: { isRetry?: boolean } = {},
  ) => {
    if (!content.trim() || !session) return;

    // Create conversation if needed
    let convId = currentConversationId;
    if (!convId) {
      convId = await createConversation();
      if (!convId) return;
    }

    setFailedSend(null);
    const userMsg: ChatMessage = { role: 'user', content };
    // A retry re-sends the question already on screen instead of adding it twice.
    const history = opts.isRetry && messages[messages.length - 1]?.role === 'user' && messages[messages.length - 1]?.content === content
      ? messages.slice(0, -1)
      : messages;
    if (!opts.isRetry || history === messages) setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    let assistantContent = '';
    let assistantSources: any[] = [];

    const updateAssistant = (chunk: string, sources?: any[]) => {
      if (chunk) assistantContent += chunk;
      if (sources) assistantSources = sources;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent, sources: assistantSources.length > 0 ? assistantSources : m.sources } : m);
        }
        return [...prev, { role: 'assistant', content: assistantContent, sources: assistantSources }];
      });
    };
    const setAnswerId = (id: string) => {
      setMessages(prev => prev.map((m, i) => (i === prev.length - 1 && m.role === 'assistant' ? { ...m, id } : m)));
    };
    const applyEvent = (ev: ChatEvent) => {
      if (ev.sources) updateAssistant('', ev.sources);
      else if (ev.messageId) setAnswerId(ev.messageId);
      else if (ev.delta) updateAssistant(ev.delta);
    };

    try {
      const allMessages = [...history, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Always a current token: an expired one (a laptop waking from sleep)
      // used to come back 401 and leave the question unanswered. getSession()
      // refreshes an expired session; a 401 anyway gets one refresh + retry.
      const post = async (accessToken: string) => {
        abortControllerRef.current = new AbortController();
        return fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            messages: allMessages,
            conversation_id: convId,
            ...(courseId && { course_id: courseId }),
            ...(lessonId && { lesson_id: lessonId }),
          }),
          signal: abortControllerRef.current.signal,
        });
      };
      const { data: { session: current } } = await supabase.auth.getSession();
      let resp = await post(current?.access_token ?? session.access_token);
      if (resp.status === 401) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed.session) resp = await post(refreshed.session.access_token);
      }

      if (!resp.ok) {
        if (resp.status === 429) {
          toast({ title: t('aiChat.rateLimitTitle'), description: t('aiChat.rateLimitDesc'), variant: 'destructive' });
          setFailedSend({ content, courseId, lessonId });
          return;
        }
        if (resp.status === 402) {
          toast({ title: t('aiChat.quotaTitle'), description: t('aiChat.quotaDesc'), variant: 'destructive' });
          return;
        }
        throw new Error(`ai-assistant ${resp.status}`);
      }

      if (!resp.body) throw new Error('No response body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const ev = parseChatEvent(line.slice(6).trim());
          if (ev === null) {
            // Split mid-JSON: put it back and wait for the rest.
            textBuffer = line + '\n' + textBuffer;
            break;
          }
          if (ev.done) continue;
          applyEvent(ev);
        }
      }

      // Flush remaining
      if (textBuffer.trim()) {
        for (const raw of textBuffer.split('\n')) {
          if (!raw || !raw.startsWith('data: ')) continue;
          const ev = parseChatEvent(raw.slice(6).trim());
          if (ev && !ev.done) applyEvent(ev);
        }
      }

      if (!assistantContent.trim()) throw new Error('empty answer');

      // Refresh conversations to get updated title
      await loadConversations();
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      console.error('Error sending message:', e);
      // Keep the question so the chat can offer "Reintentar" right there.
      setFailedSend({ content, courseId, lessonId });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [currentConversationId, session, messages, createConversation, loadConversations, toast, t]);

  const retryLast = useCallback(() => {
    if (!failedSend) return;
    // Drop a half-streamed answer, if any, before asking again.
    setMessages(prev => (prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1]?.id ? prev.slice(0, -1) : prev));
    void sendMessage(failedSend.content, failedSend.courseId, failedSend.lessonId, { isRetry: true });
  }, [failedSend, sendMessage]);

  /** 👍 / 👎 an answer; tapping the same rating again removes it. */
  const rateMessage = useCallback(async (messageId: string, rating: AnswerRating) => {
    if (!user) return;
    const previous = ratings[messageId];
    const next = previous === rating ? undefined : rating;
    setRatings(prev => {
      const copy = { ...prev };
      if (next) copy[messageId] = next; else delete copy[messageId];
      return copy;
    });
    const { error } = next
      ? await supabase.from('chat_message_feedback').upsert(
          { message_id: messageId, user_id: user.id, rating: next, updated_at: new Date().toISOString() },
          { onConflict: 'message_id,user_id' },
        )
      : await supabase.from('chat_message_feedback').delete().eq('message_id', messageId).eq('user_id', user.id);
    if (error) {
      console.error('Error saving answer rating:', error);
      setRatings(prev => {
        const copy = { ...prev };
        if (previous) copy[messageId] = previous; else delete copy[messageId];
        return copy;
      });
    }
  }, [user, ratings]);

  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }, []);

  return {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    isLoadingConversations,
    loadConversations,
    loadMessages,
    createConversation,
    startNewChat,
    deleteConversation,
    sendMessage,
    cancelStream,
    setCurrentConversationId,
    failedSend,
    retryLast,
    ratings,
    rateMessage,
  };
}

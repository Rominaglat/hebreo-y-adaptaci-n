import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

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

export function useAiChat() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
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
      setMessages((data || []) as ChatMessage[]);
      setCurrentConversationId(conversationId);
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

  const sendMessage = useCallback(async (content: string, courseId?: string) => {
    if (!content.trim() || !session) return;

    // Create conversation if needed
    let convId = currentConversationId;
    if (!convId) {
      convId = await createConversation();
      if (!convId) return;
    }

    const userMsg: ChatMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMsg]);
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

    try {
      abortControllerRef.current = new AbortController();

      const allMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages: allMessages,
          conversation_id: convId,
          ...(courseId && { course_id: courseId }),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          toast({ title: t('aiChat.rateLimitTitle'), description: t('aiChat.rateLimitDesc'), variant: 'destructive' });
          setIsLoading(false);
          return;
        }
        if (resp.status === 402) {
          toast({ title: t('aiChat.quotaTitle'), description: t('aiChat.quotaDesc'), variant: 'destructive' });
          setIsLoading(false);
          return;
        }
        throw new Error('Failed to get response');
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

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.sources) {
              updateAssistant('', parsed.sources);
            } else {
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) updateAssistant(delta);
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Flush remaining
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw || !raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.sources) {
              updateAssistant('', parsed.sources);
            } else {
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) updateAssistant(delta);
            }
          } catch { /* ignore */ }
        }
      }

      // Refresh conversations to get updated title
      await loadConversations();
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      console.error('Error sending message:', e);
      toast({
        title: t('common.error'),
        description: t('aiChat.sendError'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [currentConversationId, session, messages, createConversation, loadConversations, toast, t]);

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
  };
}

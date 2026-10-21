// One `data:` payload of the ai-assistant SSE stream (OpenAI-style deltas,
// plus our own `sources` and `message_id` events).

export interface ChatEvent {
  delta?: string;
  sources?: unknown[];
  /** chat_messages.id of the saved answer — what 👍/👎 rate. */
  messageId?: string;
  done?: boolean;
}

/** null = not valid JSON yet (a line split mid-payload); the caller keeps buffering. */
export function parseChatEvent(jsonStr: string): ChatEvent | null {
  if (jsonStr === '[DONE]') return { done: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  const p = parsed as { sources?: unknown; message_id?: unknown; choices?: Array<{ delta?: { content?: unknown } }> };
  if (Array.isArray(p.sources)) return { sources: p.sources };
  if (typeof p.message_id === 'string') return { messageId: p.message_id };
  const delta = p.choices?.[0]?.delta?.content;
  return typeof delta === 'string' && delta ? { delta } : {};
}

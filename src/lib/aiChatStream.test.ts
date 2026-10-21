import { describe, it, expect } from 'vitest';
import { parseChatEvent } from './aiChatStream';

describe('parseChatEvent — one SSE data payload from ai-assistant', () => {
  it('reads a text delta', () => {
    expect(parseChatEvent('{"choices":[{"delta":{"content":"שלום"}}]}')).toEqual({ delta: 'שלום' });
  });
  it('reads sources', () => {
    expect(parseChatEvent('{"sources":[{"course_id":"c1"}]}')).toEqual({ sources: [{ course_id: 'c1' }] });
  });
  it('reads the saved answer id (for 👍/👎)', () => {
    expect(parseChatEvent('{"message_id":"m-123"}')).toEqual({ messageId: 'm-123' });
  });
  it('treats [DONE] as the end', () => {
    expect(parseChatEvent('[DONE]')).toEqual({ done: true });
  });
  it('returns null for a payload split mid-JSON, so the caller can wait for the rest', () => {
    expect(parseChatEvent('{"choices":[{"delta":{"con')).toBeNull();
  });
  it('ignores an event with nothing it understands', () => {
    expect(parseChatEvent('{"foo":1}')).toEqual({});
  });
});

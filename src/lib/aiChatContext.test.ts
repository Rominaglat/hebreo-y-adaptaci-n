import { describe, it, expect, vi } from 'vitest';
import { setChatLesson, clearChatLesson, getChatLesson, subscribeChatLesson } from './aiChatContext';

describe('aiChatContext — the lesson open on screen, for the AI chat', () => {
  it('starts empty, holds the lesson set, and clears', () => {
    clearChatLesson();
    expect(getChatLesson()).toBeNull();
    setChatLesson({ courseId: 'c1', lessonId: 'l1', lessonTitle: 'PAAL 1' });
    expect(getChatLesson()).toEqual({ courseId: 'c1', lessonId: 'l1', lessonTitle: 'PAAL 1' });
    clearChatLesson();
    expect(getChatLesson()).toBeNull();
  });

  it('notifies subscribers only when the lesson actually changes', () => {
    clearChatLesson();
    const listener = vi.fn();
    const unsubscribe = subscribeChatLesson(listener);
    setChatLesson({ courseId: 'c1', lessonId: 'l1', lessonTitle: 'PAAL 1' });
    setChatLesson({ courseId: 'c1', lessonId: 'l1', lessonTitle: 'PAAL 1' });
    setChatLesson({ courseId: 'c1', lessonId: 'l2', lessonTitle: 'Tabla de verbos' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    clearChatLesson();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('only clears the lesson it was asked to clear (a late cleanup must not wipe a newer lesson)', () => {
    setChatLesson({ courseId: 'c1', lessonId: 'l2', lessonTitle: 'Tabla de verbos' });
    clearChatLesson('l1');
    expect(getChatLesson()?.lessonId).toBe('l2');
    clearChatLesson('l2');
    expect(getChatLesson()).toBeNull();
  });
});

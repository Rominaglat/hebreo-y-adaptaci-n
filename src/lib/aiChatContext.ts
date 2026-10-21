import { useSyncExternalStore } from 'react';

// Which lesson the student has open right now, for Romina AI. CourseDetail
// keeps the selected lesson in component state (not in the URL), so the
// floating chat — mounted once in the layout — had no way to know it, and
// "Resúmeme esta lección" failed 75% of the time. A tiny external store,
// written by CourseDetail and read by the chat.

export interface ChatLesson {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
}

let current: ChatLesson | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function getChatLesson(): ChatLesson | null {
  return current;
}

export function setChatLesson(lesson: ChatLesson): void {
  if (current && current.courseId === lesson.courseId && current.lessonId === lesson.lessonId && current.lessonTitle === lesson.lessonTitle) return;
  current = lesson;
  emit();
}

/** Clear — only if `lessonId` (when given) is still the current one, so a late cleanup can't wipe a newer lesson. */
export function clearChatLesson(lessonId?: string): void {
  if (!current) return;
  if (lessonId && current.lessonId !== lessonId) return;
  current = null;
  emit();
}

export function subscribeChatLesson(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useChatLesson(): ChatLesson | null {
  return useSyncExternalStore(subscribeChatLesson, getChatLesson, () => null);
}

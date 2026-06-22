import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateLeadForm,
  buildPrivateLessonPayload,
  submitPrivateLessonRequest,
  PRIVATE_LESSON_WEBHOOK_URL,
  type LeadForm,
  type PrivateLessonContext,
} from './privateLesson';

const ctx: PrivateLessonContext = {
  userId: 'user-123',
  locale: 'he',
  page: '/dashboard',
  submittedAt: '2026-06-22T10:00:00.000Z',
};

const fullForm: LeadForm = {
  name: 'דנה כהן',
  email: 'dana@example.com',
  phone: '050-1234567',
};

describe('validateLeadForm', () => {
  it('accepts a fully filled form', () => {
    expect(validateLeadForm(fullForm)).toEqual({ ok: true });
  });

  it('rejects a blank name', () => {
    const r = validateLeadForm({ ...fullForm, name: '   ' });
    expect(r).toEqual({ ok: false, field: 'name' });
  });

  it('rejects an invalid email when one is provided', () => {
    const r = validateLeadForm({ ...fullForm, email: 'not-an-email' });
    expect(r).toEqual({ ok: false, field: 'email' });
  });

  it('requires at least one contact method when both are empty', () => {
    const r = validateLeadForm({ name: 'דנה', email: '', phone: '' });
    expect(r).toEqual({ ok: false, field: 'contact' });
  });

  it('accepts phone only (no email)', () => {
    expect(validateLeadForm({ name: 'דנה', email: '', phone: '050-1234567' })).toEqual({ ok: true });
  });

  it('accepts email only (no phone)', () => {
    expect(validateLeadForm({ name: 'דנה', email: 'dana@example.com', phone: '' })).toEqual({ ok: true });
  });
});

describe('buildPrivateLessonPayload', () => {
  it('builds the webhook payload with constants and trimmed fields', () => {
    const payload = buildPrivateLessonPayload(
      { name: '  דנה כהן  ', email: ' dana@example.com ', phone: ' 050-1234567 ' },
      ctx,
    );
    expect(payload).toEqual({
      name: 'דנה כהן',
      email: 'dana@example.com',
      phone: '050-1234567',
      request_type: 'private_lesson_1on1',
      source: 'learning-portal',
      user_id: 'user-123',
      locale: 'he',
      page: '/dashboard',
      submitted_at: '2026-06-22T10:00:00.000Z',
    });
  });

  it('uses null user_id when no user is signed in', () => {
    const payload = buildPrivateLessonPayload(fullForm, { ...ctx, userId: null });
    expect(payload.user_id).toBeNull();
  });
});

describe('submitPrivateLessonRequest', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('POSTs JSON to the Make webhook and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await submitPrivateLessonRequest(fullForm, ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PRIVATE_LESSON_WEBHOOK_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      name: 'דנה כהן',
      email: 'dana@example.com',
      phone: '050-1234567',
      request_type: 'private_lesson_1on1',
      source: 'learning-portal',
      user_id: 'user-123',
    });
  });

  it('throws when the webhook responds with a non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(submitPrivateLessonRequest(fullForm, ctx)).rejects.toThrow();
  });
});

describe('PRIVATE_LESSON_WEBHOOK_URL', () => {
  it('defaults to the configured Make endpoint', () => {
    expect(PRIVATE_LESSON_WEBHOOK_URL).toBe(
      'https://hook.us2.make.com/t0llq7nwgfh3slg1cgxpm4ut6jlwfpkm',
    );
  });
});

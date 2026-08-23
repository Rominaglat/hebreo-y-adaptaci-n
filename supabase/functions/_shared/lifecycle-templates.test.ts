import { describe, it, expect } from 'vitest';
import { firstName, renderLifecycleEmail, type LifecycleEmailInput } from './lifecycle-templates.ts';
import type { LifecycleKind } from './lifecycle.ts';

const input = (over: Partial<LifecycleEmailInput> = {}): LifecycleEmailInput => ({
  fullName: 'María Fernanda Gómez',
  ctaUrl: 'https://app.rominahebreo.com/dashboard',
  unsubscribeUrl: 'https://x.supabase.co/functions/v1/lifecycle-unsubscribe?token=abc',
  contactUrl: 'mailto:romina@example.com',
  ...over,
});

const KINDS: LifecycleKind[] = ['welcome_6h', 'tips_48h', 'inactive_7d'];

describe('firstName', () => {
  it('takes only the first word of a full name', () => {
    expect(firstName('María Fernanda Gómez')).toBe('María');
  });

  it('is empty when the profile has no name', () => {
    expect(firstName(null)).toBe('');
    expect(firstName('   ')).toBe('');
  });
});

describe('the win-back mail fills the [NOMBRE] placeholder', () => {
  it('greets the student by first name', () => {
    const { html, subject } = renderLifecycleEmail('inactive_7d', input());
    expect(html).toContain('Hola, María 💜');
    expect(html).not.toContain('[NOMBRE]');
    expect(subject).toBe('No estás atrasada, María 💜');
  });

  it('drops the name cleanly rather than greeting an empty space', () => {
    const { html, subject } = renderLifecycleEmail('inactive_7d', input({ fullName: null }));
    expect(html).toContain('Hola 💜');
    expect(html).not.toContain('Hola,');
    expect(subject).toBe('No estás atrasada 💜');
  });

  it('escapes a name that contains markup', () => {
    const { html } = renderLifecycleEmail('inactive_7d', input({ fullName: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('every lifecycle mail', () => {
  it.each(KINDS)('%s links to the portal and to unsubscribe', (kind) => {
    const i = input();
    const { html, text, subject } = renderLifecycleEmail(kind, i);
    expect(html).toContain(i.ctaUrl);
    expect(html).toContain(i.unsubscribeUrl);
    expect(text).toContain(i.ctaUrl);
    expect(subject.length).toBeGreaterThan(0);
  });

  it.each(KINDS)('%s ships a plain-text alternative', (kind) => {
    expect(renderLifecycleEmail(kind, input()).text.length).toBeGreaterThan(200);
  });
});

// Characterisation of the emphasis in Romina's source documents. The bold runs
// were recovered from the PDFs' Arial-BoldMT spans; if someone reflows the copy
// these assertions are the record of what was actually emphasised.
describe('emphasis matches the source documents', () => {
  const boldRuns = (kind: LifecycleKind) =>
    [...renderLifecycleEmail(kind, input()).html.matchAll(/<b>([\s\S]*?)<\/b>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  it('bolds three passages in the 6h mail', () => {
    expect(boldRuns('welcome_6h')).toEqual([
      'No busques tiempo para estudiar hebreo. Creá una pequeña cita contigo mismo-a.',
      '10 minutos',
      'No necesitás saber hebreo para empezar. Necesitás empezar para aprender hebreo.',
    ]);
  });

  it('bolds two passages in the 48h mail, and not "Necesitás constancia."', () => {
    expect(boldRuns('tips_48h')).toEqual([
      'pagar una membresía no genera el cambio.',
      'Ganaste independencia.',
    ]);
  });

  it('bolds only the closing clause of "Necesitás simplemente volver a entrar."', () => {
    expect(boldRuns('inactive_7d')).toEqual([
      'No estás atrasada.',
      'volver a entrar.',
      'Entrá durante 10 minutos.',
    ]);
  });
});

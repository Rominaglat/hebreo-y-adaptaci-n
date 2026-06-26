import { describe, it, expect } from 'vitest';
import { getFilePreviewKind } from './filePreview';

describe('getFilePreviewKind', () => {
  it('detects PDFs (the common case for "aplicación" lessons)', () => {
    expect(getFilePreviewKind('https://x.supabase.co/storage/v1/object/public/c/1779796691577__.pdf')).toBe('pdf');
  });

  it('is case-insensitive on the extension', () => {
    expect(getFilePreviewKind('https://x/FILE.PDF')).toBe('pdf');
  });

  it('ignores query strings and hash fragments when reading the extension', () => {
    expect(getFilePreviewKind('https://x/doc.pdf?token=abc&download=')).toBe('pdf');
    expect(getFilePreviewKind('https://x/doc.pdf#view=FitH')).toBe('pdf');
  });

  it('detects images', () => {
    expect(getFilePreviewKind('https://x/pic.png')).toBe('image');
    expect(getFilePreviewKind('https://x/pic.JPEG')).toBe('image');
    expect(getFilePreviewKind('https://x/pic.webp')).toBe('image');
  });

  it('detects office documents that need an external viewer', () => {
    expect(getFilePreviewKind('https://x/notes.docx')).toBe('office');
    expect(getFilePreviewKind('https://x/deck.pptx')).toBe('office');
    expect(getFilePreviewKind('https://x/sheet.xlsx')).toBe('office');
    expect(getFilePreviewKind('https://x/old.doc')).toBe('office');
  });

  it('falls back to "other" for unknown or extensionless URLs', () => {
    expect(getFilePreviewKind('https://x/file.zip')).toBe('other');
    expect(getFilePreviewKind('https://x/no-extension')).toBe('other');
  });

  it('handles empty / nullish input without throwing', () => {
    expect(getFilePreviewKind('')).toBe('other');
    // Guard runtime callers that may pass null despite the string type.
    expect(getFilePreviewKind(null as unknown as string)).toBe('other');
  });
});

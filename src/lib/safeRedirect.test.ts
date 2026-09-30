import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from './safeRedirect';

describe('safeRedirectPath', () => {
  it('returns the internal path a router location points to, with its query and hash', () => {
    expect(safeRedirectPath({ pathname: '/encuesta', search: '?src=wa', hash: '#top' })).toBe('/encuesta?src=wa#top');
  });

  it('accepts a plain path string', () => {
    expect(safeRedirectPath('/courses/123')).toBe('/courses/123');
  });

  it('falls back to /dashboard when there is nothing to return to', () => {
    expect(safeRedirectPath(undefined)).toBe('/dashboard');
    expect(safeRedirectPath(null)).toBe('/dashboard');
    expect(safeRedirectPath({})).toBe('/dashboard');
    expect(safeRedirectPath('')).toBe('/dashboard');
  });

  it('never redirects off-site (open-redirect guard)', () => {
    expect(safeRedirectPath('https://evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('//evil.example/x')).toBe('/dashboard');
    expect(safeRedirectPath('/\\evil.example')).toBe('/dashboard');
    expect(safeRedirectPath({ pathname: '//evil.example' })).toBe('/dashboard');
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/dashboard');
  });

  it('does not bounce back to the login page itself', () => {
    expect(safeRedirectPath('/login')).toBe('/dashboard');
    expect(safeRedirectPath({ pathname: '/login', search: '?x=1' })).toBe('/dashboard');
  });

  it('honours a custom fallback', () => {
    expect(safeRedirectPath(undefined, '/courses')).toBe('/courses');
  });
});

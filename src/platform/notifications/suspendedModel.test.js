import { describe, expect, it } from 'vitest';
import { isPublicPath, isSuspendedClose, suspension } from './suspendedModel.js';

describe('suspendedModel', () => {
  it('keeps help, privacy, terms and about reachable; everything else is behind the screen', () => {
    for (const p of ['/help', '/help/', '/privacy', '/terms', '/about', '/help/contact']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/', '/profile', '/shop', '/games', '/login', '/helpful', '/friends', '', null]) expect(isPublicPath(p)).toBe(false);
  });
  it('reads the reason from a socket message, an error body or a string', () => {
    expect(suspension({ t: 'suspended', reason: '  Cheating in   ranked games ' })).toEqual({ reason: 'Cheating in ranked games' });
    expect(suspension({ data: { reason: 'Abuse' } })).toEqual({ reason: 'Abuse' });
    expect(suspension('Spam')).toEqual({ reason: 'Spam' });
    expect(suspension(null)).toEqual({ reason: '' });
    expect(suspension({ reason: 42 })).toEqual({ reason: '' });
    expect(suspension({ reason: 'x'.repeat(500) }).reason).toHaveLength(200);
  });
  it('recognises the user socket being refused (4003)', () => {
    expect(isSuspendedClose({ reason: 'fatal_close', code: 4003 })).toBe(true);
    expect(isSuspendedClose({ reason: 'fatal_close', code: 4001 })).toBe(false);
    expect(isSuspendedClose({ reason: 'client' })).toBe(false);
    expect(isSuspendedClose(undefined)).toBe(false);
  });
});

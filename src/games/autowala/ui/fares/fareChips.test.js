import { describe, expect, it } from 'vitest';
import { rideChips } from './fareChips.js';

describe('ride chips', () => {
  it('shows nothing without a trip', () => {
    expect(rideChips(null)).toEqual([]);
    expect(rideChips(undefined)).toEqual([]);
  });

  it('shows the terms, the surcharges, the urgent reason and the shared rider', () => {
    const chips = rideChips({
      terms: { mode: 'fixed', fixedFare: 210 },
      modifiers: [{ id: 'night', label: 'Night charge', te: 'రాత్రి ఛార్జ్', mul: 1.25 }, { id: 'luggage', label: 'Luggage', te: 'సామాను', flat: 20 }],
      urgent: { id: 'train', en: 'Train in 10 minutes', te: '10 నిమిషాల్లో రైలు' },
      shared: { role: 'host', mate: { name: 'Pavan', te: 'పవన్' }, mateDest: { name: 'Uppal' } },
    });
    expect(chips.map((c) => c.key)).toEqual(['terms', 'night', 'luggage', 'urgent', 'shared']);
    expect(chips[0].en).toBe('Fixed Rs 210');
    expect(chips[1].en).toBe('Night charge x1.25');
    expect(chips[2].en).toBe('Luggage +Rs 20');
    expect(chips[4].en).toContain('Pavan');
  });

  it('shows nothing about the price while it is still being talked about', () => {
    expect(rideChips({ terms: { mode: 'pending' }, modifiers: [] })).toEqual([]);
  });

  it('copes with a bare trip', () => {
    expect(rideChips({})).toEqual([]);
  });
});

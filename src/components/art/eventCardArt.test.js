import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LUCK_CARDS, DRAMA_CARDS } from '@shared/cards.js';
import { CARD_ART, EventCardArt } from './EventCardArt.jsx';
import { cardOf } from '../game/turn/CardReveal.jsx';

describe('illustrated event decks', () => {
  it('covers every engine card with a distinct illustration recipe', () => {
    const cards = [...LUCK_CARDS, ...DRAMA_CARDS];
    expect(Object.keys(CARD_ART).sort()).toEqual(cards.map(c => c.id).sort());
    expect(new Set(Object.values(CARD_ART).map(c => `${c.scene}:${c.prop}`)).size).toBe(cards.length);
    for (const card of cards) {
      const markup = renderToStaticMarkup(h(EventCardArt, { cardId: card.id, kind: card.kind }));
      expect(markup).toContain(`data-card-art="${card.id}"`);
      expect(markup).toContain('viewBox="0 0 320 192"');
      expect(markup).not.toContain('NaN');
    }
  });
  it('has a safe decorative fallback and a static rendering mode', () => {
    const markup = renderToStaticMarkup(h(EventCardArt, { cardId: 'future-card', animated: false, deck: 'drama' }));
    expect(markup).toContain('data-card-art="unknown"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('is-animated');
  });
  it('keeps the engine card ID and identity through normalization for replay and artwork selection', () => {
    const card = { ...LUCK_CARDS[0], cardId: LUCK_CARDS[0].id, player: 'me' };
    const normalized = cardOf({ card });
    expect(normalized.cardId).toBe('biryani_viral');
    expect(normalized.ref).toBe(card);
    expect(normalized.text).toBe(card.text);
    expect(cardOf({ card: null, bubble: { type: 'card', card } })).toBeNull();
    expect(cardOf({ bubble: { type: 'card', card } }).cardId).toBe('biryani_viral');
  });
});

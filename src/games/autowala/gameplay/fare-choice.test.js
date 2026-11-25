import { describe, expect, it } from 'vitest';
import { createChoices } from './fare-choice.js';

const fakeCtx = () => {
  const prompts = new Map();
  return { state: { menu: null }, fares: { uiMounted: false }, prompts, setPrompt: (id, text, key) => (text ? prompts.set(id, { text, key }) : prompts.delete(id)) };
};
const opts3 = [{ id: 'a', label: { en: 'A', te: 'ఎ' } }, { id: 'b', label: { en: 'B', te: 'బి' } }, { id: 'c', label: { en: 'C', te: 'సి' } }];

describe('fare choices', () => {
  it('picks an option by number and closes', () => {
    const ctx = fakeCtx();
    const c = createChoices(ctx);
    const picked = [];
    c.open({ id: 'q', kind: 'terms', title: { en: 'Q', te: 'ప్ర' }, options: opts3, seconds: 5, onPick: (id, i) => picked.push([id, i]) });
    expect(c.current.id).toBe('q');
    expect(c.choose(4)).toBe(false);
    expect(c.choose(2)).toBe(true);
    expect(picked).toEqual([['b', 1]]);
    expect(c.current).toBeNull();
    expect(c.choose(1)).toBe(false);
  });

  it('takes the default when time runs out, or just goes away without one', () => {
    const ctx = fakeCtx();
    const c = createChoices(ctx);
    const picked = [];
    const gone = [];
    c.open({ id: 'q', kind: 'terms', title: {}, options: opts3, seconds: 2, defaultId: 'c', onPick: (id) => picked.push(id) });
    c.update(1);
    expect(c.current).not.toBeNull();
    c.update(1.5);
    expect(picked).toEqual(['c']);
    expect(c.current).toBeNull();
    c.open({ id: 't', kind: 'talk', title: {}, options: opts3, seconds: 1, onPick: (id) => picked.push(id), onTimeout: () => gone.push('t') });
    c.update(2);
    expect(picked).toEqual(['c']);
    expect(gone).toEqual(['t']);
  });

  it('never answers while a menu is open, and a new question replaces the old one silently', () => {
    const ctx = fakeCtx();
    const c = createChoices(ctx);
    const picked = [];
    c.open({ id: 'one', kind: 'terms', title: {}, options: opts3, seconds: 5, onPick: () => picked.push('one') });
    ctx.state.menu = 'pause';
    expect(c.choose(1)).toBe(false);
    ctx.state.menu = null;
    c.open({ id: 'two', kind: 'counter', title: {}, options: opts3.slice(0, 2), seconds: 5, onPick: () => picked.push('two') });
    expect(c.choose(3)).toBe(false); // only two options
    expect(c.choose(1)).toBe(true);
    expect(picked).toEqual(['two']);
  });

  it('a pick may open the next question (a negotiation chain)', () => {
    const ctx = fakeCtx();
    const c = createChoices(ctx);
    c.open({ id: 'one', kind: 'terms', title: {}, options: opts3, seconds: 5, onPick: () => c.open({ id: 'two', kind: 'counter', title: {}, options: opts3, seconds: 5, onPick: () => {} }) });
    c.choose(1);
    expect(c.current.id).toBe('two');
  });

  it('shows the prompt chip only when the panel is not mounted, and clears it after', () => {
    const ctx = fakeCtx();
    const c = createChoices(ctx);
    c.open({ id: 'q', kind: 'terms', title: {}, options: opts3, seconds: 5, onPick: () => {} });
    c.update(0.1);
    expect(ctx.prompts.get('farechoice').text).toBe('1 A  ·  2 B  ·  3 C');
    ctx.fares.uiMounted = true;
    c.update(0.1);
    expect(ctx.prompts.has('farechoice')).toBe(false);
    ctx.fares.uiMounted = false;
    c.update(0.1);
    expect(ctx.prompts.has('farechoice')).toBe(true);
    c.choose(1);
    expect(ctx.prompts.has('farechoice')).toBe(false);
  });

  it('snapshots a plain view with 1-based option numbers and the time left', () => {
    const c = createChoices(fakeCtx());
    expect(c.snapshot()).toBeNull();
    c.open({ id: 'q', kind: 'talk', quiet: true, title: { en: 'Radio on?', te: 'రేడియో?' }, options: opts3.slice(0, 2), seconds: 7, onPick: () => {} });
    c.update(2);
    const s = c.snapshot();
    expect(s.options.map((o) => o.n)).toEqual([1, 2]);
    expect(s.timeLeft).toBe(5);
    expect(s.total).toBe(7);
    expect(s.quiet).toBe(true);
    expect(JSON.parse(JSON.stringify(s)).id).toBe('q');
  });
});

// Markup of the tour pieces (node environment: no DOM, so the portal itself is not rendered here).
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tour, TourInvite, TourLayer } from './Tour.jsx';
import TourHelpButton from './TourHelpButton.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const STEPS = [
  { id: 'a', title: 'Welcome to the table', body: 'Charminar awaits.' },
  { id: 'b', title: 'Second', body: 'Two.' },
  { id: 'c', target: '#nope', title: 'Gone', body: 'never shown' },
];

describe('<Tour> markup', () => {
  it('renders nothing when closed or without a DOM', () => {
    expect(html(h(Tour, { tourId: 't', steps: STEPS, open: false }))).toBe('');
    expect(html(h(Tour, { tourId: 't', steps: STEPS, open: true }))).toBe('');
  });

  it('a centred step is an accessible modal dialog with title, body, progress and Next / Skip', () => {
    const out = html(h(TourLayer, { tourId: 't', steps: STEPS, phone: false }));
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toMatch(/aria-describedby="[^"]+"/);
    expect(out).toContain('Welcome to the table');
    expect(out).toContain('Charminar awaits.');
    expect(out).toContain('Step 1 of 2'); // the step with a missing target is not counted
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('>Next<');
    expect(out).toContain('Skip tour');
    expect(out).not.toContain('>Back<'); // first step
    expect(out).not.toContain('tour-ring'); // no target: no spotlight
    expect(out).not.toContain('never shown');
  });

  it('renders nothing while paused', () => {
    expect(html(h(TourLayer, { tourId: 't', steps: STEPS, paused: true }))).toBe('');
  });

  it('the last step says Done', () => {
    const out = html(h(TourLayer, { tourId: 't', steps: [STEPS[0]] }));
    expect(out).toContain('>Done<');
  });

  it('labels can be replaced', () => {
    const out = html(h(TourLayer, { tourId: 't', steps: STEPS, labels: { next: 'Aage', skip: 'Chhodo' } }));
    expect(out).toContain('>Aage<');
    expect(out).toContain('Chhodo');
  });
});

describe('<TourInvite> / <TourHelpButton>', () => {
  it('the invite offers Start and Not now', () => {
    const out = html(h(TourInvite, {}));
    expect(out).toContain('New here?');
    expect(out).toContain('Start tour');
    expect(out).toContain('Not now');
  });
  it('the help button is a labelled button', () => {
    const out = html(h(TourHelpButton, { onClick() {} }));
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-label="Take the tour"');
    expect(out).toContain('>?<');
    expect(html(h(TourHelpButton, { showLabel: true, label: 'Tour' }))).toContain('>Tour<');
  });
});

describe('shortcut guard', () => {
  it('holdShortcuts puts the tour in the sheet stack (Space / Enter / S stand down) until released', async () => {
    const { hasOpenSheet, holdShortcuts } = await import('@/components/game/ui/Sheet.jsx');
    expect(hasOpenSheet()).toBe(false);
    const release = holdShortcuts({});
    expect(hasOpenSheet()).toBe(true);
    release();
    release(); // idempotent
    expect(hasOpenSheet()).toBe(false);
  });
});

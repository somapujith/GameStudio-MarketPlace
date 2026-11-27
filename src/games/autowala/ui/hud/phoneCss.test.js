// CSS-text tests for the phone / tablet HUD rules (no browser: they read the stylesheets as text). The pixel-level proof (no overlaps, nothing
// in the centre 40% / bottom 35%) is the screenshot + measurement run; these tests keep the contract from silently regressing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(dir, rel), 'utf8');
const phone = read('phone.css');
const minimap = read('../minimap.css');
const subtitles = read('../subtitles.css');
const toasts = read('toasts.css');
const radio = read('../radio.css');
const hud = read('../hud.css');
const land = read('land.css');
const root = read('../autowala.css');
const game = readFileSync(join(dir, '../../AutowalaGame.jsx'), 'utf8');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
/** Every `selector { body }` of a stylesheet (media blocks flattened), as [selectorText, bodyText]. */
function rules(css) {
  const out = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  const text = stripComments(css);
  while ((m = re.exec(text))) out.push([m[1].trim(), m[2]]);
  return out;
}
const bodyOf = (css, selector) => rules(css).filter(([s]) => s.split(',').map((x) => x.trim()).includes(selector)).map(([, b]) => b).join(';');
const px = (body, prop) => {
  const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)px`).exec(body);
  return m ? Number(m[1]) : null;
};
// the part of a shared stylesheet that was added for phones (everything after the marker comment)
const after = (css, marker) => css.slice(css.indexOf(marker));

describe('control-zone contract: read with fallbacks', () => {
  it('reads the three published variables', () => {
    for (const v of ['--aw-ctl-left-w', '--aw-ctl-right-w', '--aw-ctl-h']) expect(phone).toContain(`var(${v},`);
  });
  it('falls back to 30vw / 32vw / 38dvh in landscape, 30dvh in portrait, 0 on desktop', () => {
    expect(phone).toContain('var(--aw-ctl-left-w, 30vw)');
    expect(phone).toContain('var(--aw-ctl-right-w, 32vw)');
    expect(phone).toContain('var(--aw-ctl-h, 38dvh)');
    expect(phone).toContain('var(--aw-ctl-h, 30dvh)');
    // the base (no touch screen) fallback is 0px, and desktop never matches the compact selectors at all
    expect(phone).toContain('--hud-ctl-l: var(--aw-ctl-left-w, 0px)');
    expect(phone).toContain('--hud-ctl-h: var(--aw-ctl-h, 0px)');
    expect(phone).not.toMatch(/data-aw-layout=['"]desktop/);
  });
  it('the HUD never publishes the contract variables itself (the controls own them)', () => {
    for (const css of [phone, minimap, subtitles, toasts, radio]) expect(stripComments(css)).not.toMatch(/--aw-ctl-(left-w|right-w|h)\s*:/);
  });
  it('the minimap and the speedometer stay above the control height, the captions stay between the wheel and the pedals', () => {
    expect(bodyOf(minimap, '.aw[data-aw-layout$=\'-port\'] .aw-mm')).toContain('var(--hud-ctl-h)');
    expect(bodyOf(phone, '.aw[data-aw-layout$=\'-port\'] .aw-corner')).toContain('var(--hud-ctl-h)');
    const sub = bodyOf(subtitles, '.aw[data-aw-compact=\'1\'] .aw-sub');
    expect(sub).toContain('var(--hud-ctl-l)');
    expect(sub).toContain('var(--hud-ctl-r)');
    expect(phone).toContain('--hud-zone-b: calc(var(--hud-ctl-h)');
  });
});

describe('safe areas and dvh', () => {
  it('every edge is padded by env(safe-area-inset-*)', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) expect(phone).toContain(`env(safe-area-inset-${side}`);
  });
  it('heights use dvh, not vh', () => {
    expect(stripComments(phone)).toMatch(/\d+dvh/);
    expect(stripComments(phone)).not.toMatch(/\d\s*vh\b/);
    expect(bodyOf(phone, '.aw[data-aw-compact=\'1\'] .aw-sheet')).toContain('100dvh');
  });
});

describe('type sizes', () => {
  it('no text under 12px anywhere in the phone rules', () => {
    for (const css of [phone, after(minimap, '/* ---- phones and tablets'), after(subtitles, '/* ---- phones and tablets'), after(toasts, '/* ---- phones and tablets'), after(radio, '/* ---- inside the phone HUD')]) {
      for (const [sel, body] of rules(css)) {
        const m = /font-size:\s*([\d.]+)px/.exec(body);
        if (m) expect(Number(m[1]), `${sel} font-size`).toBeGreaterThanOrEqual(12);
      }
    }
  });
  it('body copy is at least 14px: trip line, toasts, prompt, captions, sheet text', () => {
    expect(px(bodyOf(phone, '.aw-ctrip__l2'), 'font-size')).toBeGreaterThanOrEqual(14);
    expect(px(bodyOf(phone, '.aw-cfind'), 'font-size')).toBeGreaterThanOrEqual(14);
    expect(px(bodyOf(toasts, '.aw[data-aw-compact=\'1\'] .aw-toast'), 'font-size')).toBeGreaterThanOrEqual(14);
    expect(px(bodyOf(phone, '.aw[data-aw-compact=\'1\'] .aw-prompt'), 'font-size')).toBeGreaterThanOrEqual(14);
    expect(px(bodyOf(subtitles, '.aw[data-aw-compact=\'1\'] .aw-sub .aw-sub-en'), 'font-size')).toBeGreaterThanOrEqual(14);
    expect(px(bodyOf(subtitles, '.aw[data-aw-compact=\'1\'] .aw-sub .aw-sub-te'), 'font-size')).toBeGreaterThanOrEqual(18);
    expect(px(bodyOf(phone, '.aw-sheet__quest p'), 'font-size')).toBeGreaterThanOrEqual(14);
  });
  it('the key numbers are at least 20px: wallet, clock, fare', () => {
    expect(px(bodyOf(phone, '.aw-cwallet__row b'), 'font-size')).toBeGreaterThanOrEqual(20);
    expect(px(bodyOf(phone, '.aw-cclock__time b'), 'font-size')).toBeGreaterThanOrEqual(20);
    expect(px(bodyOf(phone, '.aw-ctrip__fare b'), 'font-size')).toBeGreaterThanOrEqual(20);
  });
  it('the speed number is a big share of a dial that is at least 100px', () => {
    expect(bodyOf(phone, '.aw[data-aw-compact=\'1\'] .aw-sp-num')).toMatch(/calc\(var\(--sp-size\) \* 0\.3\d?\)/);
    expect(phone).toMatch(/--hud-sp: clamp\(104px, 36dvh, 150px\)/);
    expect(phone).toMatch(/--hud-sp: clamp\(124px, 38vw, 170px\)/);
  });
});

describe('the minimap is bigger than before and opens the full map', () => {
  it('uses the --hud-mm size (>= 104px, 34dvh landscape = 127..140px at 375..412px tall; the old landscape disc was 120px)', () => {
    expect(bodyOf(minimap, '.aw[data-aw-compact=\'1\'] .aw-mm')).toContain('--aw-mm-size: var(--hud-mm)');
    expect(land).toMatch(/--hud-mm: clamp\(92px, 30dvh, 128px\)/); // landscape phone: 108 px at 360 tall, 117 at 390, 128 from 427
    for (const h of [360, 390, 412]) expect(Math.min(128, Math.max(92, 0.3 * h))).toBeGreaterThanOrEqual(92);
    expect(land).toMatch(/tablet-land'\] \{[^}]*--hud-mm: clamp\(130px, 21dvh, 176px\)/s);
    expect(phone).toMatch(/--hud-mm: clamp\(112px, 34vw, 156px\)/);
    expect(phone).toContain('--hud-mm: 200px');
  });
  it('the whole disc is the tap target and a corner mark says so', () => {
    expect(bodyOf(minimap, '.aw .aw-mm-hit')).toContain('inset: 0');
    expect(bodyOf(minimap, '.aw[data-aw-compact=\'1\'] .aw-mm-expand')).toContain('width: 28px');
  });
});

describe('44px touch targets', () => {
  it('More, pause and the sheet close button are at least 44px', () => {
    for (const sel of ['.aw-more-btn,\n.aw-pausebtn--c']) {
      const b = rules(phone).find(([s, b0]) => s.includes('.aw-more-btn') && s.includes('.aw-pausebtn--c') && !s.includes(':') && /min-width/.test(b0));
      expect(b, sel).toBeTruthy();
      expect(px(b[1], 'min-width')).toBeGreaterThanOrEqual(44);
      expect(px(b[1], 'min-height')).toBeGreaterThanOrEqual(44);
    }
    expect(px(bodyOf(phone, '.aw-sheet__close'), 'width')).toBeGreaterThanOrEqual(44);
    expect(px(bodyOf(phone, '.aw-sheet__close'), 'height')).toBeGreaterThanOrEqual(44);
    expect(px(bodyOf(phone, '.aw-sheet .aw-job__chai'), 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px(bodyOf(phone, '.aw[data-aw-compact=\'1\'] .aw-prompt'), 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px(bodyOf(radio, '.aw .aw-radio--inline button'), 'width')).toBeGreaterThanOrEqual(44);
  });
  it('the sheet scrolls by touch (the game root sets touch-action: none)', () => {
    const sheet = bodyOf(phone, '.aw[data-aw-compact=\'1\'] .aw-sheet');
    expect(sheet).toContain('overflow-y: auto');
    expect(sheet).toContain('touch-action: pan-y');
  });
});

describe('prompts and the fare question never overlap', () => {
  it('both are anchored to the same zone above the controls, and the prompt steps aside while a question is open', () => {
    expect(bodyOf(phone, '.aw[data-aw-compact=\'1\'] .aw-prompt')).toContain('bottom: var(--hud-zone-b)');
    expect(bodyOf(phone, ".aw[data-aw-compact='1'] .aw-fare")).toContain('bottom: var(--hud-zone-b)');
    expect(bodyOf(phone, '.aw[data-aw-fare=\'1\'] .aw-prompt')).toContain('display: none');
  });
  it('the prompt can wrap (a long "Take X along (share the fare)") instead of running off the screen', () => {
    const b = bodyOf(phone, '.aw[data-aw-compact=\'1\'] .aw-prompt');
    expect(b).toContain('white-space: normal');
    expect(b).toContain('width: fit-content');
  });
});

describe('toasts: up to 3, never the old "newest only" rule', () => {
  it('older toasts stay visible on phones', () => {
    expect(bodyOf(toasts, '.aw[data-aw-compact=\'1\'] .aw-toast:not(:last-child)')).toContain('display: flex');
    // the old rule that hid every toast but the newest still exists for the desktop stylesheet only through its media query
    expect(toasts).toContain('.aw-toast:not(:last-child)');
  });
  it('portrait stacks under the alert lane, landscape under the alert lane (never over the road centre)', () => {
    expect(bodyOf(toasts, '.aw[data-aw-layout$=\'-port\'] .aw-toasts')).toContain('var(--hud-lane2-top)');
    expect(bodyOf(land, ".aw[data-aw-layout$='-land'] .aw-toasts")).toContain('var(--hud-lane-top)');
  });
});

describe('the phone rules cannot leak onto desktop', () => {
  it('every selector in phone.css is keyed on a data-aw attribute or on a class that only the compact HUD renders', () => {
    const compactOnly = ['.aw-strip', '.aw-cwallet', '.aw-cclock', '.aw-more-btn', '.aw-pausebtn--c', '.aw-ctrip', '.aw-cfind', '.aw-alert-chip', '.aw-sheet', '.aw-alerts'];
    for (const [sel] of rules(phone)) {
      for (const part of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (/^(from|to|\d+%)$/.test(part)) continue; // keyframe steps
        const ok = part.startsWith('.aw[data-aw-') || compactOnly.some((c) => part.startsWith(c));
        expect(ok, `phone.css selector "${part}"`).toBe(true);
      }
    }
  });
  it('the additions to the shared stylesheets are all keyed on the compact attribute', () => {
    for (const [css, marker] of [[minimap, '/* ---- phones and tablets'], [subtitles, '/* ---- phones and tablets'], [toasts, '/* ---- phones and tablets']]) {
      for (const [sel] of rules(after(css, marker))) {
        for (const part of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
          if (/^(from|to|\d+%)$/.test(part)) continue;
          expect(part.startsWith('.aw[data-aw-') || part.startsWith('.aw .aw-mm-expand'), `selector "${part}"`).toBe(true);
        }
      }
    }
  });
  it('the desktop HUD stylesheet still carries its original phone-less defaults', () => {
    expect(bodyOf(hud, '.aw-hud-tl')).toContain('top: 14px');
    expect(bodyOf(hud, '.aw-corner')).toContain('right: 18px');
    expect(bodyOf(hud, '.aw-sp')).toContain('--sp-size: 196px');
  });
});


describe('the landscape HUD (hud/land.css)', () => {
  it('loads after every other HUD stylesheet so it wins at equal specificity', () => {
    const order = [...game.matchAll(/import '([^']+\.css)'/g)].map((m) => m[1]);
    expect(order[order.length - 1]).toBe('./ui/hud/land.css');
  });
  it('the strip is 44 px on a phone, 52 on a tablet; its buttons are at least 44 px', () => {
    expect(bodyOf(land, ".aw[data-aw-layout$='-land']")).toContain('--hud-strip-h: 44px');
    expect(bodyOf(land, ".aw[data-aw-layout='tablet-land']")).toContain('--hud-strip-h: 52px');
    const btn = bodyOf(land, ".aw[data-aw-layout$='-land'] .aw-more-btn");
    expect(px(btn, 'min-width')).toBeGreaterThanOrEqual(44);
    expect(px(btn, 'min-height')).toBeGreaterThanOrEqual(44);
    expect(land).toContain('grid-template-columns: auto minmax(0, 1fr) auto 44px 44px');
  });
  it('the speedometer is the bottom-centre pod, clear of the thumbs, and never sits on the road ahead', () => {
    const corner = bodyOf(land, ".aw[data-aw-layout$='-land'] .aw-corner");
    expect(corner).toContain('left: 50%');
    expect(corner).toContain('bottom: var(--hud-pod-b)');
    expect(land).toContain('.aw-sp--pod');
  });
  it('the minimap hangs under the strip on the left, toasts and alerts have their own lanes', () => {
    const mm = bodyOf(land, ".aw[data-aw-layout$='-land'] .aw-mm");
    expect(mm).toContain('top: var(--hud-lane-top)');
    expect(mm).toContain('left: var(--hud-x-l)');
    expect(bodyOf(land, ".aw[data-aw-layout$='-land'] .aw-toasts")).toContain('right: var(--hud-x-r)');
    expect(bodyOf(land, ".aw[data-aw-layout$='-land'] .aw-alerts")).toContain('left: 50%');
  });
  it('captions and the tutorial card never use a transform to centre (their entrance animations own it)', () => {
    expect(bodyOf(land, ".aw[data-aw-compact='1'][data-aw-layout$='-land'] .aw-sub")).not.toContain('transform');
    expect(bodyOf(land, ".aw[data-aw-layout$='-land'] .aw-quest-coach")).not.toContain('transform');
  });
  it('the More sheet shortcuts are 44 px targets', () => {
    expect(px(bodyOf(land, '.aw-sheet__key'), 'min-height')).toBeGreaterThanOrEqual(44);
  });
});

describe('the HUD scale zoom', () => {
  it('every in-game overlay root zooms by --aw-ui-scale, and the variable has a fallback of 1', () => {
    expect(root).toContain('--aw-ui-scale: 1');
    for (const sel of ['.aw-hud', '.aw-mm', '.aw-toasts', '.aw-sub', '.aw-fare', '.aw-quest-coach', '.aw-quest-tracker', '.aw-quest-result']) expect(root).toContain(`${sel},`.replace(/,$/, ''));
    expect(root).toContain('zoom: var(--aw-ui-scale)');
  });
});

describe('the HUD is cheap over a live WebGL canvas', () => {
  const sheets = { hud, phone, land, minimap, subtitles, toasts, radio, rules: read('rules.css'), fares: read('../fares/fares.css'), quests: read('../quests/quests.css'), touch: read('../touch.css'), career: read('../career/career.css') };
  it('no backdrop-filter, no blur, no mix-blend-mode, no filter animations', () => {
    for (const [name, css] of Object.entries(sheets)) {
      const text = stripComments(css);
      expect(text, `${name}: backdrop-filter`).not.toMatch(/backdrop-filter/);
      expect(text, `${name}: blur()`).not.toMatch(/blur\(/);
      expect(text, `${name}: mix-blend-mode`).not.toMatch(/mix-blend-mode/);
    }
  });
  it('no keyframes animate box-shadow, filter or layout properties', () => {
    for (const [name, css] of Object.entries(sheets)) {
      const text = stripComments(css);
      for (const m of text.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})+)\s*\}/g)) {
        expect(m[2], `${name}: @keyframes ${m[1]}`).not.toMatch(/box-shadow|filter\s*:|(width|height|top|left|right|bottom|margin|padding)\s*:/);
      }
    }
  });
  it('the wheel has a static shadow, not a drop-shadow filter that re-runs while it turns', () => {
    expect(bodyOf(sheets.touch, '.aw .aw-ct-wheel')).not.toContain('filter');
    expect(bodyOf(sheets.touch, '.aw .aw-ct-wheel')).toContain('box-shadow');
  });
});

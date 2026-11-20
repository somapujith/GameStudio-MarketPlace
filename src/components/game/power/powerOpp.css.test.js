// styles/power-opp.css: every animation is a one-shot (no loops), uses transform / opacity only, and is gated for reduced motion and perf-low.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const raw = readFileSync(fileURLToPath(new URL('../../../styles/power-opp.css', import.meta.url)), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
const open = css.slice(0, at);
const gates = css.slice(at);

/** `selector { declarations }` pairs of a stretch of CSS without at-rule wrappers or keyframe bodies. */
function rules(text) {
  const flat = text.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]+\{/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
}

describe('power-opp.css', () => {
  it('has the gates after the rules and no infinite loop anywhere', () => {
    expect(at).toBeGreaterThan(0);
    expect(css).not.toMatch(/infinite/);
  });

  it('every ungated animation selector is switched off or softened in all three gates', () => {
    const animated = rules(open).filter((r) => /animation\s*:/.test(r.body) && !/animation\s*:\s*none/.test(r.body));
    expect(animated.length).toBeGreaterThan(0);
    const reduceBlock = gates.slice(0, gates.indexOf(':root[data-motion'));
    const motionLines = gates.split('\n').filter((l) => l.includes("[data-motion='reduced']")).join('\n');
    const perfLines = gates.split('\n').filter((l) => l.includes("[data-perf='low']")).join('\n');
    for (const { sel } of animated) {
      for (const one of sel.split(',').map((x) => x.trim())) {
        for (const [name, block] of [['prefers-reduced-motion', reduceBlock], ['data-motion', motionLines], ['data-perf', perfLines]]) {
          expect(block, `${one} in ${name}`).toContain(one);
        }
      }
    }
  });

  it('animates only transform / opacity / translate / scale in keyframes', () => {
    const frames = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
    expect(frames.length).toBeGreaterThanOrEqual(4);
    for (const [, name, body] of frames) {
      const props = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(['transform', 'opacity', 'translate', 'scale'], `${name}: ${p}`).toContain(p);
    }
  });

  it('never uses transition: all and uses the app motion tokens', () => {
    expect(css).not.toMatch(/transition\s*:\s*all/);
    expect(css).toMatch(/var\(--dur-[1-4]\)/);
    expect(css).toMatch(/var\(--ease-out\)/);
  });

  it('the face-down count only ticks after a change (the class is added by the component, never in the base rules)', () => {
    for (const r of rules(open).filter((x) => /animation\s*:/.test(x.body))) expect(r.sel, r.sel).toMatch(/is-ticked|is-gone/);
  });
});

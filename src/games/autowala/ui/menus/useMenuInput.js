// Keyboard + gamepad navigation for the full-screen menus. While a menu is open the keys never reach the game (so Enter does not
// "interact" and W does not drive); navigation uses real DOM focus on elements marked `data-nav`, so mouse, touch, keyboard, gamepad
// and screen readers all agree on what is selected.
//   Up / Down / W / S   move        Left / Right / A / D   adjust a slider row      Enter / Space   select (native click)
//   Esc                 back (the menu decides what that means)        P   resume (pause menu only)
//   Gamepad: D-pad / left stick move, A select, B back, Start resume / start
import { useEffect, useRef } from 'react';
import { padEdges } from './menuNav.js';
import { blip } from './settings.js';

/** Row elements register an adjust(dir) function here (sliders, cyclers). */
export const ADJUST = new WeakMap();

const items = (root) => (root ? [...root.querySelectorAll('[data-nav]')].filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null) : []);

export function focusFirst(root, preferred) {
  const list = items(root);
  const el = (preferred && list.find((x) => x.matches(preferred))) || list[0];
  if (el) el.focus({ preventScroll: true });
}

export function useMenuInput(rootRef, { active, onBack, onResume, onStart }) {
  const cb = useRef({ onBack, onResume, onStart });
  cb.current = { onBack, onResume, onStart };

  useEffect(() => {
    if (!active) return undefined;
    const root = () => rootRef.current;
    const move = (dir) => {
      const list = items(root());
      if (!list.length) return;
      const cur = list.indexOf(document.activeElement);
      const next = cur < 0 ? (dir < 0 ? list.length - 1 : 0) : (cur + (dir < 0 ? -1 : 1) + list.length) % list.length;
      list[next].focus({ preventScroll: true });
      blip('move');
    };
    const adjust = (dir) => {
      const fn = ADJUST.get(document.activeElement);
      if (fn) fn(dir);
    };
    const onKey = (e) => {
      if (!root()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      e.stopPropagation(); // the game's own key handler is on window (bubble): it never sees these
      if (k === 'tab') return;
      if (k === 'arrowup' || k === 'w') { e.preventDefault(); move(-1); return; }
      if (k === 'arrowdown' || k === 's') { e.preventDefault(); move(1); return; }
      if (k === 'arrowleft' || k === 'a') { e.preventDefault(); adjust(-1); return; }
      if (k === 'arrowright' || k === 'd') { e.preventDefault(); adjust(1); return; }
      if (k === 'escape') { if (!e.repeat) { blip('back'); cb.current.onBack?.(); } return; }
      if (k === 'p') { if (!e.repeat) cb.current.onResume?.(); return; }
      if (k === 'enter' || k === ' ' || k === 'spacebar') {
        const el = document.activeElement;
        if (el && root().contains(el) && el.hasAttribute('data-nav')) {
          if (!e.repeat) blip('ok');
          if (el.getAttribute('role') === 'slider') e.preventDefault();
        } else {
          e.preventDefault();
          if (!e.repeat) focusFirst(root());
        }
      }
    };
    window.addEventListener('keydown', onKey, true);

    let raf = 0;
    let held = null;
    let primed = false;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const pad = pads && [...pads].find(Boolean);
      if (!pad) { held = null; primed = false; return; }
      const r = padEdges(held, pad);
      held = r.held;
      if (!primed) { primed = true; return; } // a button that was already down when the menu opened does not count
      if (r.up) move(-1);
      else if (r.down) move(1);
      if (r.left) adjust(-1);
      if (r.right) adjust(1);
      if (r.select) {
        const el = document.activeElement;
        if (el && root() && root().contains(el) && el.hasAttribute('data-nav')) { blip('ok'); el.click(); } else focusFirst(root());
      }
      if (r.back) { blip('back'); cb.current.onBack?.(); }
      if (r.start) (cb.current.onResume || cb.current.onStart)?.();
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
    };
  }, [active, rootRef]);
}

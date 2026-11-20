// Keeps the layout aware of the on-screen keyboard (iOS Safari and Chrome Android both leave the layout viewport
// alone and only shrink the *visual* viewport, so fixed bottom sheets and tab bars end up under the keyboard).
//
//   installViewportSync()      once at boot (main.jsx); returns a cleanup. A safe no-op without visualViewport.
//
// It publishes, on <html>:
//   --kb-inset   px the keyboard covers at the bottom of the layout viewport (0 when closed)
//   --vvh        px height of the visible area (the visual viewport)
//   data-kb      present while the keyboard is open (CSS hides the tab bar / install card, lifts sheets)
// and scrolls a focused text field into view when the keyboard would cover it.

/** Keyboard height from the two viewports. Pinch-zoom (scale > 1) shrinks the visual viewport too: ignore it. */
export function keyboardInset({ innerHeight = 0, height = 0, offsetTop = 0, scale = 1 } = {}) {
  if (!(Number(scale) <= 1.01)) return 0;
  const inset = Math.round(Number(innerHeight) - Number(height) - Math.max(0, Number(offsetTop) || 0));
  return inset >= 100 ? inset : 0; // anything smaller is browser chrome (URL bar), not a keyboard
}

/** Is a box (client rect) at least partly outside the visible area `{ offsetTop, height }`? */
export function isObscured(rect, { offsetTop = 0, height = 0 } = {}, margin = 8) {
  if (!rect) return false;
  return rect.bottom > offsetTop + height - margin || rect.top < offsetTop + margin;
}

const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number', '']);

/** An element that raises the on-screen keyboard. */
export function isTextField(el) {
  if (!el || !el.tagName) return false;
  const tag = String(el.tagName).toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') return TEXT_TYPES.has(String(el.type || '').toLowerCase());
  return !!el.isContentEditable;
}

export function installViewportSync(win = typeof window !== 'undefined' ? window : undefined) {
  const doc = win && win.document;
  const vv = win && win.visualViewport;
  if (!doc || !vv) return () => {};
  const root = doc.documentElement;
  let frame = 0;
  let settle = 0;
  let last = -1;

  const apply = () => {
    frame = 0;
    const kb = keyboardInset({ innerHeight: win.innerHeight, height: vv.height, offsetTop: vv.offsetTop, scale: vv.scale });
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    if (kb === last) return;
    last = kb;
    root.style.setProperty('--kb-inset', `${kb}px`);
    if (kb > 0) root.setAttribute('data-kb', '');
    else root.removeAttribute('data-kb');
  };
  const schedule = () => {
    if (frame) return;
    frame = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(apply) : (apply(), 0);
  };

  const reveal = () => {
    const el = doc.activeElement;
    if (!isTextField(el)) return;
    if (isObscured(el.getBoundingClientRect(), { offsetTop: vv.offsetTop, height: vv.height })) {
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch {
        /* old engines: the browser's own scrolling has to do */
      }
    }
  };
  const onFocusIn = (e) => {
    if (!isTextField(e.target)) return;
    clearTimeout(settle);
    settle = setTimeout(reveal, 350); // after the keyboard animation has finished
  };
  const onFocusOut = () => {
    clearTimeout(settle);
    // iOS can leave the page panned after the keyboard closes: put the visual viewport back.
    settle = setTimeout(() => {
      if (!isTextField(doc.activeElement) && vv.offsetTop > 1 && vv.scale <= 1.01) win.scrollTo(win.scrollX, win.scrollY);
    }, 160);
  };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  vv.addEventListener('resize', reveal);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  apply();
  return () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    vv.removeEventListener('resize', reveal);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
    clearTimeout(settle);
    if (frame && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame);
    root.style.removeProperty('--kb-inset');
    root.style.removeProperty('--vvh');
    root.removeAttribute('data-kb');
  };
}

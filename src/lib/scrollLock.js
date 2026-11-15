// Body scroll lock for modals and sheets that works on iOS Safari too.
//
// `body { overflow: hidden }` alone does not stop the page behind a sheet from scrolling on iOS (older versions
// ignore it, newer ones still rubber-band). The robust version pins the body with `position: fixed` at the current
// scroll offset and puts the offset back on release. Locks are reference counted, so stacked overlays (a confirm
// dialog opened from a sheet) release the page only when the last one closes.
//
//   const release = lockScroll();   ...   release();           // plain functions
//   useScrollLock(open);                                        // React hook (src/lib/useScrollLock.js)
//
// `createScrollLock({ win, doc })` is the pure core (the tests drive it with fakes).

const LOCK_ATTR = 'data-scroll-locked';

export function createScrollLock({ win, doc } = {}) {
  let count = 0;
  let saved = null;

  const lock = () => {
    if (!win || !doc || !doc.body) return () => {};
    count += 1;
    if (count === 1) {
      const body = doc.body;
      const root = doc.documentElement;
      const y = Math.max(0, Number(win.scrollY ?? win.pageYOffset) || 0);
      const x = Math.max(0, Number(win.scrollX ?? win.pageXOffset) || 0);
      // A desktop scrollbar disappearing would shift the layout: keep its width as padding.
      const bar = Math.max(0, (Number(win.innerWidth) || 0) - (Number(root.clientWidth) || 0));
      saved = {
        x,
        y,
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        paddingRight: body.style.paddingRight,
        scrollBehavior: root.style.scrollBehavior,
      };
      body.style.position = 'fixed';
      body.style.top = `-${y}px`;
      body.style.left = `-${x}px`;
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      if (bar > 0) body.style.paddingRight = `${bar}px`;
      root.setAttribute(LOCK_ATTR, '');
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      count = Math.max(0, count - 1);
      if (count === 0 && saved) {
        const body = doc.body;
        const root = doc.documentElement;
        const s = saved;
        saved = null;
        body.style.position = s.position;
        body.style.top = s.top;
        body.style.left = s.left;
        body.style.right = s.right;
        body.style.width = s.width;
        body.style.overflow = s.overflow;
        body.style.paddingRight = s.paddingRight;
        root.removeAttribute(LOCK_ATTR);
        // `html { scroll-behavior: smooth }` would animate the restore: jump instead.
        root.style.scrollBehavior = 'auto';
        win.scrollTo(s.x, s.y);
        root.style.scrollBehavior = s.scrollBehavior;
      }
    };
  };

  return { lock, count: () => count };
}

const shared = createScrollLock({
  win: typeof window !== 'undefined' ? window : undefined,
  doc: typeof document !== 'undefined' ? document : undefined,
});

/** Lock page scroll; returns the release function (idempotent). A no-op without a DOM. */
export const lockScroll = () => shared.lock();
export const scrollLockCount = () => shared.count();

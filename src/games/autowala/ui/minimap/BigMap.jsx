// OWNER: minimap agent. The full-screen city map: north-up, drag to pan, wheel / pinch to zoom, every customer and landmark labelled,
// the route shown, click a customer to route there (ctx.fares.select(id)), Esc closes. It pauses nothing; the translucent panel dims the HUD.
import { useEffect, useRef } from 'react';
import { getCityMap } from './cityMap.js';
import { drawMap, readLive, newLive, hitCustomer } from './draw.js';
import { makeView, newView, bigMapScaleRange, zoomAbout } from './mapMath.js';

export default function BigMap({ game, onClose }) {
  const wrap = useRef(null);
  const canvasRef = useRef(null);
  const closeBtn = useRef(null);
  const api = useRef({});
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const ctx = game?.ctx;
    const city = ctx?.world?.city;
    const canvas = canvasRef.current;
    const box = wrap.current;
    if (!ctx || !city || !canvas || !box) return undefined;
    const g = canvas.getContext('2d');
    const live = newLive();
    const view = newView();
    const st = { x: 0, z: 0, scale: 1 };
    const o = { city, cityMap: getCityMap(city), view, live, w: 0, h: 0, dpr: 1, t: 0, mode: 'big', cx: 0, cy: 0, radius: 0, selectedId: null };
    let range = bigMapScaleRange(1280, 720, city.half);
    const clampCenter = () => {
      st.x = Math.max(-city.half, Math.min(city.half, st.x));
      st.z = Math.max(-city.half, Math.min(city.half, st.z));
    };
    const fit = () => {
      const r = box.getBoundingClientRect();
      o.w = Math.max(2, Math.round(r.width));
      o.h = Math.max(2, Math.round(r.height));
      o.dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(o.w * o.dpr);
      canvas.height = Math.round(o.h * o.dpr);
      range = bigMapScaleRange(o.w, o.h, city.half);
      st.scale = Math.max(range.min, Math.min(range.max, st.scale));
    };
    readLive(ctx, live);
    st.x = live.x;
    st.z = live.z;
    fit();
    st.scale = range.start;

    const recenter = () => {
      readLive(ctx, live);
      st.x = live.x;
      st.z = live.z;
      st.scale = range.start;
    };
    const zoomBy = (f) => zoomAbout(st, f, o.w / 2, o.h / 2, o.w / 2, o.h / 2, range.min, range.max);
    api.current = { recenter, zoomBy };

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(box);

    // ---- pointer: drag to pan, two fingers to pinch, a still click on a customer selects it
    const pointers = new Map();
    let moved = 0;
    let pinch = 0;
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e) => {
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* a synthetic or already-released pointer: dragging still works without capture */
      }
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        canvas.style.cursor = hitCustomer(view, live, p.x, p.y, 18) ? 'pointer' : 'grab';
        return;
      }
      if (pointers.size === 1) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        moved += Math.abs(dx) + Math.abs(dy);
        st.x -= dx / st.scale;
        st.z -= dy / st.scale;
        clampCenter();
      } else if (pointers.size === 2) {
        pointers.set(e.pointerId, p);
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) zoomAbout(st, d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2, o.w / 2, o.h / 2, range.min, range.max);
        pinch = d;
        moved += 10;
      }
      pointers.set(e.pointerId, p);
    };
    const up = (e) => {
      const p = local(e);
      const had = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      pinch = 0;
      if (had && pointers.size === 0 && moved < 7 && e.type === 'pointerup') {
        const hit = hitCustomer(view, live, p.x, p.y, 20);
        if (hit && typeof ctx.fares?.select === 'function') {
          try {
            ctx.fares.select(hit.id);
          } catch (err) {
            console.warn('[autowala] select failed', err);
          }
        }
      }
    };
    const wheel = (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAbout(st, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y, o.w / 2, o.h / 2, range.min, range.max);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });

    // ---- keyboard: Esc closes (and must not also open the pause menu), +/- zoom, 0 recentres
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current?.();
      } else if (e.key === '+' || e.key === '=') zoomBy(1.3);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.3);
      else if (e.key === '0') recenter();
    };
    window.addEventListener('keydown', key, true);

    let raf = 0;
    let last = performance.now();
    let clock = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      if (document.hidden) return;
      try {
        readLive(ctx, live);
        o.t = clock;
        o.selectedId = live.target?.type === 'pickup' ? live.target.id : null;
        makeView(view, st.x, st.z, Math.PI, st.scale, o.w / 2, o.h / 2);
        drawMap(g, o);
      } catch (err) {
        if (!frame.warned) {
          frame.warned = true;
          console.warn('[autowala] big map frame skipped', err);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    closeBtn.current?.focus?.();
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('keydown', key, true);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [game]);

  return (
    <div className="aw-bigmap" role="dialog" aria-modal="true" aria-label="City map" ref={wrap}>
      <canvas ref={canvasRef} className="aw-bigmap-canvas" />
      <div className="aw-bigmap-title">
        <b>HYDERABAD</b>
        <span>City map</span>
      </div>
      <div className="aw-bigmap-tools">
        <button type="button" aria-label="Zoom in" onClick={() => api.current.zoomBy?.(1.4)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => api.current.zoomBy?.(1 / 1.4)}>&minus;</button>
        <button type="button" aria-label="Centre on my auto" onClick={() => api.current.recenter?.()}>&#9678;</button>
        <button type="button" className="is-close" ref={closeBtn} aria-label="Close map" onClick={() => onCloseRef.current?.()}>&times;</button>
      </div>
      <div className="aw-bigmap-legend" aria-hidden="true">
        <span><i className="d-pink" />Customer</span>
        <span><i className="d-green" />Drop-off</span>
        <span><i className="d-route" />Route</span>
        <span className="aw-bigmap-hint">Drag to pan &middot; scroll or pinch to zoom &middot; click a customer to route there &middot; Esc to close</span>
      </div>
    </div>
  );
}

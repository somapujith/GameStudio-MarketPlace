// Arrow chips at the screen edges for customers you are not looking at (left, right, or behind you). Each shows the TOKEN number and
// the dishes still wanted, coloured by urgency like the patience ring (green / amber / red), and flashes while a paying customer is
// about to walk off. Tap one to turn your head to that customer. Positions come from the shared per-frame projection.
import { useRef } from 'react';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { useFrame } from './hooks.js';
import { activeCustomers, chitUrgency, needsOf, tokenOf } from './hudLogic.js';
import { CHIP_H, CHIP_W, layoutEdgeChips } from './offscreen.js';

const SIDE_WORD = { left: 'on your left', right: 'on your right', behind: 'behind you' };

/** The free rectangle between the HUD bands, in the HUD's own coordinates (the chips must not sit on the banner or the dock). */
export function freeBounds(root, w, h) {
  const out = { top: 0, bottom: h, left: 0, right: w };
  if (!root) return out;
  const box = root.getBoundingClientRect();
  const rect = (sel) => {
    const el = root.querySelector(sel);
    const r = el?.getBoundingClientRect();
    return r && r.height > 0 && r.width > 0 ? { top: r.top - box.top, bottom: r.bottom - box.top, left: r.left - box.left, right: r.right - box.left, width: r.width } : null;
  };
  const top = rect('.tc-hud-top');
  if (top) out.top = Math.max(out.top, top.bottom);
  const board = rect('.tc-hud-board'); // phone portrait: the chalk board is a full-width band under the banner
  if (board && board.width >= w * 0.6) out.top = Math.max(out.top, board.bottom);
  const bottom = rect('.tc-hud-bottom');
  if (bottom) out.bottom = Math.min(out.bottom, bottom.top);
  const rail = rect('.tc-hud-railbox'); // a bottom strip of chits (phones) takes room; a side rail takes a column
  if (rail && rail.width >= w * 0.6) out.bottom = Math.min(out.bottom, rail.top);
  else if (rail && rail.left < w * 0.5) out.left = Math.max(out.left, rail.right);
  if (out.bottom - out.top < CHIP_H * 2) {
    out.top = 0;
    out.bottom = h;
  }
  return out;
}

export default function EdgeIndicators({ scene, state, projector, rootRef, getCookX, spotXOf, onLook, reduced }) {
  const els = useRef(new Map());
  const bounds = useRef({ top: 0, bottom: 0, left: 0, right: 0, at: 0 });
  const register = (id, el) => {
    if (el) els.current.set(id, { el, last: '' });
    else els.current.delete(id);
  };
  useFrame((t, frac, st) => {
    if (!projector || !scene?.project || !st) return;
    const map = projector.frame(t, scene, st.customers, { cookX: getCookX?.() ?? 0, spotXOf });
    const w = projector.size.w || (typeof window !== 'undefined' ? window.innerWidth : 0);
    const h = projector.size.h || (typeof window !== 'undefined' ? window.innerHeight : 0);
    const b = bounds.current;
    if (t - b.at > 400 || !b.right) {
      Object.assign(b, freeBounds(rootRef?.current, w, h), { at: t });
    }
    const items = [];
    for (const [id, rec] of els.current) {
      const hit = map.get(id);
      if (hit && !hit.on && hit.edge) items.push({ id, side: hit.edge.side, x: hit.edge.x, y: hit.edge.y });
      else if (rec.last !== 'off') {
        rec.last = 'off';
        rec.el.dataset.hidden = '1';
      }
    }
    for (const it of layoutEdgeChips(items, b)) {
      const rec = els.current.get(it.id);
      if (!rec) continue;
      const c = (st.customers || []).find((x) => x.id === it.id);
      const u = c ? chitUrgency(c, st, frac) : { tone: 'ok', flash: false };
      const key = `${Math.round(it.x)},${Math.round(it.y)},${it.side},${u.tone},${u.flash}`;
      if (key === rec.last) continue;
      rec.last = key;
      rec.el.dataset.hidden = '0';
      rec.el.dataset.side = it.side;
      rec.el.dataset.tone = u.tone;
      rec.el.dataset.flash = u.flash && !reduced ? '1' : '0';
      rec.el.style.transform = `translate3d(${Math.round(it.x - CHIP_W / 2)}px, ${Math.round(it.y - CHIP_H / 2)}px, 0)`;
    }
  });
  const list = activeCustomers(state);
  return (
    <div className="tc-hud-edges" aria-hidden="true">
      {list.map((c) => (
        <button key={c.id} type="button" tabIndex={-1} ref={(el) => register(c.id, el)} className="tc-hud-edge" data-hidden="1" data-tone="ok" onClick={() => onLook(c.id)}>
          <HudIcon name="chevR" size={18} className="tc-hud-edge-arrow" />
          <span className="tc-hud-edge-token">
            <small>TOKEN</small>
            <b>{tokenOf(c)}</b>
          </span>
          <span className="tc-hud-edge-dishes">
            {needsOf(c).slice(0, 2).map((d, i) => (
              <DishIcon key={i} dish={d} size={18} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

export const edgeLabel = (c, side) => `Token ${tokenOf(c)} is ${SIDE_WORD[side] || 'out of view'}`;

// OWNER: minimap agent. GTA-style round minimap (bottom-left) with the player, the customers, the drop-off and the route, plus a
// full-screen map on M / tap. Props: { game, snap }. Per-frame data comes straight from game.ctx in this component's own
// requestAnimationFrame (never from the snapshot); the snapshot is only used for `snap.menu` (pause drawing while a menu is up).
import { useCallback, useEffect, useRef, useState } from 'react';
import { nearestRoad, districtAt } from '../world/layout.js';
import { angleDiff } from '../game/rng.js';
import { getCityMap } from './minimap/cityMap.js';
import { drawMap, readLive, newLive } from './minimap/draw.js';
import { makeView, newView, zoomForSpeed, formatDistance, formatEta, TURN_GLYPH } from './minimap/mapMath.js';
import BigMap from './minimap/BigMap.jsx';
import { ExpandIcon } from './hud/icons.jsx';
import './minimap.css';

const KIND_LABEL = { pickup: 'PICK-UP', dropoff: 'DROP-OFF', debug: 'TARGET' };

export default function Minimap({ game, snap }) {
  const [open, setOpen] = useState(false);
  const menu = snap?.menu || null;
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const openRef = useRef(false);
  openRef.current = open;
  const discRef = useRef(null);
  const canvasRef = useRef(null);
  const pillRef = useRef(null);
  const kindRef = useRef(null);
  const turnRef = useRef(null);
  const distRef = useRef(null);
  const streetRef = useRef(null);
  const toggleBtn = useRef(null);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  // a menu (workshop, pause, start...) closes the big map
  useEffect(() => {
    if (menu) setOpen(false);
  }, [menu]);

  useEffect(() => {
    const ctx = game?.ctx;
    const city = ctx?.world?.city;
    const disc = discRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !city || !disc || !canvas) return undefined;
    const g = canvas.getContext('2d');
    if (!g) return undefined;

    const live = newLive();
    const view = newView();
    const o = { city, cityMap: null, view, live, w: 0, h: 0, dpr: 1, t: 0, mode: 'mini', cx: 0, cy: 0, radius: 0, selectedId: null };
    let size = 0;
    let dpr = 0;
    const fit = () => {
      size = Math.round(disc.clientWidth) || 200;
      dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      o.w = o.h = size;
      o.cx = o.cy = size / 2;
      o.radius = size / 2;
      o.dpr = dpr;
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(disc);

    let heading = null;
    let scale = zoomForSpeed(0);
    let last = performance.now();
    let clock = 0;
    let textT = 99;
    let streetT = 99;
    let streetX = 1e9;
    let streetZ = 1e9;
    let lastStreet = '';
    let lastPill = '';
    let raf = 0;

    const setText = (el, s) => {
      if (el && el.textContent !== s) el.textContent = s;
    };

    const updateStreet = () => {
      const r = nearestRoad(city, live.x, live.z);
      const d = districtAt(live.x, live.z);
      const onRoad = r && r.dist <= r.edge.w / 2 + 10;
      const label = onRoad && r.edge.name ? `${r.edge.name}  ·  ${d.name}` : d.name;
      if (label !== lastStreet) {
        lastStreet = label;
        setText(streetRef.current, label);
      }
    };

    const updatePill = () => {
      const pill = pillRef.current;
      if (!pill) return;
      const t = live.target;
      if (!t) {
        if (lastPill !== '') {
          lastPill = '';
          pill.hidden = true;
        }
        return;
      }
      const turn = live.nextTurn === 'uturn'
        ? `${TURN_GLYPH.uturn} U-turn`
        : live.nextTurn && live.nextTurn !== 'straight' && live.turnDistance < 500 ? `${TURN_GLYPH[live.nextTurn] || ''} ${formatDistance(live.turnDistance)}` : '';
      const dist = live.hasRoute ? `${formatDistance(live.remaining)} · ${formatEta(live.eta)}` : '';
      const kind = KIND_LABEL[t.type] || 'TARGET';
      const key = `${kind}|${turn}|${dist}|${t.type}`;
      if (key === lastPill) return;
      lastPill = key;
      pill.hidden = false;
      pill.dataset.kind = t.type || '';
      setText(kindRef.current, kind);
      setText(turnRef.current, turn);
      setText(distRef.current, dist);
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      clock += dt;
      // M toggles the big map (poll the one-shot; menus ignore it)
      if (ctx.input?.pressed?.('map') && !menuRef.current) toggleRef.current();
      if (document.hidden || menuRef.current || openRef.current) return;
      try {
        readLive(ctx, live);
        heading = heading === null ? live.heading : heading + angleDiff(heading, live.heading) * (1 - Math.exp(-14 * dt));
        scale += (zoomForSpeed(live.speed) - scale) * (1 - Math.exp(-2.4 * dt));
        if (Math.min(2.5, window.devicePixelRatio || 1) !== dpr) fit(); // zoomed the page / moved to another screen
        if (!o.cityMap) o.cityMap = getCityMap(city);
        o.t = clock;
        o.selectedId = live.target?.type === 'pickup' ? live.target.id : null;
        makeView(view, live.x, live.z, heading, scale, o.cx, o.cy);
        drawMap(g, o);
        textT += dt;
        streetT += dt;
        if (textT > 0.2) {
          textT = 0;
          updatePill();
        }
        if (streetT > 0.4 && Math.hypot(live.x - streetX, live.z - streetZ) > 2.5) {
          streetT = 0;
          streetX = live.x;
          streetZ = live.z;
          updateStreet();
        }
      } catch (err) {
        // a bad frame (a half-built fares object...) must never break the game; show what we can next frame
        if (!frame.warned) {
          frame.warned = true;
          console.warn('[autowala] minimap frame skipped', err);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [game]);

  if (!game) return null;
  return (
    <>
      <div className={`aw-mm${menu ? ' is-hidden' : ''}${open ? ' is-covered' : ''}`}>
        <div className="aw-mm-disc" ref={discRef}>
          <canvas ref={canvasRef} className="aw-mm-canvas" aria-hidden="true" />
          <button
            ref={toggleBtn}
            type="button"
            className="aw-mm-hit"
            aria-label="Open city map"
            aria-keyshortcuts="M"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={toggle}
          />
          <span className="aw-mm-key" aria-hidden="true">M</span>
          <span className="aw-mm-expand" aria-hidden="true"><ExpandIcon size={14} /></span>
        </div>
        <div className="aw-mm-pill" ref={pillRef} hidden aria-hidden="true">
          <span className="aw-mm-pill-kind" ref={kindRef} />
          <span className="aw-mm-pill-turn" ref={turnRef} />
          <span className="aw-mm-pill-dist" ref={distRef} />
        </div>
        <div className="aw-mm-street" ref={streetRef} aria-hidden="true" />
      </div>
      {open && !menu && <BigMap game={game} onClose={() => { setOpen(false); toggleBtn.current?.focus?.(); }} />}
    </>
  );
}

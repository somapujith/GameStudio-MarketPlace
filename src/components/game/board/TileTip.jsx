import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS, TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { PieceToken } from '../Pawn.jsx';
import { eventMark } from '../Tile.jsx';
import { eventFlagFor } from './eventFlag.js';
import { tipAnchor, tipLifetime, tipModel, tipPlacement } from './tipModel.js';

const NONE = [];
const OPEN_DELAY = 320; // a mouse resting on a tile; moving between tiles while a card is open switches instantly

/**
 * The hover / keyboard-focus card for a board tile: name, collection, price, who owns it, rent now and the
 * whole rent ladder. A child of `.hb-grid`, it listens to its parent (so the Board never re-renders for a hover),
 * ignores touch (the tile tap opens the property sheet) and never takes pointer events.
 */
export const TileTipLayer = memo(function TileTipLayer({ players = NONE, owners = NONE, levels = NONE, mortgaged = NONE, rentPct = 100, salary, event = null, resetKey = '' }) {
  const ref = useRef(null);
  const [id, setId] = useState(null);
  const open = useRef(null);
  open.current = id;

  // a new turn / phase clears whatever card a resting cursor left behind
  useEffect(() => {
    setId(null);
  }, [resetKey]);

  useEffect(() => {
    const grid = ref.current?.parentElement;
    if (!grid) return undefined;
    let timer = 0;
    let idle = 0;
    let source = 'mouse';
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => setId(null), tipLifetime(source));
    };
    const idOf = (e) => {
      const el = e.target?.closest?.('[data-tile]');
      return el && grid.contains(el) ? Number(el.dataset.tile) : null;
    };
    const hide = () => {
      clearTimeout(timer);
      clearTimeout(idle);
      setId(null);
    };
    const show = (tid, delay) => {
      clearTimeout(timer);
      if (tid == null) return hide();
      if (tid === open.current) return undefined;
      if (delay <= 0) {
        setId(tid);
        arm();
      } else {
        timer = setTimeout(() => {
          setId(tid);
          arm();
        }, delay);
      }
      return undefined;
    };
    const onOver = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const tid = idOf(e);
      source = 'mouse';
      if (tid == null) hide();
      else show(tid, open.current != null ? 0 : OPEN_DELAY);
    };
    const onMove = (e) => {
      if (open.current != null && (!e.pointerType || e.pointerType === 'mouse' || e.pointerType === 'pen')) arm();
    };
    const onFocus = (e) => {
      const tid = idOf(e);
      let kbd = false;
      try {
        kbd = !!e.target.matches?.(':focus-visible');
      } catch {
        kbd = false;
      }
      if (tid != null && kbd) {
        source = 'kbd';
        show(tid, 0);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') hide();
    };
    // anything outside the board (the Roll button, a sheet, the page) also dismisses; so does leaving the tab or scrolling
    const onDocDown = (e) => {
      if (!grid.contains(e.target)) hide();
    };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('pagehide', hide);
    grid.addEventListener('pointermove', onMove);
    grid.addEventListener('pointercancel', hide);
    grid.addEventListener('touchend', hide);
    grid.addEventListener('pointerover', onOver);
    grid.addEventListener('pointerleave', hide);
    grid.addEventListener('pointerdown', hide);
    grid.addEventListener('focusin', onFocus);
    grid.addEventListener('focusout', hide);
    grid.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      clearTimeout(idle);
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('pagehide', hide);
      grid.removeEventListener('pointermove', onMove);
      grid.removeEventListener('pointercancel', hide);
      grid.removeEventListener('touchend', hide);
      grid.removeEventListener('pointerover', onOver);
      grid.removeEventListener('pointerleave', hide);
      grid.removeEventListener('pointerdown', hide);
      grid.removeEventListener('focusin', onFocus);
      grid.removeEventListener('focusout', hide);
      grid.removeEventListener('keydown', onKey);
    };
  }, []);

  const tile = id != null ? TILES[id] : null;
  const model = useMemo(() => {
    if (!tile) return null;
    const ownerId = owners[tile.id];
    const p = ownerId != null ? players.find((x) => x.id === ownerId) : null;
    let setFull = false;
    if (p && tile.group) {
      const ids = GROUPS[tile.group]?.tiles || NONE;
      setFull = ids.length > 0 && ids.every((t) => owners[t] === ownerId);
    }
    const stuck = players.filter((x) => !x.bankrupt && x.stuck && x.pos === tile.id).length;
    return {
      model: tipModel(tile, { owner: p ? { name: p.name, color: p.color, piece: p.piece } : null, level: levels[tile.id] || 0, mortgaged: !!mortgaged[tile.id], setFull, rentPct, salary, stuck, event: eventMark(event, tile), flag: eventFlagFor(event, tile) }),
      owner: p,
    };
  }, [tile, players, owners, levels, mortgaged, rentPct, salary, event]);

  const m = model?.model;
  const a = tile ? tipAnchor(tile.id) : null;
  return (
    <div ref={ref} className="hb-tipwrap" aria-hidden="true">
      {m && a ? (
        <div className={`hb-tip hb-tip--${tipPlacement(tile.id)}`} style={{ '--tx': a.x, '--ty': a.y, '--tc': m.color }} data-tone={m.tone} key={tile.id}>
          <div className="hb-tip__card">
            <header className="hb-tip__head">
              <b className="hb-tip__title">{m.title}</b>
              {m.kicker ? <span className="hb-tip__kicker">{m.kicker}</span> : null}
            </header>
            {m.status ? (
              <span className="hb-tip__status">
                {model.owner && m.tone !== 'sale' ? <PieceToken piece={model.owner.piece} color={model.owner.color} size={16} base={false} className="hb-tip__piece" /> : null}
                {m.status}
              </span>
            ) : null}
            {m.rows.length ? (
              <dl className="hb-tip__rows">
                {m.rows.map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {m.ladder ? (
              <ol className="hb-tip__ladder">
                {m.ladder.map((l, i) => (
                  <li key={i} className={l.current ? 'is-now' : undefined}>
                    <span>{l.name}</span>
                    <b>{formatINR(l.rent)}</b>
                  </li>
                ))}
              </ol>
            ) : null}
            {m.foot ? <p className="hb-tip__foot">{m.foot}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

export default TileTipLayer;

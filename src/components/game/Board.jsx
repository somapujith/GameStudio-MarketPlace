import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import * as shared from '@shared/index.js';
import { GRID, GROUPS, TILES, tilePosition } from '@shared/board.js';
import Tile, { eventMark } from './Tile.jsx';
import Pawn from './Pawn.jsx';
import CameraFocus from './fx/CameraFocus.jsx';
import { oddsSupported, useOddsPref } from './oddsPref.js';
import '@/styles/board.css';
import '@/styles/fx.css';

const NONE = [];
const NO_DISPLAY = {};

// ---- landing odds overlay ---------------------------------------------------
// `landingOdds` / `previewRent` are looked up by name so a build without them still works (the overlay simply
// stays hidden). The on/off preference lives in oddsPref.js: the control panel renders the button.
const ODDS_FN = 'landingOdds';
const RENT_FN = 'previewRent';
const MIN_CHIP = 0.005; // below 0.5% a tile gets no chip

/** cool (blue) to hot (red) */
const oddsHue = (t) => Math.round(215 * (1 - Math.max(0, Math.min(1, t))));

function computeOdds(view, me) {
  try {
    const fn = shared[ODDS_FN];
    if (typeof fn !== 'function' || !view || me == null) return null;
    const probs = fn(view, me, { previewRent: shared[RENT_FN] });
    if (!probs || typeof probs.length !== 'number') return null;
    let total = 0;
    let max = 0;
    const list = TILES.map((t) => {
      const p = Number(probs[t.id]) || 0;
      total += p;
      if (p > max) max = p;
      return p;
    });
    const top = new Set(
      list
        .map((p, id) => [p, id])
        .filter(([p]) => p >= MIN_CHIP)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 3)
        .map(([, id]) => id),
    );
    return { list, total, max, top };
  } catch {
    return null; // never let a stats helper take the board down
  }
}

/** groupId -> tile ids (from GROUPS[id].tiles when the engine provides it). */
const GROUP_IDS = Object.fromEntries(
  Object.keys(GROUPS).map((g) => [g, Array.isArray(GROUPS[g].tiles) ? GROUPS[g].tiles : TILES.filter((t) => t.group === g).map((t) => t.id)]),
);

/** What fills the middle until a control panel is passed in: a night skyline with the Charminar. */
const CenterBrand = memo(function CenterBrand() {
  return (
    <div className="hb-center__brand" aria-hidden="true">
      <svg className="hb-center__sky" viewBox="0 0 200 90" preserveAspectRatio="xMidYMax meet" focusable="false">
        <path d="M0 90V70h14V58h10v12h8V50h12v20h6V62h9v28zM146 90V60h10v-8h12v14h8V48h10v42z" />
        <path d="M84 90V54h4V30l-2-4h6l-2 4v24h20V30l-2-4h6l-2 4v24h4v36h-8V70a8 8 0 0 0-16 0v20z" />
        <path d="M96 54v-8a4 4 0 0 1 8 0v8z" />
      </svg>
      <div className="hb-center__banner">
        <span>Hyderabad</span>
        <b>Hustle</b>
      </div>
    </div>
  );
});

const pct = (p) => (p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);

/** Translucent probability chips over every tile (pointer-events: none, so taps still reach the tiles). */
const OddsLayer = memo(function OddsLayer({ odds }) {
  return (
    <div className="hb-odds" aria-hidden="true">
      {TILES.map((tile) => {
        const p = odds.list[tile.id];
        const { col, row } = tilePosition(tile.id);
        const shown = p >= MIN_CHIP;
        const t = odds.max > 0 ? p / odds.max : 0;
        return (
          <span
            key={tile.id}
            className={`hb-odds__cell${shown ? ' has-chip' : ''}${odds.top.has(tile.id) ? ' is-top' : ''}`}
            style={{ gridColumn: col + 1, gridRow: row + 1, '--h': oddsHue(t) }}
          >
            {shown && <span className="hb-odds__chip">{pct(p)}</span>}
          </span>
        );
      })}
    </div>
  );
});

/**
 * The square city circuit: the engine's tiles on a GRID x GRID ring (Hustle: 36 on 10x10, corners 1.5x an edge
 * track), the (GRID-2)^2 middle for the control panel, and the pawn layer. All sizes are container-query units of
 * this component's own width, so the parent only decides how wide it is (`--hb-u` = one edge tile).
 *
 * <Board session onTileClick={(tileId) => …} highlightTile={tileId|null}>{centre}</Board>
 * (`center={node}` still works.) The centre carries `data-fx-bank` (money flights to / from the bank end there),
 * every tile `data-fx-tile`, every pawn `data-fx-pawn`.
 *
 * Reads from `session`: display (players with pos/piece/stuck/chai/motion, owners, levels, mortgaged, turn, stepMs,
 * landing), view.event (live city event), card + stageTile (card shimmer). The whole board sits inside the phone camera
 * (fx/CameraFocus.jsx), which reads the session itself.
 */
export function Board({ session, onTileClick, highlightTile = null, center = null, children }) {
  const d = session?.display || session?.view || NO_DISPLAY;
  const players = d.players || NONE;
  const owners = d.owners || NONE;
  const levels = d.levels || NONE;
  const mortgaged = d.mortgaged || NONE;

  // Stable tile callback: tiles are memoised, so an inline onTileClick must not re-render them all.
  const clickRef = useRef(onTileClick);
  useEffect(() => {
    clickRef.current = onTileClick;
  });
  const onSelect = useCallback((id) => clickRef.current?.(id), []);

  const turnPlayer = players[d.turn];
  const activeTile = turnPlayer && !turnPlayer.bankrupt ? turnPlayer.pos : -1;
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  // city event: public state, read from the latest view (the presenter's display can lag a little)
  const cityEvent = session?.view?.event || null;

  // stuck players per tile, chai tokens in play (Chai Adda steams when the count rises)
  const stuckAt = new Map();
  let chaiTotal = 0;
  for (const p of players) {
    if (p.bankrupt) continue;
    if (p.stuck) stuckAt.set(p.pos, (stuckAt.get(p.pos) || 0) + 1);
    chaiTotal += Number(p.chai) || 0;
  }

  // the tile a card is being drawn from (while the presenter shows the card)
  const drawingTile = session?.card ? session?.stageTile : null;

  // ---- odds: computed only while the toggle is on and it is my moment to roll
  const [oddsOn] = useOddsPref();
  const view = session?.view;
  const me = session?.me;
  const canRoll = !!session?.options?.roll;
  const myPos = view?.players?.find?.((p) => p.id === me)?.pos;
  const oddsActive = oddsOn && canRoll && oddsSupported();
  const odds = useMemo(
    () => (oddsActive ? computeOdds(view, me) : null),
    // memoised per turn / position / phase (view itself changes on every presenter step)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oddsActive, view?.turn, view?.turnCount, myPos, view?.phase, me],
  );

  const salary = Number(d.cfg?.passStart) > 0 ? Number(d.cfg.passStart) : undefined;

  const tiles = TILES.map((tile) => {
    const ownerId = owners[tile.id];
    const owner = ownerId != null ? byId.get(ownerId) : null;
    let setState = 'none';
    if (owner && tile.group) {
      const ids = GROUP_IDS[tile.group] || NONE;
      if (ids.length && ids.every((t) => owners[t] === ownerId)) setState = 'full';
    }
    return (
      <Tile
        key={tile.id}
        tile={tile}
        ownerColor={owner ? owner.color : null}
        ownerName={owner ? owner.name : ''}
        ownerId={owner ? owner.id : null}
        ownerPiece={owner ? owner.piece || null : null}
        level={owner ? levels[tile.id] || 0 : 0}
        setState={setState}
        mortgaged={!!(owner && mortgaged[tile.id])}
        event={eventMark(cityEvent, tile)}
        highlight={highlightTile === tile.id}
        active={activeTile === tile.id}
        stuck={tile.type === 'traffic' ? stuckAt.get(tile.id) || 0 : 0}
        chai={tile.type === 'chai' ? chaiTotal : 0}
        drawing={drawingTile === tile.id && tile.type === 'card'}
        salary={tile.type === 'start' ? salary : undefined}
        onSelect={onSelect}
      />
    );
  });

  // Pawns sharing a tile fan out by their order in the players list.
  const crowd = new Map();
  players.forEach((p) => {
    if (p.bankrupt) return;
    const list = crowd.get(p.pos) || [];
    list.push(p.id);
    crowd.set(p.pos, list);
  });

  const stepMs = Math.max(60, Math.round(session?.display?.stepMs ?? 260));
  const middle = children ?? center ?? <CenterBrand />;

  return (
    <div className={`hb-board${odds ? ' has-odds' : ''}`} style={{ '--hb-n': GRID - 2 }}>
      <CameraFocus session={session}>
        <div className="hb-frame">
          <span className="hb-frame__lights" aria-hidden="true" />
          <div className="hb-grid">
            {tiles}
            <div className="hb-center" data-fx-bank="">
              {middle}
            </div>
            {odds && <OddsLayer odds={odds} />}
            <div className="hb-pawns" style={{ '--hb-step': `${stepMs}ms` }}>
              {players.map((p, i) => {
                const mates = crowd.get(p.pos) || NONE;
                return (
                  <Pawn
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    color={p.color}
                    piece={p.piece}
                    pos={p.pos}
                    slot={Math.max(0, mates.indexOf(p.id))}
                    count={mates.length || 1}
                    isTurn={i === d.turn && d.phase !== 'over'}
                    stuck={!!p.stuck}
                    motion={p.motion || null}
                    bankrupt={!!p.bankrupt}
                    tileName={TILES[p.pos]?.name}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </CameraFocus>
    </div>
  );
}

export default Board;

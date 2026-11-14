// The Manage tab of the control panel: all 8 collections of 3 as compact rows. Each row shows who owns which
// district (dots in the owners' colours), how many are mine, the full-set bonus, and under it my districts with
// their business level pips, rent and the actions session.options allows for that tile
// (Upgrade to <next> / Sell <current> / Mortgage / Unmortgage).
import '@/styles/sheets.css';
import { TILES } from '@shared/board.js';
import { compactINR, formatINR } from '@shared/format.js';
import Button from './ui/Button.jsx';
import { LevelPips, SetDots } from './ui/TileChip.jsx';
import {
  MAX_LEVEL, SET_BONUS_MULT, SET_GROUPS, canUpgradeSafe, diceSum, levelNameOf, mortgageOf, previewRentSafe, unmortgageOf,
  upgradeCostOf, useStateLike,
} from './ui/helpers.js';

const X = '×';

/** Business level as pips (kept under its old name for callers of the Manage tab). */
export function BuildPips({ level = 0, tile = null }) {
  return <LevelPips level={level} tile={tile} />;
}

export default function MyProperties({ session, onOpenTile }) {
  const state = useStateLike(session);
  const me = session.me;
  const o = session.options || {};
  const index = (list) => new Map((list || []).map((u) => [u.tile, u]));
  const build = index(o.upgrade);
  const sell = index(o.sellBuilding);
  const mort = index(o.mortgage);
  const unmort = index(o.unmortgage);
  const sum = diceSum(session);
  const off = !!session.busy;
  const ownerOf = (t) => (state.owners?.[t] ? state.players.find((p) => p.id === state.owners[t]) : null);
  const act = (type, tile) => () => session.dispatch({ type, tile });
  const mineCount = TILES.filter((t) => state.owners?.[t.id] === me).length;

  return (
    <div className="hg-mp">
      {mineCount === 0 ? (
        <div className="hg-mp-empty">
          <b>No properties yet.</b>
          <span>Land on a free district and buy it to start your empire.</span>
        </div>
      ) : null}
      <ul className="hg-mp-sets">
        {SET_GROUPS.map((set) => {
          const mine = set.tiles.filter((t) => state.owners?.[t] === me);
          const full = mine.length === set.tiles.length;
          const colors = set.tiles.map((t) => ownerOf(t)?.color || null);
          return (
            <li key={set.id} className={`hg-mp-set${mine.length ? ' is-mine' : ''}${full ? ' is-full' : ''}`} style={{ '--sc': set.color }}>
              <header className="hg-mp-head">
                <i className="hg-mp-chip" />
                <b className="hg-mp-name">{set.name}</b>
                <SetDots owned={mine.length} total={set.tiles.length} color={set.color} colors={colors} />
                <span className="hg-mp-count">{mine.length}/{set.tiles.length}</span>
                {full ? <span className="hg-mp-tag is-full">Full set {X}{SET_BONUS_MULT}</span> : null}
              </header>
              {mine.length ? (
                <ul className="hg-mp-props">
                  {mine.map((id) => {
                    const tile = TILES[id];
                    const level = state.levels?.[id] || 0;
                    const mortgaged = !!state.mortgaged?.[id];
                    const b = build.get(id);
                    const s = sell.get(id);
                    const m = mort.get(id);
                    const u = unmort.get(id);
                    const any = b || s || m || u;
                    let why = '';
                    if (!any) {
                      if (mortgaged) why = 'Lift the mortgage on your turn';
                      else if (level >= MAX_LEVEL) why = 'Top business';
                      else {
                        const c = canUpgradeSafe(session.view, me, id);
                        why = c && !c.ok && c.reason ? c.reason : off ? 'Wait…' : 'Upgrade on your turn';
                      }
                    }
                    return (
                      <li key={id} className={`hg-mp-prop${mortgaged ? ' is-mort' : ''}`}>
                        <button type="button" className="hg-mp-main" onClick={() => onOpenTile?.(id)}>
                          <span className="hg-mp-pname">
                            {tile.name}
                            {mortgaged ? <em className="hg-mp-flag">Mortgaged</em> : null}
                          </span>
                          <small className="hg-mp-meta">
                            <LevelPips level={level} color={set.color} tile={tile} owned={!mortgaged} />
                            <span>{mortgaged ? 'no rent' : `${levelNameOf(tile, level)} · rent ${compactINR(previewRentSafe(state, id, sum))}`}</span>
                          </small>
                        </button>
                        {any ? (
                          <div className="hg-mp-acts">
                            {b ? (
                              <Button
                                variant="gold"
                                size="sm"
                                disabled={off}
                                onClick={act('UPGRADE', id)}
                                aria-label={`Upgrade ${tile.name} to ${levelNameOf(tile, level + 1)} for ${formatINR(b.cost ?? upgradeCostOf(tile))}`}
                              >
                                Upgrade {formatINR(b.cost ?? upgradeCostOf(tile))}
                              </Button>
                            ) : null}
                            {s ? (
                              <Button
                                variant="dark"
                                size="sm"
                                disabled={off}
                                onClick={act('SELL_BUILDING', id)}
                                aria-label={`Sell the ${levelNameOf(tile, level)} on ${tile.name} for ${formatINR(s.refund ?? 0)}`}
                              >
                                Sell +{formatINR(s.refund ?? Math.round(upgradeCostOf(tile) / 2))}
                              </Button>
                            ) : null}
                            {m ? (
                              <Button variant="dark" size="sm" disabled={off} onClick={act('MORTGAGE', id)}>
                                Mortgage +{formatINR(m.value ?? mortgageOf(tile))}
                              </Button>
                            ) : null}
                            {u ? (
                              <Button variant="green" size="sm" disabled={off} onClick={act('UNMORTGAGE', id)}>
                                Unmortgage {formatINR(u.cost ?? unmortgageOf(tile))}
                              </Button>
                            ) : null}
                          </div>
                        ) : why ? (
                          <p className="hg-mp-why">{why}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

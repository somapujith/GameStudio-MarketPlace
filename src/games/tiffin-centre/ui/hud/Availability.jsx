// The chalk-board availability strip: one chip per dish on today's menu with how many are ready, cooking (soonest ETA), held, and
// how many customers still want it. Amber = more wanted than is on the way, red pulse = someone is about to walk off for it,
// grey = no free slot and nothing ready. Tapping a chip walks you to the best station for that dish.
// Operations layer: a dish the shelf cannot make says "Out of dosa batter" and offers "Mark sold out"; a dish off the board is struck through.
import DishIcon from './DishIcon.jsx';
import { availabilityLabel, chipTone, dishInfo } from './hudLogic.js';

// `children` is the stall status strip (events, gas, stock bars): it renders above the chips inside the same chalk board.
// `board` is boardMap(state) (dish -> { on, short:{item,name}|null }), `onBoard(dish, on)` flips a dish on or off the board.
export default function Availability({ rows, onChip, children, board = null, onBoard }) {
  if (!rows.length && !children) return null;
  return (
    <section className="tc-hud-board" aria-label="Dish availability">
      {children}
      <ul className="tc-hud-chips">
        {rows.map((r) => {
          const d = dishInfo(r.dish);
          const tone = chipTone(r);
          const b = board?.get(r.dish);
          const off = b ? b.on === false : false;
          const out = b && b.on !== false ? b.short : null;
          const note = off ? '. Sold out: nobody will order it' : out ? `. Out of ${out.name.toLowerCase()}` : '';
          return (
            <li key={r.dish} className={`tc-hud-chipli${off ? ' is-off' : ''}`}>
              <button
                type="button"
                className={`tc-hud-chip${off ? ' is-off' : ''}`}
                data-tone={tone}
                data-dish={r.dish}
                data-short={out ? out.item : undefined}
                aria-label={`${availabilityLabel(r)}${note}`}
                aria-disabled={tone === 'blocked' ? 'true' : undefined}
                onClick={() => onChip(r.dish)}
              >
                <DishIcon dish={r.dish} size={30} />
                <span className="tc-hud-chip-name">
                  <span className="tc-hud-en">{d.name}</span>
                  <span className="tc-hud-te">{d.te}</span>
                </span>
                <span className="tc-hud-ready" data-n={r.ready}>
                  <b>{r.ready}</b>
                  <small>ready</small>
                </span>
                <span className="tc-hud-chip-meta">
                  {off && <span className="tc-hud-soldout">Sold out</span>}
                  {out && <span className="tc-hud-noslot tc-hud-outof">{`Out of ${out.name.toLowerCase()}`}</span>}
                  {r.cooking > 0 && <span className="tc-hud-cooking">{`${r.cooking} cooking ${r.eta ?? 0}s`}</span>}
                  {r.held > 0 && <span className="tc-hud-held">{`${r.held} in hand`}</span>}
                  {r.demand > 0 && <span className="tc-hud-need">{`needs ${r.demand}`}</span>}
                  {tone === 'blocked' && <span className="tc-hud-noslot">No free slot</span>}
                  {tone === 'urgent' && <span className="tc-hud-noslot">Hurry!</span>}
                </span>
              </button>
              {onBoard && (off || out) && (
                <button
                  type="button"
                  className="tc-hud-chip-board"
                  aria-label={off ? `Put ${d.name} back on the board` : `Mark ${d.name} sold out`}
                  onClick={() => onBoard(r.dish, off)}
                >
                  {off ? 'Back on board' : 'Mark sold out'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

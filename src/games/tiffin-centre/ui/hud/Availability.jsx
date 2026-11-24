// The chalk-board availability strip: one chip per dish on today's menu with how many are ready, cooking (soonest ETA), held, and
// how many customers still want it. Amber = more wanted than is on the way, red pulse = someone is about to walk off for it,
// grey = no free slot and nothing ready. Tapping a chip walks you to the best station for that dish.
import DishIcon from './DishIcon.jsx';
import { availabilityLabel, chipTone, dishInfo } from './hudLogic.js';

export default function Availability({ rows, onChip }) {
  if (!rows.length) return null;
  return (
    <section className="tc-hud-board" aria-label="Dish availability">
      <ul className="tc-hud-chips">
        {rows.map((r) => {
          const d = dishInfo(r.dish);
          const tone = chipTone(r);
          return (
            <li key={r.dish}>
              <button
                type="button"
                className="tc-hud-chip"
                data-tone={tone}
                data-dish={r.dish}
                aria-label={availabilityLabel(r)}
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
                  {r.cooking > 0 && <span className="tc-hud-cooking">{`${r.cooking} cooking ${r.eta ?? 0}s`}</span>}
                  {r.held > 0 && <span className="tc-hud-held">{`${r.held} in hand`}</span>}
                  {r.demand > 0 && <span className="tc-hud-need">{`needs ${r.demand}`}</span>}
                  {tone === 'blocked' && <span className="tc-hud-noslot">No free slot</span>}
                  {tone === 'urgent' && <span className="tc-hud-noslot">Hurry!</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

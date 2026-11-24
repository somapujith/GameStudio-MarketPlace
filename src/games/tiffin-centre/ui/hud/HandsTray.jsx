// Your two hands: dish chips with a quality star row, tap to select (the selected hand serves first), plus the discard bin.
import { HANDS_MAX } from '@shared/tiffin-centre/catalog.js';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { dishInfo, effectiveHand, qualityView } from './hudLogic.js';

export default function HandsTray({ hands, selectedHand, spot, walking, onSelect, onTrash }) {
  const sel = effectiveHand(hands, selectedHand);
  return (
    <div className={`tc-hud-hands${spot.has('hands') ? ' is-spot' : ''}`} data-spot="hands" role="group" aria-label="Your hands">
      {Array.from({ length: HANDS_MAX }, (_, i) => {
        const h = hands[i];
        if (!h) {
          return (
            <button key={i} type="button" className="tc-hud-hand is-empty" disabled aria-label={`Hand ${i + 1}: empty`}>
              <span className="tc-hud-hand-empty">Empty</span>
            </button>
          );
        }
        const d = dishInfo(h.dish);
        const q = qualityView(h.q);
        return (
          <button
            key={i}
            type="button"
            className={`tc-hud-hand${sel === i ? ' is-selected' : ''}`}
            aria-pressed={sel === i}
            aria-label={`Hand ${i + 1}: ${d.name}, ${q.label.toLowerCase()} quality${sel === i ? ', selected' : ''}`}
            onClick={() => onSelect(i)}
          >
            <DishIcon dish={h.dish} size={34} />
            <span className="tc-hud-hand-name">
              <span className="tc-hud-en">{d.name}</span>
              <span className="tc-hud-te">{d.te}</span>
            </span>
            <span className="tc-hud-qstars" aria-hidden="true" data-q={h.q}>
              {[1, 2, 3].map((n) => (
                <HudIcon key={n} name="star" size={11} className={n <= q.stars ? 'is-on' : 'is-off'} />
              ))}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className={`tc-hud-trash${spot.has('bin') ? ' is-spot' : ''}${walking.has('bin') ? ' is-walking' : ''}`}
        data-spot="bin"
        onClick={onTrash}
        disabled={sel < 0}
        aria-label={sel < 0 ? 'Throw away: nothing in hand' : 'Throw away the selected dish'}
      >
        <HudIcon name="trash" size={22} />
      </button>
    </div>
  );
}

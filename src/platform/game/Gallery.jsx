// The gallery of a game page, as a cine row of wide 16:9 cards built from the game's own art: the painted cover (or the
// manifest's SVG cover), a close-up crop of it, and the icon on its colours. Each card is a captioned figure; the row
// scrolls sideways (hover arrows, Left / Right when it has focus).
import { CineRow } from '@/platform/home/CineRow.jsx';
import { ArtFill } from '@/platform/browse/GameArt.jsx';
import { themeVars } from './color.js';
import { galleryItems } from './detailModel.js';

function Shot({ game, item }) {
  if (item.kind === 'board') {
    const Icon = game?.art?.icon;
    return (
      <span className="cj-detail-shot cj-detail-shot--icon" style={themeVars(game?.theme)} aria-hidden="true">
        {Icon ? <Icon size={132} /> : <span className="cj-detail-shot__ph">{String(game?.name || '?').slice(0, 1)}</span>}
      </span>
    );
  }
  if (item.kind === 'image') {
    return (
      <span className="cj-detail-shot cj-detail-shot--img" aria-hidden="true">
        <img src={item.src} alt="" loading="lazy" decoding="async" draggable="false" style={{ '--origin': item.origin, '--zoom': item.zoom }} />
      </span>
    );
  }
  return (
    <span className={`cj-detail-shot ${item.kind === 'scene' ? 'cj-detail-shot--zoom' : ''}`} style={{ '--origin': item.origin }} aria-hidden="true">
      <ArtFill game={game} />
    </span>
  );
}

export default function Gallery({ game }) {
  const items = galleryItems(game);
  const count = items.length;
  if (!count) return null;
  return (
    <CineRow label={`${game.name} gallery`} count={count} className="cj-detail-gallery">
      {items.map((item, i) => (
        <li key={i}>
          <figure className="cj-wide cj-detail-galleryitem">
            <Shot game={game} item={item} />
            <figcaption className="cj-wide__label">
              {item.caption || `${game.name}, image ${i + 1}`}
              <small>
                {i + 1} of {count}
              </small>
            </figcaption>
          </figure>
        </li>
      ))}
    </CineRow>
  );
}

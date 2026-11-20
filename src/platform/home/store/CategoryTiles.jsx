import { Link } from 'react-router-dom';
import { browseHref } from '@/platform/browse/filters.js';
import { CatIcon } from '../GameArt.jsx';
import { themeVars } from '../gameTheme.js';
import { allGames, categoryList } from '../catalog.js';
import { categoryTiles as buildTiles } from './categoryModel.js';

/** Tiles for the live catalogue. */
export const categoryTiles = (games = allGames(), cats = categoryList()) => buildTiles(games, cats);


function countLine(t) {
  const bits = [];
  if (t.live) bits.push(`${t.live} to play`);
  if (t.soon) bits.push(`${t.soon} soon`);
  return bits.join(' · ');
}

/** "By category": a tile per category, each linking to the catalogue filtered to it. */
export default function CategoryTiles({ tiles }) {
  return (
    <ul className="sh-cats">
      {tiles.map((t) => (
        <li key={t.id}>
          <Link to={browseHref({ cat: t.id })} className="sh-cat" style={themeVars(t.lead)} data-live={t.live > 0 ? 'true' : 'false'}>
            <span className="sh-cat__ico">
              <CatIcon cat={t} size={26} />
            </span>
            <span className="sh-cat__txt">
              <b>{t.label}</b>
              <small>{countLine(t)}</small>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

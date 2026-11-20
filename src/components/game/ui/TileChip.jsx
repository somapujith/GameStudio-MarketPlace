// Little tile chips, business-level pips and collection dots, used by the sheets and the Manage tab.
import { TILES } from '@shared/board.js';
import { MAX_LEVEL, levelNameOf, tileAccent } from './helpers.js';

/**
 * Business level as pips: one per level (Hustle: 3). An owned district always runs its first business, so
 * `level` 0 lights one pip; `owned={false}` lights none.
 */
export function LevelPips({ level = 0, color, tile = null, owned = true }) {
  const lit = owned ? level + 1 : 0;
  const total = MAX_LEVEL + 1;
  return (
    <span
      className={`hg-pips${owned && level >= MAX_LEVEL ? ' is-hotel' : ''}`}
      role="img"
      aria-label={owned ? `${tile ? levelNameOf(tile, level) : `Level ${level + 1}`} (${lit} of ${total})` : 'No business yet'}
      style={color ? { '--pip': color } : undefined}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < lit ? 'is-on' : ''} />
      ))}
    </span>
  );
}

/** Set progress dots: "●●○". `colors` (optional, per slot) paints each dot in its owner's colour. */
export function SetDots({ owned, total, color, colors = null }) {
  return (
    <span className="hg-setdots" style={{ '--sc': color }} role="img" aria-label={`${owned} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i
          key={i}
          className={colors ? (colors[i] ? 'is-on' : '') : i < owned ? 'is-on' : ''}
          style={colors?.[i] ? { background: colors[i] } : undefined}
        />
      ))}
    </span>
  );
}

export default function TileChip({ tileId, level = 0, mortgaged = false, selected, disabled = false, onClick, extra }) {
  const tile = TILES[tileId];
  if (!tile) return null;
  const { color } = tileAccent(tile);
  const Tag = onClick ? 'button' : 'span';
  const btn = onClick
    ? { type: 'button', onClick: () => onClick(tileId), disabled, ...(selected !== undefined ? { 'aria-pressed': !!selected } : {}) }
    : {};
  return (
    <Tag
      {...btn}
      className={`hg-tilechip${onClick ? ' is-btn' : ''}${mortgaged ? ' is-mort' : ''}${selected ? ' is-sel' : ''}`}
      style={{ '--tc': color }}
      title={mortgaged ? `${tile.name} (mortgaged)` : `${tile.name}${tile.type === 'property' ? `: ${levelNameOf(tile, level)}` : ''}`}
    >
      <i className="hg-tilechip-dot" />
      <span className="hg-tilechip-name">{tile.short || tile.name}</span>
      {mortgaged ? <span className="hg-tilechip-m" aria-label="mortgaged">M</span> : null}
      {tile.type === 'property' && level > 0 ? <LevelPips level={level} color={color} tile={tile} /> : null}
      {extra}
    </Tag>
  );
}

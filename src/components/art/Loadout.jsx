// A player's "loadout": the equipped cosmetics other people can actually see at the table, as a compact row of small
// labelled chips. Dice skin, pawn trail and board theme are the extras (the frame wraps the avatar and the title is a
// text chip, both drawn by their own components); `showTitle` adds the title chip in front when a caller wants everything
// in one place. Each chip carries the item name (aria-label + tooltip) and a rarity-tinted ring (legendary = gold,
// epic = violet). Nothing equipped renders nothing at all (no empty box, no layout shift).
//   <Loadout cosmetics={{ dice, trail, board, title }} variant="chips" | "row" size={18} showTitle />
// 'chips' = art only (seats, lists); 'row' = a little larger with the item names visible (the results screen).
// The chips reveal one after another (loadout.css; opacity / translate only, off under reduced motion).
import { memo } from 'react';
import { cleanEquipped, cosmeticById, rarityRank } from '@shared/cosmetics.js';
import { CosmeticPreview, TitleChip } from './cosmetics.jsx';
import { DiceSwatch } from './DiceSwatch.jsx';
import '@/styles/loadout.css';

/** The kinds a loadout shows as chips, in order. */
export const LOADOUT_KINDS = Object.freeze(['dice', 'trail', 'board']);
const KIND_LABEL = { dice: 'Dice', trail: 'Trail', board: 'Board' };

/** `{ frame?, dice?, trail?, board?, title? }` (anything, even junk) -> the equipped catalogue items `[{ kind, item }]` for the chips, in order. Pure. */
export function loadoutItems(cosmetics) {
  const eq = cleanEquipped(cosmetics);
  const out = [];
  for (const kind of LOADOUT_KINDS) {
    const item = eq[kind] ? cosmeticById(eq[kind]) : null;
    if (item) out.push({ kind, item });
  }
  return out;
}

/** Is anything in this look legendary (frame, title, dice, trail or board)? For the gold rim on the results winner. Pure. */
export function hasLegendary(cosmetics) {
  const eq = cleanEquipped(cosmetics);
  return Object.values(eq).some((id) => rarityRank(cosmeticById(id)?.rarity) >= rarityRank('legendary'));
}

const ringClass = (rarity) => `is-${['common', 'rare', 'epic', 'legendary'].includes(rarity) ? rarity : 'common'}`;

function Art({ kind, item, px }) {
  // the swatch is cheap and memoised; trails and boards go through the kit's preview
  return kind === 'dice' ? <DiceSwatch skin={item} size={px} /> : <CosmeticPreview item={item} size={px} />;
}

const View = memo(function LoadoutView({ dice, trail, board, title, variant, size, showTitle, className }) {
  const items = loadoutItems({ dice, trail, board });
  if (!items.length && !(showTitle && title)) return null;
  const row = variant === 'row';
  const px = size || (row ? 22 : 18);
  const cls = ['lo', row ? 'lo--row' : 'lo--chips', className].filter(Boolean).join(' ');
  let i = 0;
  return (
    <span className={cls} style={{ '--lo-px': `${px}px` }} data-count={items.length}>
      {showTitle && title ? (
        <span className="lo-title" style={{ '--i': i++ }}>
          <TitleChip title={title} size="sm" />
        </span>
      ) : null}
      {items.map(({ kind, item }) => (
        <span
          key={kind}
          className={`lo-chip lo-chip--${kind} ${ringClass(item.rarity)}`}
          role="img"
          aria-label={item.name}
          title={`${KIND_LABEL[kind]}: ${item.name}`}
          data-kind={kind}
          data-rarity={item.rarity}
          style={{ '--i': i++ }}
        >
          <span className="lo-chip__art" aria-hidden="true">
            <Art kind={kind} item={item} px={px} />
          </span>
          {row ? <span className="lo-chip__name">{item.name}</span> : null}
        </span>
      ))}
    </span>
  );
});

/** See the file header. `cosmetics` is cleaned here (unknown ids and wrong kinds are dropped), so it is safe on network data. */
export default function Loadout({ cosmetics, variant = 'chips', size, showTitle = false, className }) {
  const eq = cleanEquipped(cosmetics);
  return <View dice={eq.dice} trail={eq.trail} board={eq.board} title={eq.title} variant={variant} size={size} showTitle={showTitle} className={className} />;
}

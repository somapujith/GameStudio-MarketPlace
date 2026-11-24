import { Avatar } from '@/components/art/index.js';
import { AvatarFrame, CosmeticPreview, DiceSwatch, TitleChip } from '@/components/art/cosmetics.jsx';
import { cosmeticById } from '@shared/cosmetics.js';
import '@/styles/cine/ava.css';

const known = (id, kind) => {
  const item = id ? cosmeticById(id) : null;
  return item && item.kind === kind ? item : null;
};

/**
 * Round avatar with an optional ring colour (CSS colour), presence dot ('on' | 'off') and equipped `frame`
 * (a cosmetic id). A known frame replaces the ring; the footprint grows a little so the face keeps its size.
 */
export default function Ava({ preset = 0, size = 48, ring, dot, frame, className = '' }) {
  const item = known(frame, 'frame');
  if (item) {
    const outer = Math.round(size * 1.2);
    return (
      <span className={`hh2-ava hh2-ava--kit ${className}`.trim()} style={{ '--sz': `${outer}px` }}>
        <AvatarFrame frame={item.id} size={outer}>
          {(inner) => <Avatar preset={Number(preset) || 0} size={inner} />}
        </AvatarFrame>
        {dot && <i className={`hh2-ava__dot hh2-ava__dot--${dot}`} />}
      </span>
    );
  }
  return (
    <span className={`hh2-ava ${className}`.trim()} style={{ '--sz': `${size}px`, ...(ring ? { '--ring': ring } : null) }}>
      <Avatar preset={Number(preset) || 0} size={size} />
      {dot && <i className={`hh2-ava__dot hh2-ava__dot--${dot}`} />}
    </span>
  );
}

/** Equipped title (cosmetic id) as a chip; renders nothing for an unknown id. */
export function Title({ title, size = 'sm', className = '' }) {
  const item = known(title, 'title');
  if (!item) return null;
  return <TitleChip title={item.id} size={size} className={`xp-title ${className}`.trim()} />;
}

/** A die face in a skin's colours (cosmetic id). */
export function Dice({ skin, size = 40, shine }) {
  return <DiceSwatch skin={known(skin, 'dice')?.id || 'dice-ivory'} size={size} shine={shine} />;
}

/** Shop tile art for any cosmetic item. Frames show the player's own avatar; `shine` makes a dice swatch glint (legendary). */
export function Preview({ item, size = 72, avatar, shine }) {
  if (!item) return null;
  if (item.kind === 'dice' && shine) return <DiceSwatch skin={item.id} size={size} shine />;
  if (item.kind === 'frame' && avatar != null) {
    return (
      <AvatarFrame frame={item.id} size={size}>
        {(inner) => <Avatar preset={Number(avatar) || 0} size={inner} />}
      </AvatarFrame>
    );
  }
  return <CosmeticPreview item={item} size={size} />;
}

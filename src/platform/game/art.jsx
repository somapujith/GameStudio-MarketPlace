// Bridges to the art kit's piece + cosmetic components (`PieceArt` from art/index.js, `AvatarFrame` and
// `TitleChip` from art/cosmetics.jsx), with quiet built-in fallbacks so the lobby renders before (or without)
// them. The glob is resolved at build time: a missing file is simply an empty match, never a build error.
import { cosmeticById } from '@shared/cosmetics.js';

const mods = import.meta.glob(['/src/components/art/index.js', '/src/components/art/cosmetics.jsx'], { eager: true });

function pick(name) {
  for (const mod of Object.values(mods)) {
    try {
      // a test mock without this export throws on access: treat it as missing
      // components may be plain functions or React.memo / forwardRef objects
        const c = mod && mod[name];
        if (typeof c === 'function' || (c && typeof c === 'object' && c.$$typeof)) return c;
    } catch {
      /* not exported */
    }
  }
  return null;
}

/** A small generic pawn in `color`, used when the art kit has no `PieceArt` yet. */
function FallbackPiece({ color = '#7b6dff', size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <ellipse cx="20" cy="34" rx="12" ry="3.5" fill="rgba(0,0,0,0.28)" />
      <path d="M20 6a6.5 6.5 0 0 1 3.9 11.7L27 30H13l3.1-12.3A6.5 6.5 0 0 1 20 6z" fill={color} />
      <path d="M10.5 30h19a2 2 0 0 1 0 4h-19a2 2 0 0 1 0-4z" fill={color} />
      <path d="M17.6 9.4a3.6 3.6 0 0 1 3.9-.9" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function FallbackFrame({ frame, size = 48, children }) {
  const item = cosmeticById(frame);
  const [a, b] = (item && item.colors) || [];
  const style = { width: size, height: size };
  if (a) style['--xl-frame-a'] = a;
  if (b || a) style['--xl-frame-b'] = b || a;
  return (
    <span className={`xl-frame${a ? ' has-frame' : ''}`} style={style}>
      {children}
    </span>
  );
}

function FallbackTitle({ title }) {
  const item = cosmeticById(title);
  const text = item ? item.name : typeof title === 'string' && !title.startsWith('title-') ? title : '';
  if (!text) return null;
  return <span className="xl-title">{text}</span>;
}

const ArtPiece = pick('PieceArt');
const ArtFrame = pick('AvatarFrame');
const ArtTitle = pick('TitleChip');

/** `PieceArt({ piece, color, size })`: a game piece in a player's colour. */
export function PieceArt(props) {
  return ArtPiece ? <ArtPiece {...props} /> : <FallbackPiece {...props} />;
}

/** `AvatarFrame({ frame, size, children })`: the equipped avatar ring (no frame = the avatar as is). */
export function AvatarFrame(props) {
  if (!props.frame) return props.children;
  return ArtFrame ? <ArtFrame {...props} /> : <FallbackFrame {...props} />;
}

/** `TitleChip({ title, size })`: the equipped title under a name (nothing when none); `size` is 'sm' | 'md' (the kit's default). */
export function TitleChip({ title, size }) {
  if (!title) return null;
  return ArtTitle ? <ArtTitle title={title} size={size} /> : <FallbackTitle title={title} />;
}

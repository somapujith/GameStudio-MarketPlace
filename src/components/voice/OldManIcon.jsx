// A small original old man: warm skin, white side hair and a big white moustache. Pure SVG, no filters or gradients; crisp from
// 20 to 48 px. `locked` swaps the palette for greys (no CSS filter). Decoration only: aria-hidden.

const COLORS = {
  on: { skin: '#e8b48a', hair: '#f4f1ea', ink: '#2a1b12', brow: '#cfc9bd', cheek: '#e58f7a' },
  locked: { skin: '#8d857a', hair: '#b8b0a3', ink: '#2b2824', brow: '#9a9388', cheek: '#8b8478' },
};

export default function OldManIcon({ size = 32, locked = false, className = '' }) {
  const c = COLORS[locked ? 'locked' : 'on'];
  return (
    <svg
      className={`vl-oldman${locked ? ' is-locked' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      data-oldman=""
    >
      {/* side hair behind the head */}
      <circle cx="8.5" cy="21" r="6" fill={c.hair} />
      <circle cx="39.5" cy="21" r="6" fill={c.hair} />
      <circle cx="11" cy="13.5" r="4.6" fill={c.hair} />
      <circle cx="37" cy="13.5" r="4.6" fill={c.hair} />
      {/* ears and head */}
      <circle cx="7.4" cy="26" r="3" fill={c.skin} />
      <circle cx="40.6" cy="26" r="3" fill={c.skin} />
      <path d="M24 6.5c9.4 0 15.4 6 15.4 15.5 0 10.6-6.4 19.5-15.4 19.5S8.6 32.6 8.6 22C8.6 12.5 14.6 6.5 24 6.5z" fill={c.skin} />
      {/* a few strands on the crown */}
      <path d="M17 9.5c2.4-1.7 5.6-2.3 8.5-1.3M21 12.5c1.8-.9 3.7-1 5.5-.4" stroke={c.hair} strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* brows, eyes, cheeks */}
      <path d="M12.8 19.5l6-1.9M35.2 19.5l-6-1.9" stroke={c.brow} strokeWidth="3" strokeLinecap="round" />
      <circle cx="16.5" cy="23" r="1.9" fill={c.ink} />
      <circle cx="31.5" cy="23" r="1.9" fill={c.ink} />
      <circle cx="12.8" cy="29.5" r="2.6" fill={c.cheek} opacity="0.55" />
      <circle cx="35.2" cy="29.5" r="2.6" fill={c.cheek} opacity="0.55" />
      {/* nose */}
      <path d="M24 22.5c-1.8 2.5-2.6 4.3-1.8 5.5.900 1 2.7 1 3.6 0 .800-1.2 0-3-1.8-5.5z" fill={c.skin} stroke={c.cheek} strokeWidth="1.2" strokeLinejoin="round" />
      {/* the moustache and a small mouth under it */}
      <path d="M24 29.5c-2.8-1.6-6.6-1.7-9.6.4-2 1.4-1.7 3.7.4 4.1 2.4.5 5.8-.4 9.2-2.7 3.4 2.3 6.8 3.2 9.2 2.7 2.1-.4 2.4-2.7.4-4.1-3-2.1-6.8-2-9.6-.4z" fill={c.hair} stroke={c.brow} strokeWidth="1" strokeLinejoin="round" />
      <path d="M21.5 36.8c1.7.9 3.3.9 5 0" stroke={c.ink} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

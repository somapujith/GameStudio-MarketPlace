// A small original cat face: flat grey, cream muzzle, pink ears and nose. Pure SVG, no filters or gradients; crisp from 20 to
// 48 px. `locked` swaps the palette for muted greys (no CSS filter). Decoration only: aria-hidden.

const COLORS = {
  on: { fur: '#8f9aa8', dark: '#5b6573', cream: '#fff1d6', pink: '#f5a3b5', ink: '#1d1a22' },
  locked: { fur: '#6f6a66', dark: '#4b4743', cream: '#b8b0a3', pink: '#8b8478', ink: '#2b2824' },
};

export default function CatIcon({ size = 32, locked = false, className = '' }) {
  const c = locked ? COLORS.locked : COLORS.on;
  return (
    <svg
      className={`vl-cat${locked ? ' is-locked' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      data-cat=""
    >
      {/* ears */}
      <path d="M6.5 22V6.5l11 6.2z" fill={c.fur} strokeLinejoin="round" stroke={c.fur} strokeWidth="2" />
      <path d="M41.5 22V6.5l-11 6.2z" fill={c.fur} strokeLinejoin="round" stroke={c.fur} strokeWidth="2" />
      <path d="M9.6 17.5V10.8l5.2 3z" fill={c.pink} />
      <path d="M38.4 17.5V10.8l-5.2 3z" fill={c.pink} />
      {/* head */}
      <ellipse cx="24" cy="27" rx="19" ry="16" fill={c.fur} />
      {/* forehead stripes */}
      <g stroke={c.dark} strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d="M24 11.5v6" />
        <path d="M18.4 12.6l1.4 5" />
        <path d="M29.6 12.6l-1.4 5" />
      </g>
      {/* muzzle */}
      <ellipse cx="24" cy="33.5" rx="8.6" ry="6.4" fill={c.cream} />
      {/* eyes */}
      <ellipse cx="16" cy="25.5" rx="2.5" ry="3" fill={c.ink} />
      <ellipse cx="32" cy="25.5" rx="2.5" ry="3" fill={c.ink} />
      <circle cx="16.9" cy="24.4" r="0.8" fill={c.cream} />
      <circle cx="32.9" cy="24.4" r="0.8" fill={c.cream} />
      {/* nose, mouth, whiskers */}
      <path d="M21.6 30.4h4.8L24 33.4z" fill={c.pink} stroke={c.ink} strokeWidth="1" strokeLinejoin="round" />
      <path d="M24 33.4v1.6M24 35c-1 1.5-2.8 1.9-4.4 1M24 35c1 1.5 2.8 1.9 4.4 1" stroke={c.ink} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <g stroke={c.cream} strokeWidth="1.1" strokeLinecap="round" fill="none">
        <path d="M5 30.5l8 1.2M5.6 35.6l7.6-1.4" />
        <path d="M43 30.5l-8 1.2M42.4 35.6l-7.6-1.4" />
      </g>
    </svg>
  );
}

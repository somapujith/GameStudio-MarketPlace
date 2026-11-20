// A small original tiger face: flat orange, black stripes, cream muzzle. Pure SVG, no filters, no gradients, so it
// stays crisp from 20 to 48 px and costs nothing to paint. `locked` swaps the palette for greys (no CSS filter).
// It is decoration: aria-hidden, the name of the voice line is always printed next to it.

const COLORS = {
  on: { fur: '#f28c28', ink: '#1b1109', cream: '#fff1d6', nose: '#e0527a' },
  locked: { fur: '#7d756b', ink: '#2b2824', cream: '#b8b0a3', nose: '#8b8478' },
};

export default function TigerIcon({ size = 32, locked = false, className = '' }) {
  const c = locked ? COLORS.locked : COLORS.on;
  return (
    <svg
      className={`vl-tiger${locked ? ' is-locked' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      data-tiger=""
    >
      {/* ears */}
      <circle cx="10.5" cy="12" r="6.4" fill={c.fur} />
      <circle cx="37.5" cy="12" r="6.4" fill={c.fur} />
      <circle cx="10.5" cy="12.4" r="3" fill={c.ink} />
      <circle cx="37.5" cy="12.4" r="3" fill={c.ink} />
      <circle cx="10.5" cy="12.9" r="1.7" fill={c.cream} />
      <circle cx="37.5" cy="12.9" r="1.7" fill={c.cream} />
      {/* head */}
      <path d="M24 6c10 0 19 6 19 18 0 11-8 19-19 19S5 35 5 24C5 12 14 6 24 6z" fill={c.fur} />
      {/* forehead and cheek stripes */}
      <g stroke={c.ink} strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d="M24 7.5v8" />
        <path d="M16.5 9.6l3 7" />
        <path d="M31.5 9.6l-3 7" />
        <path d="M5.8 21l6.4 2.2" />
        <path d="M6.4 28.4l6.2-.6" />
        <path d="M42.2 21l-6.4 2.2" />
        <path d="M41.6 28.4l-6.2-.6" />
      </g>
      {/* eye patches, muzzle */}
      <ellipse cx="16.6" cy="22.4" rx="4.2" ry="3.2" fill={c.cream} />
      <ellipse cx="31.4" cy="22.4" rx="4.2" ry="3.2" fill={c.cream} />
      <ellipse cx="24" cy="32.4" rx="10" ry="7.6" fill={c.cream} />
      {/* eyes */}
      <circle cx="16.8" cy="22.6" r="2.1" fill={c.ink} />
      <circle cx="31.2" cy="22.6" r="2.1" fill={c.ink} />
      <circle cx="17.5" cy="21.9" r="0.65" fill={c.cream} />
      <circle cx="31.9" cy="21.9" r="0.65" fill={c.cream} />
      {/* nose and mouth */}
      <path d="M20.4 28.2h7.2l-3.6 4.1z" fill={c.nose} stroke={c.ink} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M24 32.3v2.4M24 34.7c-1.1 1.7-3.2 2.3-5.4 1.2M24 34.7c1.1 1.7 3.2 2.3 5.4 1.2" stroke={c.ink} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

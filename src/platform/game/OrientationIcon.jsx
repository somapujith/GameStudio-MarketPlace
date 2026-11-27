// The small stroke icon (a phone on its side) for the game page's "Best played in landscape" chip. Its own file so the page does not load the gate.

const SIDEWAYS = 'M4.5 6.5h15A2.5 2.5 0 0 1 22 9v6a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 15V9a2.5 2.5 0 0 1 2.5-2.5zM18.5 12h.01';
const UPRIGHT = 'M7 2h10a2.5 2.5 0 0 1 2.5 2.5v15A2.5 2.5 0 0 1 17 22H7a2.5 2.5 0 0 1-2.5-2.5v-15A2.5 2.5 0 0 1 7 2zM12 18.5h.01';

export default function OrientationIcon({ size = 15, upright = false, className = '' }) {
  return (
    <svg
      className={`hub-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      <path d={upright ? UPRIGHT : SIDEWAYS} />
    </svg>
  );
}

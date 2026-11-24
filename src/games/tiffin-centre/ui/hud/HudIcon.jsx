// HUD icons: the hub's stroke Icon set where it has the glyph, a few of our own (day parts, hearts, alarm...) where it does not.
import { Icon } from '@/components/shell/icons.jsx';

const OWN = {
  sunrise: 'M3.5 18.5h17M7 18.5a5 5 0 0 1 10 0M12 7.5v3M5.4 10.9l1.8 1.8M18.6 10.9l-1.8 1.8M9.5 6l2.5-2.5L14.5 6',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
  chai: 'M6.5 8.5h11l-1.3 11H7.8zM9 4.2c0 1.3 1.1 1.3 1.1 2.6M13 4.2c0 1.3 1.1 1.3 1.1 2.6M7 12.5h10',
  moon: 'M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z',
  heartCrack: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20zM12 7.3l-2 3.6 3 2-2 4.6',
  alarm: 'M12 20a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 9.5V13l2.2 1.5M4.5 6.5 7 4M19.5 6.5 17 4',
  thumb: 'M7 11v8H4v-8zM7 11l4-7c1.6 0 2.6 1.3 2.1 2.9L12.5 9H18a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 16.8 19H7',
  help: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5M12 16.6h.01',
  smoke: 'M8 19c-2 0-3-1.5-3-3s1.2-2.8 3-2.8c0-2 1.6-3.7 4-3.7s4 1.7 4 3.7c1.8 0 3 1.2 3 2.8s-1 3-3 3z',
  pause: 'M8.5 5v14M15.5 5v14',
  walk: 'M13 5a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 13 5zM10 21l1.5-6-2.5-2 1-5 3 1 2 3M9 9.5 6.5 12',
};
const FILLED = new Set(['heart', 'heartCrack']);

export default function HudIcon({ name, size = 22, className = '', title }) {
  const d = OWN[name];
  if (!d) return <Icon name={name} size={size} className={className} title={title} />;
  return (
    <svg
      className={`hh-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={FILLED.has(name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

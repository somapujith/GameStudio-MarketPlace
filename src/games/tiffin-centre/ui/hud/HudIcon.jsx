// HUD icons: the hub's stroke Icon set where it has the glyph, a few of our own (day parts, hearts, alarm...) where it does not.
import { Icon } from '@/components/shell/icons.jsx';
import { scaled } from './DishIcon.jsx';

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
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  rotate: 'M4.5 8.5h15v7h-15zM2.5 12h1.4M20.1 12h1.4M12 4.2V6',
  exit: 'M10 4.5H5.5v15H10M14 8l4 4-4 4M18 12H9',
  stall: 'M4 9.5h16M5.5 9.5v10M18.5 9.5v10M4 9.5l1.5-4.5h13L20 9.5M9 19.5v-5h6v5',
  talk: 'M4.5 5.5h15v10h-7.5l-4 3.5v-3.5h-3.5zM8.5 9.5h7M8.5 12h4.5',
  talkOff: 'M4.5 5.5h15v10h-7.5l-4 3.5v-3.5h-3.5zM3 3l18 18',
  behind: 'M6 9l6 6 6-6M6 14.5l6 6 6-6',
  cc: 'M3.5 6.5h17v11h-17zM10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3',
  walk: 'M13 5a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 13 5zM10 21l1.5-6-2.5-2 1-5 3 1 2 3M9 9.5 6.5 12',
  // operations layer: LPG cylinder, rain, wiping a pan, a drop of water, a parcel bag, the delivery bike, the menu board, the prep counter, a clipboard, a chilli
  gas: 'M8 9h8v10a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 19zM9.5 9V7a2.5 2.5 0 0 1 5 0v2M12 4.5V3M8 13.5h8',
  rain: 'M7 14.5a4 4 0 0 1-.5-7.9A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 0 7zM9 17.5 8 20M13 17.5 12 20M17 17.5 16 20',
  wipe: 'M5 20h14M8 16 14.5 4.5l3.5 2L11.5 18zM6.5 20 8 16',
  drop: 'M12 3.5s6 6.2 6 10.7a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5z',
  bag: 'M6 8h12l1 12.5H5zM9 8V6.5a3 3 0 0 1 6 0V8',
  truck: 'M3 6.5h11v9H3zM14 10h4l3 3v2.5h-7zM7 18.5h.01M17 18.5h.01',
  board: 'M4 5h16v11H4zM8 20l1.5-4M16 20l-1.5-4M8.5 9h7M8.5 12h4.5',
  prep: 'M4 11h16l-1.5 6a3 3 0 0 1-3 2.2h-7A3 3 0 0 1 5.5 17zM15 11l4-6.5',
  clip: 'M8 4.5h8v3H8zM6.5 6h11v14h-11zM9 12h6M9 15.5h4',
  chilli: 'M16.5 5.5c-.6-1.2-2-1.8-3.2-1.2M15 6.5c3 1.8 3.4 6.4-.4 9.9C11.600 19.400 6.600 19.900 4.500 19.500c3-1.400 4.500-3.600 5-6.600.4-2.400 2.600-4.400 5.500-6.400z',
  basket: 'M4 10h16l-1.500 9.500h-13zM8 10l3-5.500M16 10l-3-5.500',
};
const FILLED = new Set(['heart', 'heartCrack']);

export default function HudIcon({ name, size = 22, className = '', title }) {
  const d = OWN[name];
  if (!d) return <Icon name={name} size={size} className={className} title={title} style={scaled(size)} />;
  return (
    <svg
      className={`hh-icon ${className}`.trim()}
      width={size}
      height={size}
      style={scaled(size)}
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

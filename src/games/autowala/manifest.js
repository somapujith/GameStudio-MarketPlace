// Autowala: the second Jalebi Games plugin, and the first SOLO one: an open-world Hyderabad auto-rickshaw driving game (three.js)
// that runs full screen at /play/autowala (loaders.soloGame). No room, no server adapter: `solo: true` tells the hub to show
// "Play now" instead of "Create table". Scores are saved through the Worker's solo run API (docs/ADDING_A_GAME.md section 9), so
// it has stats, badges and a leaderboard tab like any other game. Keep this file TINY: no engine, no pages.
import { AutowalaCover, AutowalaIcon } from '@/components/art/hub/index.js';

export default {
  id: 'autowala',
  name: 'Autowala',
  tagline: 'Drive a Hyderabad auto through the city',
  description:
    'Take the wheel of a Hyderabad auto-rickshaw in a big open city: the lanes of the Old City, Charminar, Hussain Sagar, Hi-Tech City, Secunderabad and the airport, with the Metro running overhead. Customers wait outside Paradise, Bawarchi, Delhi Mithai Wala, OYO, the panipuri carts and the Metro stations. Pick them up, follow the route on your minimap, and earn the fare and a tip for a smooth, quick ride.\n\nMind the traffic: bump a vehicle and the road rage starts, with drivers chasing you through the streets. Lose them and you walk free; get caught and the fine comes out of your wallet and your passenger pays less. Spend what you earn at Mama’s Garage: paint, number plate, horn, lights, mud-flaps, performance parts and more, just like the autos you see on the road.',
  category: 'arcade',
  status: 'live',
  solo: true,
  orientation: 'landscape', // phones and tablets must be sideways to play: the hub covers the game with a "turn your phone" screen (docs/perf/landscape.md)
  players: { min: 1, max: 1 },
  duration: '10-30 min',
  theme: { accent: '#ff3d9a', accent2: '#37e6ff', bg: '#120824' },
  art: { cover: AutowalaCover, icon: AutowalaIcon },
  modes: { friends: false, open: false },
  // WebGL 2 is asked for BEFORE the 3D chunks load: a device without it gets the message at once, not after 5-9 s of download
  loaders: { soloGame: async () => ((await import('@/platform/gfx/webgl.js')).probeWebgl2().ok ? import('./AutowalaGame.jsx') : import('./NoWebgl.jsx')) },
  features: ['Open-world city', 'Real traffic and road rage', 'Metro rail', 'Customise your auto', 'Day and night', 'Plays in the browser'],
  publisher: 'Jalebi Games',
  languages: ['English', 'Telugu'],
  platforms: ['Phone', 'Tablet', 'Desktop'],
  tags: ['Driving', 'Open world', 'Hyderabad', 'Auto-rickshaw', 'Single player', 'Customisation', 'Arcade'],
  highlights: [
    { icon: 'compass', title: 'A big, living city', text: 'Old City lanes, the lake road, glass towers and the airport, with the Metro running above the streets.' },
    { icon: 'users', title: 'Real customers', text: 'People wait outside real-feeling Hyderabad shops and stations. Pick them up for the fare, and a tip if you drive well.' },
    { icon: 'bolt', title: 'Traffic and road rage', text: 'Hit a vehicle and the traffic chases you. Escape and it is forgotten; get caught and you pay.' },
    { icon: 'gamepad', title: 'Make it yours', text: 'Mama’s Garage: paint, plates, horns, lights, mud-flaps, rear-window lettering and performance parts.' },
  ],
  gallery: [
    { kind: 'cover', caption: 'Cover art: an auto on a dusk street' },
    { kind: 'scene', focus: 'right', caption: 'The auto, close up' },
    { kind: 'board', caption: 'The Autowala icon' },
  ],
  howToPlay: [
    { icon: 'play', title: 'Start your shift', text: 'Drive with W A S D or the arrow keys (Space drifts, Shift boosts, H honks), or the on-screen controls on a phone.' },
    { icon: 'compass', title: 'Pick up a customer', text: 'Follow the pink markers and the route on your minimap, stop beside them and press E.' },
    { icon: 'bolt', title: 'Earn and spend', text: 'Drop them where they ask. Smooth and quick earns tips; crashes cost you. Spend the money at Mama’s Garage.' },
    { icon: 'star', title: 'Keep out of trouble', text: 'Stay on the road, mind the traffic, and refuel at a CNG station before the tank runs dry.' },
  ],
  // Per-player stats shown on the profile and the leaderboard (the Worker's solo run API writes them):
  // games = shifts saved, wins = shifts that earned Rs 3,000 or more, bestScore = the most earned in one shift.
  stats: [
    { key: 'bestScore', label: 'Best shift', format: 'inr' },
    { key: 'games', label: 'Shifts' },
    { key: 'wins', label: 'Big shifts' },
  ],
  badges: [
    { id: 'first-shift', label: 'First Shift', desc: 'Save your first shift as an Autowala driver', stat: 'games', target: 1, icon: 'rookie' },
    { id: 'regular-driver', label: 'Regular Driver', desc: 'Save 10 shifts', stat: 'games', target: 10, icon: 'regular' },
    { id: 'big-earner', label: 'Big Earner', desc: 'Earn Rs 3,000 or more in a single shift', stat: 'wins', target: 1, icon: 'ten-wins' },
    { id: 'auto-king', label: 'Auto Raja', desc: 'Earn Rs 10,000 in one shift', stat: 'bestScore', target: 10000, icon: 'landlord', format: 'inr' },
  ],
};

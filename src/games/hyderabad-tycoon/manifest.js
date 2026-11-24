// Nawabi Raj (the game id stays `hyderabad-tycoon`; Hyderabad Hustle rules): the first Jalebi Games plugin. Keep this
// file TINY: no engine, no pages, no React components except the two art components. Everything heavy is behind
// `loaders` (code-split). Contract: docs/MARKETPLACE.md section 3 and docs/HUSTLE_PLAN.md section 5.
// How to add the next game: docs/ADDING_A_GAME.md.
import { TycoonCover, TycoonIcon } from '@/components/art/hub/index.js';
import { PIECES } from '@shared/pieces.js';
import { GAME_ID } from './constants.js';
import { LOBBY_SETTINGS, MAPS_LINE, SETTINGS_GROUPS, SETTINGS_SCHEMA, TABLE_RULES, settingsSummary, tableRulesFor } from './settings.js';

export default {
  id: GAME_ID,
  name: 'Nawabi Raj',
  tagline: 'Buy Dilsukhnagar to Banjara Hills',
  mapsLine: MAPS_LINE, // "2 maps: Charminar Chaos · Andhra Aatalu" (the hub card and the listing)
  description:
    'Rule the city like a Nawab. Start with ₹15 lakh, buy commercial districts from Sultan Bazaar to the Financial District, collect rent and grow each one into a city-famous business. Ride the Auto, Metro and MMTS, sip chai to dodge a big rent, and survive traffic jams, wedding season and the city rush hours. The richest player after the last round wins.\n\nTwo maps, one board: play Charminar Chaos, the Hyderabad map, or switch the table to Andhra Aatalu (ఆంధ్ర ఆటలు) for the beaches of Visakhapatnam, the hills of Araku, the chilli yards of Guntur and the fort towns of Rayalaseema. Same rules, different places, cards and festivals.',
  category: 'board',
  status: 'live',
  players: { min: 2, max: 6 },
  duration: '35-60 min',
  theme: { accent: '#ffc857', accent2: '#ff8a3d', bg: '#1b1340' },
  art: { cover: TycoonCover, icon: TycoonIcon },
  modes: { friends: true, open: false },
  features: ['Play with friends', 'Two maps: Charminar Chaos and Andhra Aatalu', '36-square board', 'Auto, Metro and MMTS shortcuts', 'City rush-hour events'],
  createHint: 'You pick the mode in the lobby. Share the code and roll when everyone is in.',
  // Store-listing metadata (all optional; the game page hides what is missing).
  publisher: 'Jalebi Games',
  version: '1.0',
  ageRating: '12+',
  languages: ['English'],
  platforms: ['Phone', 'Tablet', 'Desktop'],
  tags: ['Property trading', 'Tycoon', 'Hyderabad', 'Charminar Chaos', 'Andhra Pradesh', 'Dice', 'Auctions', 'Play with friends', 'Online'],
  highlights: [
    { icon: 'users', title: 'Two to six players', text: 'Make a private table, share the code and play together in real time.' },
    { icon: 'map', title: 'Two maps, one board', text: 'Thirty-six squares, from Sultan Bazaar to the Financial District, or from Visakhapatnam to Tirupati on Andhra Aatalu.' },
    { icon: 'bolt', title: 'City rush hours', text: 'Traffic jams, wedding season and chai breaks keep every round unpredictable.' },
    { icon: 'door', title: 'No download', text: 'Play in the browser on a phone, tablet or computer. Guests are welcome.' },
  ],
  gallery: [
    { kind: 'image', src: '/art/cinematic/heritage-sunset.webp', caption: 'Hyderabad at sunset' },
    { kind: 'image', src: '/art/cinematic/heritage-cityscape.webp', caption: 'The city on the board: Charminar, the metro and the lake' },
    { kind: 'image', src: '/art/cinematic/heritage-cityscape.webp', focus: 'pieces', zoom: 1.8, caption: 'Chai, biryani, metro, auto and pearls' },
    { kind: 'image', src: '/art/cinematic/heritage-board.webp', caption: 'The heritage board, from above' },
    { kind: 'image', src: '/art/cinematic/heritage-board.webp', focus: 'heart', zoom: 2.1, caption: 'The old city at the centre of the board' },
    { kind: 'image', src: '/art/cinematic/heritage-sunset.webp', focus: 'center', zoom: 1.9, caption: 'Charminar, the heart of the board' },
    { kind: 'image', src: '/art/cinematic/heritage-sunset.webp', focus: 'left', zoom: 2.1, caption: 'Chai and biryani: the pieces' },
    { kind: 'board', caption: 'The Nawabi Raj icon' },
  ],
  howToPlay: [
    { icon: 'dice', title: 'Roll', text: 'Roll one die and move round the city. A six rolls again; passing START pays ₹2 lakh.' },
    { icon: 'rupee', title: 'Buy or pass', text: 'Buy the district you land on, or pass and it stays free. Buy it and the others get a moment to Snatch it.' },
    { icon: 'building', title: 'Upgrade', text: 'Own all the districts of a collection to start upgrading them, twice each, from a stall to a trading hub. Bigger businesses ask bigger rent.' },
    { icon: 'trophy', title: 'Richest wins', text: 'Reach the net-worth target first, or be the richest after the last round: cash, districts and half your upgrades.' },
  ],
  pieces: PIECES,
  // Game badges read the per-game stats the client sees (games, wins, bestScore, rating).
  badges: [
    { id: 'first-deal', label: 'First Deal', desc: 'Finish a game of Nawabi Raj', stat: 'games', target: 1, icon: 'rookie' },
    { id: 'city-regular', label: 'City Regular', desc: 'Play 10 games of Nawabi Raj', stat: 'games', target: 10, icon: 'regular' },
    { id: 'nawab', label: 'Nawab of the City', desc: 'Win 5 games of Nawabi Raj', stat: 'wins', target: 5, icon: 'ten-wins' },
    { id: 'quarter-crore', label: 'Quarter Crore Club', desc: 'Finish a game worth ₹25,00,000 or more', stat: 'bestScore', target: 2500000, icon: 'landlord', format: 'inr' },
    { id: 'tycoon-rated', label: 'Rising Tycoon', desc: 'Reach a rating of 1,100', stat: 'rating', target: 1100, icon: 'level' },
  ],
  settings: SETTINGS_SCHEMA,
  lobbySettings: LOBBY_SETTINGS, // the lobby shows the mode (a preset) and every host rule
  settingsGroups: SETTINGS_GROUPS, // the rule groups of the host's "Game rules" editor (money, timers, board rules, snatch)
  tableRules: TABLE_RULES, // a read-only line under the lobby settings
  tableRulesFor, // ... in the words of the room's map: tableRulesFor('andhra')
  summarize: settingsSummary,
  loaders: {
    onlineGame: () => import('./OnlineGame.jsx'),
  },
  stats: [
    { key: 'wins', label: 'Wins' },
    { key: 'games', label: 'Games' },
    { key: 'bestScore', label: 'Best net worth', format: 'inr' },
    { key: 'rating', label: 'Rating' },
  ],
};

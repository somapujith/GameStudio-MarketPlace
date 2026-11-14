// Hyderabad Tycoon (Hyderabad Hustle rules): the first GameHub plugin. Keep this file TINY: no engine, no pages, no
// React components except the two art components. Everything heavy is behind `loaders` (code-split).
// Contract: docs/MARKETPLACE.md section 3 and docs/HUSTLE_PLAN.md section 5.
import { TycoonCover, TycoonIcon } from '@/components/art/hub/index.js';
import { PIECES } from '@shared/pieces.js';
import { GAME_ID } from './constants.js';
import { LOBBY_SETTINGS, SETTINGS_SCHEMA, TABLE_RULES, settingsSummary } from './settings.js';

export default {
  id: GAME_ID,
  name: 'Hyderabad Tycoon',
  tagline: 'Own the city. Survive the madness.',
  description:
    'Start with ₹15 lakh, buy commercial districts from Sultan Bazaar to the Financial District, collect rent and grow each one into a city-famous business. Ride the Auto, Metro and MMTS, sip chai to dodge a big rent, and survive traffic jams, wedding season and the city rush hours. The richest player after the last round wins.',
  category: 'board',
  status: 'live',
  players: { min: 2, max: 6 },
  duration: '35-60 min',
  theme: { accent: '#ffc857', accent2: '#ff8a3d', bg: '#1b1340' },
  art: { cover: TycoonCover, icon: TycoonIcon },
  modes: { friends: true, open: false },
  features: ['Play with friends', '36-square Hyderabad board', 'Auto, Metro and MMTS shortcuts', 'City rush-hour events'],
  createHint: 'You pick the mode in the lobby. Share the code and roll when everyone is in.',
  howToPlay: [
    { title: 'Roll', text: 'Roll one die and move round the city. A six rolls again; passing START pays ₹2 lakh.' },
    { title: 'Buy or auction', text: 'Buy the district you land on, or skip it and everyone bids in a sealed auction.' },
    { title: 'Upgrade', text: 'Grow a district twice, from a stall to a trading hub. Bigger businesses ask bigger rent.' },
    { title: 'Richest wins', text: 'After the last round the highest net worth wins: cash, districts and half your upgrades.' },
  ],
  pieces: PIECES,
  // Game badges read the per-game stats the client sees (games, wins, bestScore, rating).
  badges: [
    { id: 'first-deal', label: 'First Deal', desc: 'Finish a game of Hyderabad Tycoon', stat: 'games', target: 1, icon: 'rookie' },
    { id: 'city-regular', label: 'City Regular', desc: 'Play 10 games of Hyderabad Tycoon', stat: 'games', target: 10, icon: 'regular' },
    { id: 'nawab', label: 'Nawab of the City', desc: 'Win 5 games of Hyderabad Tycoon', stat: 'wins', target: 5, icon: 'ten-wins' },
    { id: 'quarter-crore', label: 'Quarter Crore Club', desc: 'Finish a game worth ₹25,00,000 or more', stat: 'bestScore', target: 2500000, icon: 'landlord', format: 'inr' },
    { id: 'tycoon-rated', label: 'Rising Tycoon', desc: 'Reach a rating of 1,100', stat: 'rating', target: 1100, icon: 'level' },
  ],
  settings: SETTINGS_SCHEMA,
  lobbySettings: LOBBY_SETTINGS, // the lobby only shows the mode
  tableRules: TABLE_RULES, // a read-only line under the lobby settings
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

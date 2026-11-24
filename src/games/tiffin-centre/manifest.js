// Tiffin Centre: a real-time, 3D, co-op Hyderabadi tiffin stall. A hybrid plugin: a SOLO screen (the scripted tutorial and
// practice shifts, at paths.solo(id)) AND a private room for 2-4 friends (loaders.onlineGame). The tutorial unlocks the
// table (`tutorial.requiredForRooms`). Rules live in shared/tiffin-centre/, the server adapter in worker/games/tiffin-centre.js.
// Keep this file TINY: no engine, no pages (docs/ADDING_A_GAME.md sections 2 and 9).
import { TiffinCover, TiffinIcon } from '@/components/art/hub/index.js';
import { GAME_ID } from '@shared/tiffin-centre/catalog.js';
import { LOBBY_SETTINGS, SETTINGS_SCHEMA, settingsSummary } from './settings.js';

export default {
  id: GAME_ID,
  name: 'Tiffin Centre',
  tagline: 'Run a Hyderabad tiffin stall with friends',
  description:
    '"Anna, one masala dosa! Chai ready, miyan?" Welcome to your own roadside tiffin centre on a Hyderabad footpath: a tarpaulin roof, a flex banner, a brick stove and a queue of hungry regulars. Your cook runs between the tawa, steamer, kadai and chai counter, flips the dosas, lifts the idlies and pours the irani chai, then serves it hot before the customer loses patience. Take each dish the moment it is ready or it burns, and above all, collect the money before they walk off: a customer who leaves unpaid costs the stall a heart.\n\nLearn the ropes on your own in the training morning, then open a table for up to four friends and run one stall together: one on the tawa, one on the chai, one at the counter taking the notes. Twelve shifts follow the day from a sunrise rush to a lamp-lit festival night, with autos honking past, the Charminar in the haze and the light changing over the stall.',
  category: 'social',
  status: 'live',
  solo: true,
  players: { min: 2, max: 4 },
  duration: '5-10 min',
  theme: { accent: '#ff8a1f', accent2: '#12908e', bg: '#241a14' },
  art: { cover: TiffinCover, icon: TiffinIcon },
  modes: { friends: true, open: false },
  tutorial: { requiredForRooms: true },
  loaders: {
    soloGame: () => import('./TiffinSolo.jsx'),
    onlineGame: () => import('./OnlineGame.jsx'),
  },
  features: ['Co-op for 2 to 4 friends', 'Roadside street-food stall', 'Real-time cooking', 'Collect the money before they walk off', 'Twelve shifts, sunrise to night', 'Learn in a solo tutorial'],
  createHint: 'Pick a level and a pace. Share the code and open the stall when your friends are in.',
  publisher: 'Jalebi Games',
  version: '1.0',
  languages: ['English', 'Telugu'],
  platforms: ['Phone', 'Tablet', 'Desktop'],
  tags: ['Co-op', 'Real time', 'Cooking', 'Hyderabad', '3D', 'Tiffin', 'Dosa', 'Street food'],
  highlights: [
    { icon: 'users', title: 'Run the stall together', text: 'Two to four friends in one private room, sharing the tawa, the steamer, the kadai and the chai counter on one footpath stall.' },
    { icon: 'clock', title: 'Real-time rush', text: 'Orders pile up, patience drains and dosas burn. Every second of the shift counts.' },
    { icon: 'rupee', title: 'Collect before they go', text: 'A customer who is not paid in time walks off without paying and costs the team a heart.' },
    { icon: 'spark', title: 'Sunrise to night', text: 'Twelve shifts that follow the day: morning tiffins, lunch, evening chai and bajji, and a festival night.' },
  ],
  gallery: [
    { kind: 'cover', caption: 'Cover art: the stall at golden hour' },
    { kind: 'scene', focus: 'center', caption: 'The tawa, the steamer and the kadai' },
    { kind: 'board', caption: 'The Tiffin Centre icon' },
  ],
  howToPlay: [
    { icon: 'users', title: 'Take the orders', text: 'Customers walk up shouting their order. The ring above their head drains as they wait.' },
    { icon: 'bolt', title: 'Cook it', text: 'Your cook runs between the tawa, steamer, kadai and chai counter. Take each dish the moment it is ready or it burns.' },
    { icon: 'play', title: 'Serve it', text: 'Carry up to two plates at a time and hand them to the right customer while they are still happy.' },
    { icon: 'rupee', title: 'Collect the money', text: 'After they eat, they hold the note out. Collect the money before they walk off: if the timer runs out they leave unpaid.' },
    { icon: 'door', title: 'Play with friends', text: 'Finish the solo tutorial, open a table and share the code. Anyone can serve or collect for any customer.' },
  ],
  settings: SETTINGS_SCHEMA,
  lobbySettings: LOBBY_SETTINGS,
  summarize: settingsSummary,
  // Per-player stats (written from the room's result): games = shifts played, wins = shifts cleared with at least one
  // star, bestScore = the most money one player collected in a single shift.
  stats: [
    { key: 'games', label: 'Shifts' },
    { key: 'wins', label: 'Shifts cleared' },
    { key: 'bestScore', label: 'Best shift', format: 'inr' },
  ],
  badges: [
    { id: 'first-shift', label: 'First Shift', desc: 'Finish your first shift at the Tiffin Centre', stat: 'games', target: 1, icon: 'rookie' },
    { id: 'regular-cook', label: 'Regular Cook', desc: 'Finish 10 shifts', stat: 'games', target: 10, icon: 'regular' },
    { id: 'stall-master', label: 'Stall Master', desc: 'Clear 5 shifts with your friends', stat: 'wins', target: 5, icon: 'ten-wins' },
  ],
};

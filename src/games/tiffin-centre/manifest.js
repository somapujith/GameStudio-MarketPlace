// Tiffin Centre: a real-time, first-person 3D, co-op Hyderabadi tiffin stall. A hybrid plugin: a SOLO screen (the scripted tutorial and
// practice shifts, at paths.solo(id)) AND a private room for 2-4 friends (loaders.onlineGame). The tutorial unlocks the
// table (`tutorial.requiredForRooms`). Rules live in shared/tiffin-centre/, the server adapter in worker/games/tiffin-centre.js.
// Keep this file TINY: no engine, no pages (docs/ADDING_A_GAME.md sections 2 and 9).
import { TiffinCover, TiffinIcon } from '@/components/art/hub/index.js';
import { GAME_ID } from '@shared/tiffin-centre/catalog.js';
import { LOBBY_SETTINGS, SETTINGS_SCHEMA, settingsSummary } from './settings.js';

export default {
  id: GAME_ID,
  name: 'Tiffin Centre',
  tagline: 'Cook a Hyderabad street stall in first person',
  description:
    '"Anna, one masala dosa! Chai ready, miyan?" See the stall through your own eyes: you are the cook behind the counter of a roadside tiffin centre on a Hyderabad footpath, a tarpaulin roof overhead, a flex banner above and a queue of hungry regulars across the counter. Walk along the counter and work at the tawa, steamer, kadai and chai counter with your own hands: spread the batter, flip the dosas, lift the idlies and pour the irani chai, then serve it hot before the customer loses patience. Take each dish the moment it is ready or it burns, and above all, collect the money before they walk off: a customer who leaves unpaid costs the stall a heart.\n\nEvery customer has an expressive face and a voice of their own: Telugu, Hindi and Hyderabadi lines, subtitled and, where your device has a voice for the language, spoken, from the hurried office-goer to the uncle in his topi. Learn the ropes on your own in the training morning, then open a table for up to four friends and run one stall together: one on the tawa, one on the chai, one at the counter taking the notes. Twelve shifts follow the day from a sunrise rush to a lamp-lit festival night, with autos honking past, the Charminar in the haze and the light changing over the stall.',
  category: 'social',
  status: 'live',
  solo: true,
  orientation: 'landscape', // phones and tablets must be sideways to play: the hub covers the game with a "turn your phone" screen (docs/perf/landscape.md)
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
  features: ['See the stall through your own eyes (first person)', 'Co-op for 2 to 4 friends', 'Expressive faces and Telugu, Hindi and Hyderabadi street talk', 'Real-time cooking', 'Collect the money before they walk off', 'Twelve shifts, sunrise to night', 'Learn in a solo tutorial'],
  createHint: 'Pick a level and a pace. Share the code and open the stall when your friends are in.',
  publisher: 'Jalebi Games',
  version: '1.0',
  languages: ['English', 'Telugu'],
  platforms: ['Phone', 'Tablet', 'Desktop'],
  tags: ['First person', 'Co-op', 'Real time', 'Cooking', 'Hyderabad', '3D', 'Tiffin', 'Dosa', 'Street food'],
  highlights: [
    { icon: 'compass', title: 'Through your own eyes', text: 'Stand behind the counter in first person: your own hands spread the batter, lift the lid and pour the chai while the street goes by.' },
    { icon: 'user', title: 'Faces and street talk', text: 'Every customer has a face and a mood, and speaks in Telugu, Hindi or Hyderabadi, with subtitles and optional speech.' },
    { icon: 'users', title: 'Run the stall together', text: 'Two to four friends in one private room, sharing the tawa, the steamer, the kadai and the chai counter on one footpath stall.' },
    { icon: 'clock', title: 'Real-time rush', text: 'Orders pile up, patience drains and dosas burn. Every second of the shift counts.' },
    { icon: 'rupee', title: 'Collect before they go', text: 'A customer who is not paid in time walks off without paying and costs the team a heart.' },
    { icon: 'spark', title: 'Sunrise to night', text: 'Twelve shifts that follow the day: morning tiffins, lunch, evening chai and bajji, and a festival night.' },
  ],
  gallery: [
    { kind: 'cover', caption: "Cover art: the stall through the cook's eyes, golden hour" },
    { kind: 'scene', focus: 'center', caption: 'The tawa, the steamer and the kadai' },
    { kind: 'board', caption: 'The Tiffin Centre icon' },
  ],
  howToPlay: [
    { icon: 'users', title: 'Take the orders', text: 'Customers walk up to the counter and call out their order in their own language. Their patience drains as they wait.' },
    { icon: 'bolt', title: 'Cook it', text: 'Walk along the counter and work at the tawa, steamer, kadai and chai counter with your own hands. Take each dish the moment it is ready or it burns.' },
    { icon: 'play', title: 'Serve it', text: 'Carry up to two plates at a time and hand them to the right customer while they are still happy.' },
    { icon: 'rupee', title: 'Collect the money', text: 'After they eat, they hold the note out. Collect the money before they walk off: if the timer runs out they leave unpaid.' },
    { icon: 'door', title: 'Play with friends', text: 'Finish the solo tutorial, open a table and share the code. Anyone can serve or collect for any customer.' },
  ],
  settings: SETTINGS_SCHEMA,
  lobbySettings: LOBBY_SETTINGS,
  summarize: settingsSummary,
  // Per-player stats (written from the room's result): games = shifts played, wins = cleared shifts (at least one star) where
  // this player was the top earner, bestScore = the most money one player collected in a single shift.
  stats: [
    { key: 'games', label: 'Shifts' },
    { key: 'wins', label: 'Shifts won' },
    { key: 'bestScore', label: 'Best shift', format: 'inr' },
  ],
  badges: [
    { id: 'first-shift', label: 'First Shift', desc: 'Finish your first shift at the Tiffin Centre', stat: 'games', target: 1, icon: 'rookie' },
    { id: 'regular-cook', label: 'Regular Cook', desc: 'Finish 10 shifts', stat: 'games', target: 10, icon: 'regular' },
    { id: 'stall-master', label: 'Stall Master', desc: 'Be the top earner of 5 cleared shifts with your friends', stat: 'wins', target: 5, icon: 'ten-wins' },
  ],
};

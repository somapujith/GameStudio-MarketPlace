// First-run tour of the hub home page ("/"): the top bar, the way around, then the store shelves in reading order.
// Steps whose target is not on screen (a shelf with nothing in it, "How it works" once signed in, the friends strip for a
// visitor, the coins chip before sign-in) are skipped by the engine, so one list serves every kind of visitor.
// On phones the big shelves are pointed at by their heading row (or button) so the card never covers what it explains.
import { BRAND } from '@/platform/brand.js';
import { t } from './dom.js';

export const HOME_TOUR_ID = 'home';

const NAV = `${t('nav-rail')}, ${t('nav-tabbar')}`; // the left rail from 900 px, the bottom tab bar below

export const homeSteps = [
  {
    id: 'welcome',
    placement: 'center',
    title: `Welcome to ${BRAND.name}`,
    body: 'Pick a game, grab your friends and play in seconds. Here is a quick look around.',
  },
  {
    id: 'search',
    target: t('nav-search'),
    placement: 'bottom',
    title: 'Search everything',
    body: 'Find a game or jump to any page. Press Ctrl+K or / on a keyboard.',
  },
  {
    id: 'code',
    target: t('nav-code'),
    placement: 'bottom',
    title: 'Got a room code?',
    body: 'A friend sent you a 6-letter code? Type it here and you are at their table.',
  },
  {
    id: 'coins',
    target: t('nav-coins'),
    placement: 'bottom',
    title: 'Your coins',
    body: 'Coins you earn from daily rewards and matches. Tap them to visit the shop.',
  },
  {
    id: 'profile',
    target: t('nav-profile'),
    placement: 'bottom',
    title: 'You',
    body: 'Sign in or play as a guest here. Once in, this is your profile, level and settings.',
  },
  {
    id: 'nav',
    target: NAV,
    placement: 'right',
    title: 'Get around',
    body: 'Games, Browse, Friends, Rank and Profile are always one tap away.',
    phone: { placement: 'top' },
  },
  {
    id: 'hero',
    target: t('home-hero'),
    placement: 'bottom',
    title: "Tonight's spotlight",
    body: 'The featured game lives up here. Open its page to see the rules and start a table.',
    phone: { target: `${t('home-hero')} .sh-spot__cta`, placement: 'top', body: 'The featured game lives up here. Tap Play now to open its page and start a table.' },
  },
  {
    id: 'how',
    target: t('home-how'),
    placement: 'bottom',
    title: 'How it works',
    body: 'Three steps: open a table, share the code, play. Sign in with Google, or just give a name and play as a guest.',
    phone: { target: `${t('home-how')} .sh-how__cta`, placement: 'top', body: 'Sign in with Google, or just give a name and play as a guest. Then open a table, share the code and play.' },
  },
  {
    id: 'play',
    target: t('home-play'),
    placement: 'top',
    title: 'Play now',
    body: 'Every game you can play today. Tap a card to open the game and start a table.',
    phone: { target: `${t('home-play')} .sh-head`, placement: 'top' },
  },
  {
    id: 'tables',
    target: t('home-tables'),
    placement: 'top',
    title: 'Open tables',
    body: 'Tables other people have opened. Tap one to join in, no code needed.',
    phone: { target: `${t('home-tables')} .sh-head`, placement: 'top' },
  },
  {
    id: 'friends',
    target: t('home-friends'),
    placement: 'top',
    title: 'Your friends',
    body: 'See who is online and invite them to a table in one tap.',
    phone: { target: `${t('home-friends')} .sh-head`, placement: 'top' },
  },
  {
    id: 'categories',
    target: t('home-categories'),
    placement: 'top',
    title: 'Browse by kind',
    body: 'Board, card, word and more. Pick a kind of game you feel like playing.',
    phone: { target: `${t('home-categories')} .sh-head`, placement: 'top' },
  },
  {
    id: 'daily',
    target: t('home-daily'),
    placement: 'top',
    title: 'Daily reward',
    body: 'Claim free coins once a day. Come back every day to grow your streak.',
    phone: { target: `${t('home-daily')} .hh2-daily__action`, placement: 'top' },
  },
  {
    id: 'top',
    target: t('home-top'),
    placement: 'top',
    title: 'Top players',
    body: 'The best players right now. Win matches to climb the board.',
  },
  {
    id: 'done',
    placement: 'center',
    title: 'You are all set',
    body: 'Open a game to start a table. Every screen has a ? button if you want this tour again.',
  },
];

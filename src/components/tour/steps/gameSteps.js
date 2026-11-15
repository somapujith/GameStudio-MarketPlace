// First-run tour of a live game's store page (/games/:id): the shopfront, the "Start a table" panel and the sections below it.
// Built per game so the copy can say its name; the targets are the same for every live game. A step whose target the page does
// not have (a game without maps, a page without open tables) is skipped by the engine.
import { reach, t } from './dom.js';

export const GAME_TOUR_ID = 'game';

export function gameSteps(game) {
  const name = (game && game.name) || 'this game';
  return [
    {
      id: 'welcome',
      placement: 'center',
      title: `This is ${name}`,
      body: 'Everything about the game is on this page. Let us show you how to start a table.',
    },
    {
      id: 'art',
      target: t('game-head'),
      placement: 'right',
      title: 'The game at a glance',
      body: 'How many can play, how long a game takes, and how many tables are open right now.',
      phone: { target: `${t('game-head')} .gd-facts`, placement: 'top' },
    },
    {
      id: 'seats',
      target: reach(t('game-seats'), 'seats'),
      placement: 'left',
      title: 'How many players?',
      body: 'Pick the table size with + and -. You count as one; the rest are your friends.',
      phone: { target: t('game-seats'), placement: 'top' },
    },
    {
      id: 'map',
      target: reach(t('game-map'), 'map'),
      placement: 'left',
      title: 'Choose a map',
      body: 'Pick the city your board is set in. The rules stay the same, only the places change.',
      phone: { target: t('game-map'), placement: 'top' },
    },
    {
      id: 'create',
      target: reach(t('game-create'), 'create'),
      placement: 'left',
      title: 'Create table',
      body: 'Opens your own table and gives you a room code to share. Friends join, then you start.',
      phone: { target: t('game-create'), placement: 'top' },
    },
    {
      id: 'join',
      target: reach(t('game-join'), 'join'),
      placement: 'left',
      title: 'Join with a code',
      body: 'Got a code from a friend? Type it here to hop straight into their table.',
      phone: { target: t('game-join'), placement: 'top' },
    },
    {
      id: 'share',
      target: reach(t('game-share'), 'share'),
      placement: 'left',
      title: 'Share the game',
      body: 'Send a link to this page to a friend, on WhatsApp or anywhere else.',
      phone: { target: t('game-share'), placement: 'top' },
    },
    {
      id: 'subnav',
      target: t('game-subnav'),
      placement: 'bottom',
      title: 'Jump around the page',
      body: 'Tap a section to scroll straight to it: About, How to play, Gallery, Live now and more.',
    },
    {
      id: 'how',
      target: '#gd-how',
      placement: 'top',
      title: 'How to play',
      body: 'New to the game? The short version of the rules is here.',
      phone: { target: '#gd-how .gd-sec__head', placement: 'top' },
    },
    {
      id: 'maps',
      target: '#gd-maps',
      placement: 'top',
      title: 'The maps',
      body: 'A look at each map you can pick when you start a table.',
      phone: { target: '#gd-maps .gd-sec__head', placement: 'top' },
    },
    {
      id: 'live',
      target: '#gd-live',
      placement: 'top',
      title: 'Open tables',
      body: 'Tables people have opened right now. Tap one to join, or start your own.',
      phone: { target: '#gd-live .gd-sec__head', placement: 'top' },
    },
    {
      id: 'board',
      target: '#gd-board',
      placement: 'top',
      title: `Leaderboard`,
      body: `See who is winning at ${name}, and where you stand once you have played.`,
      phone: { target: '#gd-board .gd-sec__head', placement: 'top' },
    },
  ];
}

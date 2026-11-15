// First-run tour of the profile page (/profile): who you are, your stats and the settings (sound, motion, theme, notifications).
import { t } from './dom.js';

export const PROFILE_TOUR_ID = 'profile';

export const profileSteps = [
  {
    id: 'welcome',
    placement: 'center',
    title: 'Your profile',
    body: 'Your level, stats and settings live here. A quick look.',
  },
  {
    id: 'header',
    target: t('profile-header'),
    placement: 'bottom',
    title: 'You and your level',
    body: 'Your name, icon, level and coins. Win matches to earn XP and level up.',
    phone: { target: `${t('profile-header')} .hh2-pro__top`, placement: 'bottom' },
  },
  {
    id: 'stats',
    target: t('profile-stats'),
    placement: 'top',
    title: 'Your games',
    body: 'Wins, matches and best scores for every game you have played.',
  },
  {
    id: 'badges',
    target: `${t('profile-badges')} .hub-section__head`,
    placement: 'bottom',
    title: 'Badges',
    body: 'Little trophies for things you achieve, just below. Locked ones show what to aim for.',
  },
  {
    id: 'sound',
    target: t('settings-sound'),
    placement: 'top',
    title: 'Sound',
    body: 'Turn effects on or off, set the volume, and add a quiet night-market hum under the board.',
    phone: { target: `${t('settings-sound')} .hub-section__title`, placement: 'top' },
  },
  {
    id: 'motion',
    target: t('settings-motion'),
    placement: 'top',
    title: 'Motion and feel',
    body: 'Reduce motion, switch vibration on or off, shake your phone to roll, and speed up the animations.',
    phone: { target: `${t('settings-motion')} .hub-section__title`, placement: 'top' },
  },
  {
    id: 'look',
    target: t('settings-look'),
    placement: 'top',
    title: 'Theme',
    body: 'Light, dark, or follow your device. Game tables always stay dark.',
  },
  {
    id: 'notify',
    target: t('settings-notify'),
    placement: 'top',
    title: 'Invite notifications',
    body: 'Get a ping when a friend invites you to a table, even with the app closed.',
    phone: { target: `${t('settings-notify')} .hub-section__title`, placement: 'top' },
  },
  {
    id: 'replay',
    target: t('settings-help'),
    placement: 'top',
    title: 'Replay the tours',
    body: 'Want to see these tips again on every screen? Reset them here.',
    phone: { target: `${t('settings-help')} .hub-section__title`, placement: 'top' },
  },
];

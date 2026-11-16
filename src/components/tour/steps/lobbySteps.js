// First-run tours of the table lobby (/lobby/:code): one for the host (invite, icon, mode, rules, start) and one for everybody
// who joins (icon, seats, the host's rules read-only, waiting for the start). Rule names and what they do are read from the
// shared rule list (shared/ruleSettings.js) so this copy cannot drift from the real options.
import { MODES, MODE_IDS } from '@shared/modes.js';
import { RULE_FIELDS, RULE_GROUPS } from '@shared/ruleSettings.js';
import { firstSentences, rule, t } from './dom.js';

export const LOBBY_HOST_TOUR_ID = 'lobby-host';
export const LOBBY_GUEST_TOUR_ID = 'lobby-guest';
export const LOBBY_RULES_TOUR_ID = 'lobby-rules';

const fieldsOf = (groupId) => RULE_FIELDS.filter((f) => f.group === groupId);
const nameList = (groupId) => {
  const names = fieldsOf(groupId).map((f) => f.label.toLowerCase());
  const last = names.pop();
  return names.length ? `${names.join(', ')} and ${last}` : last;
};

/** "Standard: 20 rounds, richest wins. Quick: ..." from the mode presets. */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const modeLine = () => MODE_IDS.map((id) => `${MODES[id].label.split(' ')[0]}: ${lower(MODES[id].blurb)}.`).join(' ');

/** The header button of a rule group (the group itself is a tall column on a wide screen). */
const group = (id) => `${t(`lobby-group-${id}`)} .xl-group__btn`;

const groupLabel = (id) => (RULE_GROUPS.find((g) => g.id === id) || { label: id }).label;

export const lobbyHostSteps = [
  {
    id: 'welcome',
    placement: 'center',
    title: 'Your table is open',
    body: 'Invite friends, choose your icon and set the rules here. Then press Start.',
  },
  {
    id: 'code',
    target: t('lobby-code'),
    placement: 'bottom',
    title: 'The room code',
    body: 'Friends type this code to join your table. Tap it to copy.',
  },
  {
    id: 'seats',
    target: t('lobby-seats'),
    placement: 'right',
    title: 'Around the table',
    body: 'Everyone who joins shows up here. Tap an empty seat to invite someone, or remove a player you do not want.',
    phone: { placement: 'top' },
  },
  {
    id: 'invite',
    target: t('lobby-invite'),
    placement: 'left',
    title: 'Fill the table',
    body: 'Copy the code or link, send it on WhatsApp, share it, or show the QR code to someone next to you.',
    phone: { placement: 'top' },
  },
  {
    id: 'friends',
    target: t('lobby-friends'),
    placement: 'left',
    title: 'Invite friends in one tap',
    body: 'Signed-in players can invite their friends straight from here. Guests share the code or link instead.',
    phone: { placement: 'top' },
  },
  {
    id: 'pieces',
    target: t('lobby-pieces'),
    placement: 'bottom',
    title: 'Choose your icon',
    body: 'Tap an icon to pick your piece for the board. Greyed-out ones are taken.',
    phone: { target: `${t('lobby-pieces')} .xl-pieces__head`, placement: 'top' },
  },
  {
    id: 'map',
    target: t('lobby-map'),
    placement: 'left',
    title: 'Choose a map',
    body: 'Pick the city the board is set in. Everyone at the table plays on it; the rules stay the same.',
    phone: { target: `${t('lobby-map')} .mp__head`, placement: 'top' },
  },
  {
    id: 'mode',
    target: t('lobby-mode'),
    placement: 'left',
    title: 'Pick a mode',
    body: modeLine(),
    phone: { target: `${t('lobby-mode')} .ho-field__label`, placement: 'top' },
  },
  {
    id: 'money',
    target: group('money'),
    placement: 'left',
    title: groupLabel('money'),
    body: `Set the ${nameList('money')}. Tap a group to open it.`,
    phone: { placement: 'top' },
  },
  {
    id: 'timers',
    target: group('timers'),
    placement: 'left',
    title: groupLabel('timers'),
    body: `Set the ${nameList('timers')}. Shorter timers make a faster game.`,
    phone: { placement: 'top' },
  },
  {
    id: 'rules',
    target: group('rules'),
    placement: 'left',
    title: groupLabel('rules'),
    body: `Choose the ${nameList('rules')}.`,
    phone: { placement: 'top' },
  },
  {
    id: 'snatch',
    target: group('snatch'),
    placement: 'left',
    title: 'Snatch',
    body: 'When someone buys a district, the others get a few seconds to press Snatch and grab it. Set how many buttons each player gets and how long they have.',
    phone: { placement: 'top' },
  },
  {
    id: 'bar',
    target: t('lobby-rules-bar'),
    placement: 'left',
    title: 'Custom rules',
    body: 'This badge counts the rules you changed. Reset all puts everything back, and Expand all opens every group.',
    phone: { target: `${t('lobby-rules-bar')} .xl-rules__reset`, placement: 'top' },
  },
  {
    id: 'explain',
    target: t('lobby-rules-tour'),
    placement: 'left',
    title: 'Every rule, explained',
    body: 'Not sure what a rule does? This button walks you through each one.',
    phone: { placement: 'top' },
  },
  {
    id: 'start',
    target: t('lobby-start'),
    placement: 'top',
    title: 'Start the game',
    body: 'Lights up when enough players are here. The note beside it says what is still missing.',
  },
  {
    id: 'leave',
    target: t('lobby-leave'),
    placement: 'bottom',
    title: 'Leaving',
    body: 'If you leave, the host role passes to another player. Alone at the table? It simply closes.',
  },
  {
    id: 'status',
    target: t('lobby-connection'),
    placement: 'bottom',
    title: 'Connection',
    body: 'Shows that you are connected. If it drops, it reconnects by itself.',
  },
];

export const lobbyGuestSteps = [
  {
    id: 'welcome',
    placement: 'center',
    title: 'You are at the table',
    body: 'Pick your icon, check the rules and wait for the host to start.',
  },
  {
    id: 'code',
    target: t('lobby-code'),
    placement: 'bottom',
    title: 'The room code',
    body: 'Know someone who should join? Give them this code. Tap it to copy.',
  },
  {
    id: 'pieces',
    target: t('lobby-pieces'),
    placement: 'bottom',
    title: 'Choose your icon',
    body: 'Tap an icon to pick your piece for the board. Greyed-out ones are taken.',
    phone: { target: `${t('lobby-pieces')} .xl-pieces__head`, placement: 'top' },
  },
  {
    id: 'seats',
    target: t('lobby-seats'),
    placement: 'right',
    title: 'Around the table',
    body: 'Everyone at the table, with their icons. Your seat is highlighted and the host wears the crown.',
    phone: { placement: 'top' },
  },
  {
    id: 'settings',
    target: t('lobby-settings'),
    placement: 'left',
    title: "The host's rules",
    body: 'Only the host can change these. Rules that differ from normal are highlighted so nothing surprises you.',
    phone: { target: `${t('lobby-settings')} .ho-card__head`, placement: 'top' },
  },
  {
    id: 'map',
    target: t('lobby-map'),
    placement: 'left',
    title: 'The map',
    body: 'The city the host picked for the board. Everybody plays on the same one.',
    phone: { target: `${t('lobby-map')} .mp__head`, placement: 'top' },
  },
  {
    id: 'invite',
    target: t('lobby-invite'),
    placement: 'left',
    title: 'Bring more friends',
    body: 'You can share the code, link or QR code too.',
    phone: { placement: 'top' },
  },
  {
    id: 'start',
    target: t('lobby-start'),
    placement: 'top',
    title: 'Waiting for the host',
    body: 'The host presses Start, and you all go to the board together.',
  },
  {
    id: 'leave',
    target: t('lobby-leave'),
    placement: 'bottom',
    title: 'Leaving',
    body: 'Changed your mind? Leave the table here. You can rejoin with the code.',
  },
];

/** The optional deep dive for the host: one step per rule, in the order of the editor. Opens every group first (see LobbyTour). */
export const lobbyRulesSteps = [
  {
    id: 'intro',
    placement: 'center',
    title: 'Every rule, explained',
    body: `We will go through ${RULE_GROUPS.map((g) => g.label).join(', ')}. Changes save as you make them and everyone sees them.`,
  },
  ...RULE_FIELDS.map((f) => ({
    id: `rule-${f.key}`,
    target: rule(f.key),
    placement: 'left',
    title: f.label,
    body: firstSentences(f.help, 2),
    phone: { target: `${rule(f.key)} .xl-rule__head, ${rule(f.key)} .xl-rule__switchrow`, placement: 'top' },
  })),
  {
    id: 'done',
    placement: 'center',
    title: 'That is every rule',
    body: 'Not sure? The defaults of each mode are a good start. Reset all brings them back.',
  },
];

import LegalPage from '@/components/shell/legal/LegalPage.jsx';
import { Blocks } from '@/components/shell/legal/rich.jsx';
import { LEGAL_UPDATED } from '@/components/shell/legal/contact.js';

/*
 * Terms of use. Describes how the service actually works (accounts, guests, coins, tables). Governing law and the
 * operator's legal identity are deliberately not stated here: they belong to the operator (docs/LAUNCH_CHECKLIST.md).
 */

const SECTIONS = [
  {
    id: 'using',
    title: 'Using GameHub',
    body: [
      'GameHub is a free online marketplace of multiplayer games. By using the site or the installed app you agree to these terms. If you do not agree, please do not use it.',
      'The service is run by its operator (“we”). It works best in an up-to-date browser; see [Help](/help) for what is supported.',
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts and guests',
    body: [
      'You can play as a **guest** with a nickname, or sign in with **Google**. A guest account lives in the browser you created it in; if you clear your browser data you may lose it. Guests cannot use friends, receive invites or appear on the leaderboard.',
      {
        ul: [
          'Give accurate sign-in details and keep your device and Google account secure. What happens under your session is your responsibility.',
          'One person, one account. Do not hand your account to someone else or sell it.',
          'Tell us if you think someone else is using your account.',
        ],
      },
      'You can stop using GameHub at any time. See [Privacy](/privacy) for what we keep and how to ask for your account to be removed.',
    ],
  },
  {
    id: 'conduct',
    title: 'Playing fair and behaving well',
    body: [
      'Tables are shared with real people, so please be decent. You agree not to:',
      {
        ul: [
          'use a name, avatar or chat message that is hateful, harassing, sexual, threatening, or that pretends to be someone else;',
          'cheat: use bots, scripts, modified clients, or several accounts to gain an unfair edge, to boost rankings, or to collect rewards;',
          'attack or probe the service: attempt to break in, overload it, scrape it at scale, or interfere with other players’ connections;',
          'break the law or other people’s rights while using GameHub.',
        ],
      },
      'A table’s host can remove a player from the lobby. We may remove names, hide leaderboard entries, reset progress or suspend accounts that break these rules, with or without notice.',
    ],
  },
  {
    id: 'coins',
    title: 'Coins, XP and cosmetics',
    body: [
      'Coins and XP are points inside GameHub that you earn by playing and by claiming the daily reward. You can spend coins on cosmetic items in the Shop.',
      {
        ul: [
          'There is nothing to buy with real money today. Coins and items have no cash value, cannot be exchanged for money, and cannot be transferred between accounts.',
          'We may rebalance prices, rewards and rankings, or fix errors, at any time. If a bug gives an account coins or progress it should not have, we may correct it.',
        ],
      },
    ],
  },
  {
    id: 'content',
    title: 'What you put into GameHub',
    body: [
      'Your nickname, avatar choice and chat messages are visible to the other people at your table. They remain yours, and you give us the permission we need to show them to those players and to the people who read the leaderboard. Chat is relayed live and is not saved.',
      'You are responsible for what you write. Do not share other people’s personal information.',
    ],
  },
  {
    id: 'games',
    title: 'Games, tables and availability',
    body: [
      'Games are played in real time, and the server decides what happens. If a player disconnects, idles or leaves, the game may play on for them or end, and a game that ends early may not be recorded. A table expires after at most 24 hours.',
      'We work to keep GameHub available, but it is provided as it is: it may be slow, interrupted, changed or withdrawn, and games, features and the coming-soon titles on the site may change or never launch.',
    ],
  },
  {
    id: 'ip',
    title: 'Ownership',
    body: [
      'The GameHub site, its games, art, text and code belong to the operator or its licensors and are protected by law. You may play and share links to tables and pages. You may not copy, resell or build a competing service from our material without permission, except where the law lets you.',
    ],
  },
  {
    id: 'liability',
    title: 'Warranties and liability',
    body: [
      'GameHub is offered “as is” and “as available”, without promises that it will be uninterrupted or error-free. To the extent the law allows, the operator is not liable for indirect or consequential loss, or for loss of progress, coins, rankings or data. Nothing in these terms limits liability that cannot lawfully be limited, or your rights as a consumer under the law where you live.',
    ],
  },
  {
    id: 'ending',
    title: 'Suspension and ending',
    body: [
      'We may suspend or end access to GameHub, or to a single account, if these terms are broken, if it is needed to protect other players or the service, or if we stop running GameHub. You can leave at any time by simply stopping use; to have your account removed, see [Privacy](/privacy#choices).',
    ],
  },
  {
    id: 'changes',
    title: 'Changes and contact',
    body: [
      `We may change these terms, for example when a new game or feature arrives. The date at the top shows the latest version (${LEGAL_UPDATED.label}). Continuing to use GameHub after a change means you accept it.`,
      { contact: 'Questions about these terms:' },
      'More ways to get help are in [Help](/help).',
    ],
  },
];

export default function Terms() {
  return (
    <LegalPage
      eyebrow="The ground rules"
      title="Terms of use"
      lead="Plain rules for a shared table: how accounts work, how to play fair, and what we can and cannot promise."
      description="The terms for using GameHub: accounts and guests, fair play, coins and cosmetics, content, availability and liability."
      meta={[`Last updated ${LEGAL_UPDATED.label}`, 'Free to play']}
      sections={SECTIONS.map((s) => ({ ...s, body: <Blocks blocks={s.body} /> }))}
    />
  );
}

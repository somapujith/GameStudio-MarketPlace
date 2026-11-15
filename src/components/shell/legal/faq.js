// Help centre content. Each answer is a list of blocks understood by rich.jsx (paragraph strings with
// [label](/path) links, { ul }, { ol }, { note }, { contact }). Answers describe what the app actually does today:
// keep them in step with the code (room codes: src/components/shell/nav/codeUtil.js, daily reward: worker/xp.js,
// guests: docs/MARKETPLACE.md, install: src/components/shell/install.js).

export const FAQ_GROUPS = [
  { id: 'start', label: 'Getting started' },
  { id: 'friends', label: 'Friends and accounts' },
  { id: 'trouble', label: 'Connection and fixes' },
  { id: 'app', label: 'The app and your device' },
  { id: 'coins', label: 'Coins and rewards' },
  { id: 'report', label: 'Reporting a problem' },
];

export const FAQ = [
  {
    id: 'create-table',
    group: 'start',
    q: 'How do I create a table?',
    a: [
      { ol: [
        'Open a game from [Browse](/games) or the home page.',
        'Choose **how many players** (a game lists its own range, for example 2 to 6).',
        'Press **Create table**. You land in the lobby and become the host.',
        'Share the room code, the invite link, WhatsApp or the QR code. Signed-in players can also invite friends in one tap.',
        'When at least two people are in, the host presses **Start**.',
      ] },
      'Tables are private: only people with the code or link can join. Every seat is a real person, with no computer players.',
    ],
  },
  {
    id: 'join-table',
    group: 'start',
    q: 'How do I join a friend’s table?',
    a: [
      'Tap **Have a code?** at the top of any page and type the room code, or open the invite link your friend sent you. You can paste the whole link into the code box as well.',
      'You can also go straight to [Join a table](/join). Guests can join too: you do not need an account.',
    ],
  },
  {
    id: 'room-codes',
    group: 'start',
    q: 'What does a room code look like? It says it is not valid.',
    a: [
      'A room code is **6 characters**: capital letters and digits, with the look-alike characters left out. There is never a `0`, `O`, `1` or `I` in a code. Case does not matter and spaces are ignored.',
      'If a code is rejected, check it with the host, make sure the table has not already started or filled up, and remember that a table expires after at most 24 hours. If the host removed you from the lobby you cannot rejoin that table for 10 minutes.',
    ],
  },
  {
    id: 'how-it-works',
    group: 'start',
    q: 'Do I need to download anything?',
    a: [
      'No. GameHub runs in your browser on phones, tablets and computers. If you like, you can [install it as an app](#install-app) on your home screen.',
    ],
  },
  {
    id: 'languages',
    group: 'start',
    q: 'Which languages are supported?',
    a: ['GameHub and its current games are in English only.'],
  },
  {
    id: 'guest-vs-signed',
    group: 'friends',
    q: 'Guest or signed in with Google: what is the difference?',
    a: [
      { table: {
        head: ['', 'Guest', 'Signed in with Google'],
        rows: [
          ['Host, join and play tables', 'Yes', 'Yes'],
          ['Read the leaderboard', 'Yes', 'Yes'],
          ['Friends, friend codes and invites', 'No', 'Yes'],
          ['Appear on the leaderboard', 'No', 'Yes'],
          ['Progress follows you to another device', 'No', 'Yes'],
        ],
      } },
      'A guest account stays in the browser where you made it. If you clear your browser data, you start again. You can [sign in](/login) at any time.',
    ],
  },
  {
    id: 'friend-codes',
    group: 'friends',
    q: 'What is a friend code and how do I add a friend?',
    a: [
      'Every signed-in player has a friend code that looks like `HYD-XXXX`, and a link built from it. Both are on your [Friends](/friends) page.',
      'Send your link or code to a friend. When they open it they see an “Add this friend?” screen. If you both send requests, you are connected straight away. Friends can see when you are online and can invite you to a table.',
    ],
  },
  {
    id: 'sign-in-fails',
    group: 'friends',
    q: 'Google sign-in does not show up or fails',
    a: [
      { ul: [
        'The button loads from Google, so it needs a connection to `accounts.google.com`. An ad blocker, a strict privacy extension or a network filter can block it: allow the site or try another browser.',
        'In some in-app browsers (inside another app) Google sign-in is not available; open GameHub in your normal browser.',
        'You can always continue as a guest instead. See [Sign in](/login).',
      ] },
    ],
  },
  {
    id: 'reconnect',
    group: 'trouble',
    q: 'My connection dropped in the middle of a game',
    a: [
      'GameHub reconnects on its own. Keep the page open, or come back to it: it asks the table for the latest state and carries on.',
      { ul: [
        'If the page was closed, open the home page and use the **Rejoin** card, or open the same invite link again.',
        'While you are away, the table can play for you after a short wait, so nobody is stuck waiting. The game keeps your seat.',
        'If everyone leaves and nobody is connected for about five minutes, the game is abandoned and is not recorded.',
      ] },
      'Switching to another app for a moment is fine. A phone that locks or sleeps its network will reconnect when you unlock it.',
    ],
  },
  {
    id: 'slow-laggy',
    group: 'trouble',
    q: 'Things are slow, frozen or look wrong',
    a: [
      { ol: [
        'Reload the page. You rejoin the same table.',
        'Check that your browser is up to date, and that battery-saver mode is not throttling the page.',
        'If you installed the app and it looks stale, close it fully and reopen it, or hard-reload the page in a browser.',
        'Try another browser or network.',
      ] },
      'The game speed can be changed in your settings, in [Profile](/profile). It never changes how long the server waits.',
    ],
  },
  {
    id: 'offline',
    group: 'trouble',
    q: 'Can I play offline?',
    a: [
      'No. Every game is played live with other people, so you need an internet connection. If you are offline, GameHub shows a simple offline page and you can try again when your connection returns.',
    ],
  },
  {
    id: 'browsers',
    group: 'app',
    q: 'Which browsers and devices work?',
    a: [
      'An up-to-date version of Chrome, Edge, Firefox or Safari on a phone, tablet or computer. GameHub uses modern web features such as WebSockets, so very old browsers and some embedded “in-app” browsers will not work properly. Cookies and local storage should be allowed so you can stay signed in and keep your settings.',
      'Play is designed for touch as well as mouse and keyboard, in portrait or landscape.',
    ],
  },
  {
    id: 'install-app',
    group: 'app',
    q: 'How do I install GameHub on my phone or computer?',
    a: [
      { ul: [
        '**Android (Chrome) and desktop Chrome or Edge:** use the **Install** prompt GameHub shows after your second visit, or the browser menu, “Install app” / “Add to Home screen”.',
        '**iPhone and iPad (Safari):** tap **Share**, then **Add to Home Screen**.',
      ] },
      'An installed GameHub opens full screen, has its own icon, and on supported devices can send notifications for invites (turn them on in your settings; iPhone and iPad only deliver notifications to an installed app).',
    ],
  },
  {
    id: 'notifications',
    group: 'app',
    q: 'How do notifications work?',
    a: [
      'They are off until you switch them on in your settings, and only for signed-in players. They tell you when a friend invites you to a table. You can turn them off again in the same place or in your browser’s site settings.',
    ],
  },
  {
    id: 'daily-reward',
    group: 'coins',
    q: 'How does the daily reward work?',
    a: [
      'Claim it once per day from the home page. The day is counted on Indian Standard Time (IST). The reward grows with your streak: **150 coins** on day one, **+50** for each day in a row, up to **400 coins** from day six. If you miss a day the streak starts again.',
    ],
  },
  {
    id: 'coins',
    group: 'coins',
    q: 'What are coins for?',
    a: [
      'New accounts start with 500 coins. You earn more from the daily reward and by finishing games (winning pays more). You spend coins on cosmetic items, such as frames, dice and titles, in the [Shop](/shop). Coins are not real money and cannot be bought with it. See the [Terms](/terms).',
    ],
  },
  {
    id: 'leaderboard',
    group: 'coins',
    q: 'Why am I not on the leaderboard?',
    a: [
      'Only signed-in players are ranked, and only after finishing at least one game that counts. Guests never appear. A game that ends because nobody stayed connected is not recorded. See [Rank](/leaderboard).',
    ],
  },
  {
    id: 'report-problem',
    group: 'report',
    q: 'How do I report a bug or a player?',
    a: [
      'There is no in-app report button yet. To report a problem, send us what you can from this list so we can find it quickly:',
      { ul: [
        'the room code and roughly what time it happened;',
        'what you did, what you expected, and what happened instead;',
        'your device and browser (for example “iPhone, Safari” or “Android, Chrome”), and whether the app was installed;',
        'for a player, their name and the table they were at.',
      ] },
      { contact: 'Send it to:' },
      'In the meantime, the host of a table can remove a player from the lobby, and you can leave any table at any time.',
    ],
  },
  {
    id: 'privacy-data',
    group: 'report',
    q: 'What happens to my data, and how do I delete my account?',
    a: [
      'Everything we keep, why, and how long is explained on the [Privacy](/privacy) page. To ask for a copy of your data or for your account to be deleted, follow “Your choices and rights” there.',
    ],
  },
];

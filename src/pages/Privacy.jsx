import LegalPage from '@/components/shell/legal/LegalPage.jsx';
import { Blocks } from '@/components/shell/legal/rich.jsx';
import { LEGAL_UPDATED } from '@/components/shell/legal/contact.js';

/*
 * Privacy page. Everything below describes what the code in this repository actually does (worker/auth.js,
 * db/schema.sql, worker/GameRoom.js, src/lib/storage.js, src/lib/push.js, public/sw.js). When behaviour changes,
 * change the text and LEGAL_UPDATED together.
 */

const SECTIONS = [
  {
    id: 'summary',
    title: 'The short version',
    body: [
      'GameHub is a place to play multiplayer games with friends. To make that work we keep the minimum: a display name, a small avatar number, your game progress and, if you sign in with Google, your email address.',
      {
        ul: [
          'You can play as a **guest** without giving an email address or any personal details beyond a nickname.',
          'We do **not** run advertising, and we do not use analytics or tracking scripts.',
          'We do **not** sell your data.',
          'Chat messages in a table are passed to the other players live and are **not saved**.',
        ],
      },
    ],
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: [
      'This is everything GameHub stores about you or your device, and why.',
      {
        table: {
          head: ['What', 'Why', 'Who can see it'],
          rows: [
            [
              '**Google sign-in** (only if you choose it): your Google account identifier, your email address and the name on your Google account, used as your starting GameHub name. We do not store your Google profile picture; GameHub avatars come from a built-in set of twelve.',
              'To recognise you when you come back and keep your progress on every device.',
              'The name and avatar are visible to other players. Your email address is not shown to other players and is not used to send you email.',
            ],
            [
              '**Guest play**: the nickname you type (or “Guest”) and a random avatar number.',
              'To show who is at the table.',
              'Other players at your table.',
            ],
            [
              '**Your account**: a friend code (`HYD-XXXX`), level, XP, coins, daily-reward streak, cosmetics you own or have equipped.',
              'Progress, friends and the shop.',
              'Your name, avatar and level are visible to other players. Your friend code is for you to share; anyone who has it can look up your name, avatar and level.',
            ],
            [
              '**Game results**: for each finished game, the time, rounds played, and for every seat the display name, finishing rank and final score; plus your per-game totals (games, wins, best score, rating).',
              'Profile, match history and leaderboards.',
              'The leaderboard is public: anyone can read the names, avatars, levels and scores of signed-in players on it. Guests are never listed.',
            ],
            [
              '**Friends and invites**: friend requests and accepted friendships, whether you are online, and game invites you send or receive.',
              'Friends list, “who is online” and invitations.',
              'Your friends see when you are online. Invites are shown for two hours and old ones are cleared out in the background.',
            ],
            [
              '**Tables (rooms)**: room code, game, host name, who joined, number of seats and the table settings.',
              'To run the table, let people rejoin after a dropped connection, and list your live tables.',
              'People at the table. A table expires after at most 24 hours.',
            ],
            [
              '**Push notifications** (only if you switch them on in your settings and the site operator has set them up): an address and encryption keys for your browser or device, issued by its push service.',
              'To tell you about invites when the app is closed.',
              'Nobody. Turning notifications off, or the push service reporting the device gone, removes it.',
            ],
            [
              '**Technical data**: your IP address and request details are handled by Cloudflare to deliver the site and by the GameHub server to apply rate limits (held in memory, not written to the database). Server logs may include request details.',
              'Delivering the site, preventing abuse, fixing faults.',
              'The site operator and Cloudflare.',
            ],
          ],
        },
      },
      'We do not collect your precise location, contacts, camera or microphone, and the site switches those browser features off.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies and on-device storage',
    body: [
      'GameHub uses only what it needs to work. There are no advertising or analytics cookies.',
      {
        table: {
          head: ['Name', 'What it does', 'How long'],
          rows: [
            ['`hyd_session` (cookie)', 'Keeps you signed in, guests included. It is HttpOnly (scripts cannot read it) and sent only to GameHub.', 'Up to 30 days, or until you sign out'],
            ['`hyd_token` (local storage)', 'Used instead of the cookie only when the app is hosted on a different address from its server.', 'Until you sign out'],
            ['`hyd.settings.v1`, `hyd.profile.v1`, `hb.odds`', 'Your choices on this device: sound, volume, theme, motion, playback speed, and a local copy of profile numbers.', 'Until you clear site data'],
            ['`hub.levels.v1`, `gh.badges.seen.v1`, `hyd:notify:*`', 'Which level-ups and badges you have already seen, and which coming-soon games you asked to be told about.', 'Until you clear site data'],
            ['`hub.visits.v1`, `hub.install.dismissed.v1` (and a short-lived session flag)', 'Decides when to offer “install the app” and remembers if you said no.', 'Until you clear site data'],
          ],
        },
      },
      'GameHub’s fonts and images are served from GameHub itself, so no third-party font or image service learns that you visited.',
      'When the Google sign-in button is shown, your browser loads Google’s sign-in script from `accounts.google.com`. Google may set its own cookies and receives technical information such as your IP address; that is covered by Google’s privacy policy, not this one. If you never open sign-in, or use guest play, you can avoid it.',
      'The installed app uses a service worker (`sw.js`). It delivers push notifications and shows a simple offline page when you have no connection. It does not store your account data, game state or API responses.',
    ],
  },
  {
    id: 'processors',
    title: 'Who handles data for us',
    body: [
      'We use these providers to run GameHub. They process data on our behalf and under their own terms.',
      {
        ul: [
          '**Cloudflare**: serves the site, runs the server code and the live game tables (Workers and Durable Objects), and keeps live table state for up to 24 hours.',
          '**Neon**: the Postgres database that stores accounts, friends, match history and the table listing.',
          '**Google**: sign-in, only when you choose “Sign in with Google”.',
          '**Browser push services** (Google, Mozilla, Microsoft or Apple, depending on your browser): only if you switch on notifications.',
        ],
      },
      'Those providers may store data in data centres outside your country. We do not share your data with anyone else, except where the law requires it.',
    ],
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: [
      {
        ul: [
          '**Account and progress**: for as long as your account exists. At the time of writing there is no automatic expiry for accounts, guest accounts or match history; to have yours removed, ask us (see “Your choices”).',
          '**Sign-in session**: up to 30 days.',
          '**Tables**: a table’s live state is deleted when the table expires (at most 24 hours; an empty lobby much sooner).',
          '**Invites**: shown for two hours, then cleared.',
          '**Chat**: not stored; it exists only while the table is open.',
          '**Server logs**: kept by Cloudflare according to its own retention.',
        ],
      },
      'Deleting an account unlinks its finished-game records from it, but the display name saved on a finished game’s record can remain, because that record is also part of the other players’ history.',
    ],
  },
  {
    id: 'choices',
    title: 'Your choices and rights',
    body: [
      'Depending on where you live, data-protection law may give you rights over your information: to know what we hold, to correct it, to have it deleted, to object to or restrict its use, to move it, and to withdraw consent you gave.',
      {
        ul: [
          '**Change your name or avatar** any time in [Profile](/profile).',
          '**Sign out** from [Profile](/profile); that clears the session cookie on this device.',
          '**Turn off notifications** in your settings, or in your browser’s site settings.',
          '**Clear on-device data** with your browser’s “clear site data”.',
          '**Revoke Google access** in your Google Account’s security settings; GameHub never sees your Google password.',
          '**Ask for a copy, a correction or deletion of your account** by contacting us. There is no self-service delete button yet.',
        ],
      },
      { contact: 'Contact us about your data:' },
      'If you are not happy with how we handle a request, you can complain to the data-protection authority where you live.',
    ],
  },
  {
    id: 'children',
    title: 'Children',
    body: [
      'GameHub is not designed for children under 13 and we do not knowingly collect their personal information. If you are under 18, please play with a parent or guardian’s knowledge and permission. If you believe a child has given us personal information, contact us and we will delete it.',
    ],
  },
  {
    id: 'security',
    title: 'Security',
    body: [
      'Connections to GameHub use HTTPS. The session cookie is HttpOnly. Inputs are validated on the server, database queries are parameterised, and secrets are kept out of the code. No online service can promise perfect security; if something goes wrong that affects you, we will tell you what happened and what to do.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: [
      `We will update this page when GameHub starts handling data differently, and change the “last updated” date at the top (currently ${LEGAL_UPDATED.label}). If a change matters to you, such as a new kind of data or a new provider, we will say so in the app as well.`,
      'For how GameHub may be used, see the [Terms](/terms). For how to play and fix problems, see [Help](/help).',
    ],
  },
];

export default function Privacy() {
  return (
    <LegalPage
      eyebrow="Your data"
      title="Privacy"
      lead="What GameHub keeps about you, why, who can see it, and how to take control. Written to be read."
      description="What GameHub collects, how it is used, who can see it, how long it is kept, and how to ask for access, correction or deletion."
      meta={[`Last updated ${LEGAL_UPDATED.label}`, 'No ads, no tracking scripts']}
      sections={SECTIONS.map((s) => ({ ...s, body: <Blocks blocks={s.body} /> }))}
    />
  );
}

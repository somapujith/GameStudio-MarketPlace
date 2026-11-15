import { Link } from 'react-router-dom';
import { Avatar } from '@/components/art/index.js';
import AutoMascot from '@/components/art/AutoMascot.jsx';
import { paths } from '@/platform/paths.js';
import SIcon from './SIcon.jsx';

const PERKS = [
  ['users', 'See who is online right now'],
  ['table', 'Invite a friend to your table in one tap'],
  ['mail', 'Invites wait for you, even when you were offline'],
];

/** Signed-out and guest gate for /friends. `guest` = a guest session exists. Returns here after sign-in. */
export default function FriendsGate({ guest }) {
  const here = paths.friends() + (typeof window !== 'undefined' ? window.location.search : '');
  return (
    <div className="hub-page sc-page st-scope sc-gatepage">
      <section className="sc-gate st-reveal" aria-labelledby="sc-gate-h">
        <div className="sc-gate__art hub-moment-friends" aria-hidden="true">
          <span className="sc-gate__ava sc-gate__ava--a">
            <Avatar preset={3} size={46} />
          </span>
          <AutoMascot mood="welcome" size={112} />
          <span className="sc-gate__ava sc-gate__ava--c">
            <Avatar preset={10} size={46} />
          </span>
        </div>
        <span className="st-eyebrow">Friends</span>
        <h1 id="sc-gate-h" className="sc-gate__title">
          {guest ? 'Friends are for Google accounts' : 'Sign in to add friends'}
        </h1>
        <p className="sc-gate__text">
          {guest
            ? 'Guests can host and join rooms with a code or link. Sign in with Google to keep friends across devices.'
            : 'Play with the same people again and again, without swapping room codes every time.'}
        </p>
        <ul className="sc-perks">
          {PERKS.map(([icon, text]) => (
            <li key={text}>
              <span className="sc-perks__icon" aria-hidden="true">
                <SIcon name={icon} size={17} />
              </span>
              {text}
            </li>
          ))}
        </ul>
        <div className="sc-gate__actions">
          <Link to={paths.login(here)} className="hub-btn hub-btn--primary hub-btn--lg">
            {guest ? 'Sign in with Google' : 'Sign in'}
          </Link>
          <Link to={paths.join()} className="hub-btn hub-btn--ghost hub-btn--lg">
            Join a room with a code
          </Link>
        </div>
      </section>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';

const STEPS = [
  { icon: 'gamepad', title: 'Pick a game', text: 'Choose a game and how many players.' },
  { icon: 'hash', title: 'Share a code', text: 'Send the table code to your friends on WhatsApp.' },
  { icon: 'play', title: 'Play together', text: 'Everyone joins from their own phone. No download.' },
];

/** First-run value proposition for a visitor with no session: how it works in 3 steps + Sign in / Play as guest. */
export default function HowItWorks() {
  return (
    <section className="sh-how" aria-labelledby="sh-how-h">
      <div className="sh-how__intro">
        <span className="st-eyebrow">How it works</span>
        <h2 id="sh-how-h" className="st-head__title">
          Play with friends in three steps
        </h2>
        <div className="sh-how__cta">
          <Link to={paths.login(paths.hub())} className="hub-btn hub-btn--primary">
            Sign in
          </Link>
          <Link to={paths.login(paths.hub())} className="hub-btn hub-btn--soft">
            Play as guest
          </Link>
        </div>
      </div>
      <ol className="sh-how__steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="sh-step">
            <span className="sh-step__n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="sh-step__ico" aria-hidden="true">
              <HubIcon name={s.icon} size={22} />
            </span>
            <b>{s.title}</b>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

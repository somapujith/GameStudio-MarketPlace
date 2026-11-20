import { BRAND } from '@/platform/brand.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { allGames } from './catalog.js';

/** About & credits. A game can add its own lines with an optional manifest `credits` (string or string[]). */
export default function AboutSection() {
  const gameCredits = allGames()
    .filter((g) => g.status === 'live' && g.credits)
    .map((g) => ({ id: g.id, name: g.name, lines: [].concat(g.credits).filter(Boolean) }));

  return (
    <section className="hub-panel hh2-about" aria-labelledby="hh2-about-h">
      <h2 id="hh2-about-h" className="hub-section__title">
        <HubIcon name="info" size={18} /> About &amp; credits
      </h2>
      <p>
        <b>{BRAND.name}</b> brings a Hyderabadi street spirit to multiplayer games. A fan-made, non-commercial place to play. Bring your people. Ek aur round?
      </p>
      {gameCredits.map((g) => (
        <div key={g.id} className="hh2-about__game">
          <b>{g.name}</b>
          {g.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      ))}
      <p className="hub-muted">Built with React and Vite. System fonts. Original Jalebi Games logo and mascot. Made with masala.</p>
    </section>
  );
}

// The start screen: neon title, tagline, a big START SHIFT button, a compact controls legend, quality and sound. The world runs
// behind it (the auto is held by ctx.openMenu('start')).
import { useEffect, useRef, useState } from 'react';
import { START_KEYS, START_TOUCH } from './controls.js';
import { focusFirst, useMenuInput } from './useMenuInput.js';
import { useMenuLayout } from './menuLayout.js';
import './sheet.css';
import './landscape.css';
import { QUALITIES, qualityLabel } from './menuNav.js';
import { readSettings, saveSettings } from './settings.js';
import { qualityInfo } from './PausePanels.jsx';
import { formatRupees } from '../hud/hudLogic.js';
import { useTouchMode } from '../hud/touchMode.js';
import { VolumeIcon } from '../hud/icons.jsx';

export default function StartScreen({ game, snap, onStart, onHub }) {
  const root = useRef(null);
  const touch = useTouchMode();
  const layout = useMenuLayout();
  const [, bump] = useState(0);
  const st = readSettings(game);
  useMenuInput(root, { active: true, onStart });
  useEffect(() => {
    focusFirst(root.current, '[data-autofocus]');
  }, []);
  const p = game.ctx.profile.data;
  const info = qualityInfo(game, snap, st.quality);

  return (
    <div className="aw-menu aw-start" ref={root} data-layout={layout} role="dialog" aria-modal="true" aria-label="Autowala">
      <div className="aw-start__bg" />
      <div className="aw-start__card">
        <div className="aw-start__hero">
        <p className="aw-start__eyebrow">JALEBI GAMES PRESENTS</p>
        <h1 className="aw-title">
          <span className="aw-title__en">AUTOWALA</span>
          <span className="aw-title__te aw-te">ఆటోవాలా</span>
        </h1>
        <p className="aw-start__tag">Pick up sawaris. Beat the meter. Rule the roads of Hyderabad.</p>

        <button type="button" data-nav data-autofocus className="aw-go" onClick={onStart}>
          <span>START SHIFT</span>
          <small className="aw-te">షిఫ్ట్ మొదలు</small>
        </button>
        <p className="aw-start__hint">{touch ? 'Tap to start' : 'Press Enter or Space'}</p>
        </div>

        <div className="aw-start__side">
        <div className="aw-start__cols">
          <section className="aw-start__box" aria-label="Controls">
            <h2>CONTROLS</h2>
            {touch ? (
              <ul className="aw-keys">
                {START_TOUCH.map((r) => (
                  <li key={r.who}><b>{r.who}</b><em>{r.what}</em></li>
                ))}
              </ul>
            ) : (
              <ul className="aw-keys">
                {START_KEYS.map((r) => (
                  <li key={r.what}>
                    <span>
                      {r.keys.map((k) => (
                        <span className="aw-key" key={k}>{k}</span>
                      ))}
                    </span>
                    <em>{r.what}</em>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="aw-start__box" aria-label="Settings">
            <h2>SETTINGS</h2>
            <div className="aw-setrow">
              <span>Quality</span>
              <div className="aw-seg" role="group" aria-label="Quality">
                {QUALITIES.map((q) => (
                  <button
                    key={String(q)}
                    type="button"
                    data-nav
                    className={st.quality === q ? 'is-on' : ''}
                    aria-pressed={st.quality === q}
                    onClick={() => {
                      saveSettings(game, { quality: q });
                      bump((n) => n + 1);
                    }}
                  >
                    {qualityLabel(q)}
                  </button>
                ))}
              </div>
            </div>
            <p className={`aw-setnote${info.reload ? ' is-warn' : ''}`} aria-live="polite">
              {info.note}
              {info.reload && (
                <button type="button" data-nav className="aw-linkbtn aw-setnote__btn" onClick={() => window.location.reload()}>
                  Reload now
                </button>
              )}
            </p>
            <div className="aw-setrow">
              <span>Sound</span>
              <button
                type="button"
                data-nav
                className={`aw-soundbtn ${st.sound ? 'is-on' : ''}`}
                aria-pressed={st.sound}
                onClick={() => {
                  saveSettings(game, { sound: !st.sound });
                  bump((n) => n + 1);
                }}
              >
                <VolumeIcon size={16} off={!st.sound} />
                {st.sound ? 'On' : 'Off'}
              </button>
            </div>
          </section>
        </div>

        <p className="aw-credit">
          Voices are AI-generated
          <span className="aw-te">స్వరాలు AI తో తయారు చేయబడ్డాయి</span>
        </p>
        <footer className="aw-start__foot">
          <span>
            Wallet <b>{formatRupees(p.wallet)}</b> &middot; {p.rides} {p.rides === 1 ? 'ride' : 'rides'}
          </span>
          <button type="button" data-nav className="aw-linkbtn" onClick={onHub}>
            Back to hub
          </button>
        </footer>
        </div>
      </div>
    </div>
  );
}

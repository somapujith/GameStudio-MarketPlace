// Pause (solo) and the co-op "leave your seat" confirm. Both are modal layers inside the game root: focus is trapped, Esc steps back.
// The pause menu also holds the player's settings: spoken language, subtitle style, customer voices (saved on this device) and the controls.
import { useEffect, useRef, useState } from 'react';
import { KEY_HELP } from '../hud/look.js';
import { LANG_OPTIONS, SUB_OPTIONS, readSynthPref, usePrefs, voiceNotice, writeSynthPref } from '../hud/prefs.js';
import { useDialog } from './hooks.js';
import { useFullscreen } from '../hud/mobileUi.js';
import { useTouchDevice } from '@/lib/mobile.js';
import GraphicsSetting from './GraphicsSetting.jsx';
import Segmented from './Segmented.jsx';
import './menus.css';

function ControlsHelp() {
  return (
    <div className="tc-menu-controls">
      {[['Keyboard', KEY_HELP.keyboard], ['Touch', KEY_HELP.touch]].map(([name, rows]) => (
        <section key={name} aria-label={name}>
          <h4>{name}</h4>
          <dl>
            {rows.map((r) => (
              <div key={r.what}>
                <dt>{r.keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
                <dd>{r.what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** What leaving does, in words that are true: a solo shift and the tutorial are SAVED (the home screen offers Resume), a co-op seat ends. */
export function leaveCopy(mode) {
  if (mode === 'tutorial') return 'Leave the stall? You can continue the tutorial later.';
  if (mode === 'online') return 'Leave the stall? Your seat at the table ends.';
  return 'Leave the stall? Your shift is saved: resume it from the home screen.';
}

/**
 * Solo pause: "Chai break". LANDSCAPE: the buttons are the left column, the settings the right one (menus.css), so a 360 px tall phone shows Resume and the switches at once. Props: { open, onResume, onRestart, onQuit, muted, onMute(next: boolean), audio? }.
 * `mode` ('practice' | 'tutorial' | 'online') only words the Leave confirm. Restart asks once more before it throws the shift away; Leave saves it. `audio` (optional) lets the voices switch say when a language has no
 * voice on this device (audio.isSpeechAvailable(lang) / audio.speech.isAvailable(lang)). The Graphics section picks the quality tier (saved on this device, applied the next time the stall opens);
 * `tierInfo` (optional: scene.getTierInfo() or a function returning it) lets it say which tier is running now.
 */
export default function PauseMenu({ open = false, onResume, onRestart, onQuit, muted = false, onMute, audio = null, mode = 'practice', tierInfo = null }) {
  const root = useRef(null);
  const [ask, setAsk] = useState(null); // null | 'restart' | 'quit'
  const [prefs, setPrefs] = usePrefs();
  const [robot, setRobot] = useState(() => readSynthPref());
  const fullscreen = useFullscreen();
  const touch = useTouchDevice();
  useDialog(root, {
    active: open,
    onEscape: () => (ask ? setAsk(null) : onResume?.()),
  });
  useEffect(() => {
    if (open) root.current?.querySelector('[data-autofocus]')?.focus?.({ preventScroll: true });
  }, [ask, open]);
  if (!open) return null;
  const confirm = ask === 'restart' ? { text: 'Restart this shift? Today\'s tally so far is lost.', yes: 'Restart shift', run: onRestart } : ask === 'quit' ? { text: leaveCopy(mode), yes: 'Leave', run: onQuit } : null;
  const note = voiceNotice(prefs, audio);

  return (
    <div className="tc-menu tc-menu-layer tc-menu-pause" ref={root} role="dialog" aria-modal="true" aria-labelledby="tc-pause-h" tabIndex={-1}>
      <div className="tc-menu-panel tc-menu-panel--tin tc-menu-pause__panel">
        <h2 id="tc-pause-h" className="tc-menu-paint">Chai break</h2>
        <p className="tc-menu-lede">The stall is on hold. Nobody walks away while you sip.</p>
        {confirm ? (
          <div className="tc-menu-confirm" role="alertdialog" aria-label="Confirm">
            <p>{confirm.text}</p>
            <div className="tc-menu-stack">
              <button type="button" className="tc-menu-btn tc-menu-btn--plank" data-autofocus onClick={() => setAsk(null)}>Keep playing</button>
              <button type="button" className="tc-menu-btn tc-menu-btn--danger" onClick={() => confirm.run?.()}>{confirm.yes}</button>
            </div>
          </div>
        ) : (
          <div className="tc-menu-pause__cols">
            <div className="tc-menu-stack">
              <button type="button" className="tc-menu-btn tc-menu-btn--steel tc-menu-btn--primary tc-menu-btn--big" data-autofocus onClick={() => onResume?.()}>Resume</button>
              <button type="button" className="tc-menu-btn tc-menu-btn--plank" onClick={() => setAsk('restart')}>Restart shift</button>
              <button type="button" className="tc-menu-btn tc-menu-btn--plank" role="switch" aria-checked={!!muted} onClick={() => onMute?.(!muted)}>
                Sound: {muted ? 'off' : 'on'}
              </button>
              {touch && fullscreen.supported && (
                <button type="button" className="tc-menu-btn tc-menu-btn--plank" role="switch" aria-checked={fullscreen.active} onClick={fullscreen.toggle}>
                  Fullscreen: {fullscreen.active ? 'on' : 'off'}
                </button>
              )}
              <button type="button" className="tc-menu-btn tc-menu-btn--ghost" onClick={() => setAsk('quit')}>Leave the stall</button>
            </div>
            <div className="tc-menu-pause__set">
            <details className="tc-menu-set" open>
              <summary>Customers talk</summary>
              <div className="tc-menu-set__body">
                <p className="tc-menu-set__h" id="tc-set-lang">Language</p>
                <Segmented wrap label="Customer language" options={LANG_OPTIONS} value={prefs.lang} onChange={(lang) => setPrefs({ lang })} />
                <p className="tc-menu-set__h" id="tc-set-subs">Subtitles</p>
                <Segmented wrap label="Subtitles" options={SUB_OPTIONS} value={prefs.subs} onChange={(subs) => setPrefs({ subs })} />
                <button type="button" className="tc-menu-btn tc-menu-btn--sm" role="switch" aria-checked={!!prefs.voices} onClick={() => setPrefs({ voices: !prefs.voices })}>
                  Voices: {prefs.voices ? 'on' : 'off'}
                </button>
                {typeof audio?.setSynthEnabled === 'function' && (
                  <button
                    type="button"
                    className="tc-menu-btn tc-menu-btn--sm"
                    role="switch"
                    aria-checked={robot}
                    aria-label={`Robot voices for lines without a recording: ${robot ? 'on' : 'off'}`}
                    disabled={!prefs.voices}
                    onClick={() => {
                      const next = writeSynthPref(!robot);
                      setRobot(next);
                      audio.setSynthEnabled(next);
                    }}
                  >
                    Robot voices for lines without a recording: {robot ? 'on' : 'off'}
                  </button>
                )}
                {note && <p className="tc-menu-set__note" role="note">{note}</p>}
              </div>
            </details>
            <details className="tc-menu-set" data-set="graphics">
              <summary>Graphics</summary>
              <div className="tc-menu-set__body"><GraphicsSetting tierInfo={tierInfo} idPrefix="tc-pause-gfx" /></div>
            </details>
            <details className="tc-menu-set">
              <summary>Controls</summary>
              <div className="tc-menu-set__body"><ControlsHelp /></div>
            </details>
            </div>
          </div>
        )}
        <p className="tc-menu-keys" aria-hidden="true"><kbd>Esc</kbd> {ask ? 'back' : 'resume'}</p>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cosmeticById } from '@shared/cosmetics.js';
import { ANIM_MS } from '@shared/timing.js';
import { sfx } from '@/lib/sfx.js';
import { motionPermission, requestMotionPermission, startShakeListener } from '@/lib/shake.js';
import { useSettings } from '@/lib/storage.js';
import { buildActionSpec } from './ActionBar.jsx';
import { useReducedMotion } from './ui/helpers.js';
import {
  PRIME_LIFT,
  burstParticles,
  faceShades,
  frontFace,
  newSeed,
  primeFrames,
  restTransform,
  settleFrames,
  skidEnd,
  tumbleFrames,
  tumblePlan,
} from './diceMotion.js';
import '@/styles/dice.css';

/**
 * CSS variables for a dice skin (a `dice` cosmetic id from @shared/cosmetics.js): colors = [face, pip, edge].
 * Unknown ids, other kinds and no skin -> null (the default ivory die).
 */
export function diceSkinStyle(skin) {
  const item = skin ? cosmeticById(skin) : null;
  if (!item || item.kind !== 'dice' || !Array.isArray(item.colors) || item.colors.length < 3) return null;
  const [face, pip, edge] = item.colors;
  return { '--die-face': face, '--die-pip': pip, '--die-edge': edge };
}

// pip cells on a 3x3 grid as [row, col]
const PIPS = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
};

function PipGrid({ value }) {
  return (PIPS[value] || []).map(([r, c]) => <i className="cp-pip" key={`${r}${c}`} style={{ gridRow: r, gridColumn: c }} />);
}

// ---- 3D cube ---------------------------------------------------------------
// Orientation maths, keyframes and the burst layout are pure and live in ./diceMotion.js (unit tested).

const canAnimate = (el) => !!el && typeof el.animate === 'function';
const poseOf = (el) => {
  const t = typeof getComputedStyle === 'function' ? getComputedStyle(el).transform : '';
  return t && t !== 'none' ? t : 'rotateX(0deg)';
};

const POP_MS = 1000; // the result pop (numeral + face glow)
const RIBBON_MS = 2600; // "Roll again!" after a six
let popId = 0;

function Die3D({ value, rolling, reduced, tumbleMs, settleMs, primed, ready, tapProps }) {
  const root = useRef(null);
  const cube = useRef(null);
  const air = useRef(null);
  const shadow = useRef(null);
  const seed = useRef(null);
  if (!seed.current) seed.current = newSeed();
  const plan = useRef(null);
  const anims = useRef([]);
  const token = useRef(0);
  const tumbling = useRef(false);
  const mounted = useRef(false);
  const shown = useRef(null); // the value the cube currently rests on
  const timers = useRef([]);
  const [result, setResult] = useState(null); // { id, value, six } while the result pop plays
  const [ribbon, setRibbon] = useState(0); // id of the "Roll again!" ribbon while it shows
  const burst = useMemo(() => (result?.six ? burstParticles(6) : null), [result?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPhase = (p) => {
    if (root.current) root.current.dataset.phase = p;
  };
  const stopAll = () => {
    token.current += 1;
    anims.current.forEach((a) => { try { a.cancel(); } catch { /* already gone */ } });
    anims.current = [];
    [cube.current, air.current].forEach((el) => { if (el) el.style.willChange = ''; });
  };
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  };
  const run = (el, frames, opts) => {
    if (!canAnimate(el)) return null;
    const a = el.animate(frames, opts);
    anims.current.push(a);
    return a;
  };
  /** Lay the face shades for a resting die (faces turned to the light stay bright). */
  const shade = (v, neutral = false) => {
    const el = cube.current;
    if (!el) return;
    const s = neutral ? null : faceShades(v, seed.current);
    const front = neutral ? 0 : frontFace(v, seed.current);
    el.querySelectorAll('.cp-face').forEach((f) => {
      const n = Number(f.dataset.face);
      f.style.setProperty('--sh', s ? String(s[n]) : '0.12');
      if (n === front) f.dataset.front = '1';
      else delete f.dataset.front;
    });
  };

  /** The result pop for a number that just showed (and the burst + ribbon for a six). */
  const showResult = (v) => {
    if (!(v > 0)) return;
    const id = ++popId;
    const six = v === 6;
    setResult({ id, value: v, six });
    later(() => setResult((r) => (r && r.id === id ? null : r)), POP_MS + 200);
    if (six) {
      setRibbon(id);
      later(() => setRibbon((r) => (r === id ? 0 : r)), RIBBON_MS);
    }
  };

  useEffect(() => () => {
    stopAll();
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the roll: tumble while `rolling`, settle on the exact face when it ends ----------------------------
  useLayoutEffect(() => {
    const el = cube.current;
    if (!el) return;

    const startTumble = () => {
      const wasPrimed = root.current?.dataset.phase === 'primed';
      tumbling.current = true;
      stopAll();
      const from = poseOf(el);
      plan.current = tumblePlan();
      const frames = tumbleFrames(plan.current, { from, startY: wasPrimed ? PRIME_LIFT : 0 });
      const opts = { duration: Math.max(240, tumbleMs), fill: 'forwards', easing: 'linear' };
      if (air.current) air.current.style.willChange = 'transform';
      el.style.willChange = 'transform';
      run(air.current, frames.air, opts);
      run(shadow.current, frames.shadow, opts);
      run(el, frames.cube, opts);
      setPhase('tumble');
      shade(0, true);
      setResult(null);
      setRibbon(0);
    };

    const land = () => {
      tumbling.current = false;
      const cur = poseOf(el);
      stopAll();
      seed.current = newSeed();
      const to = restTransform(value, seed.current);
      el.style.transform = to;
      shown.current = value;
      shade(value);
      showResult(value);
      const p = plan.current || tumblePlan();
      if (reduced || settleMs <= 16 || !canAnimate(el)) {
        setPhase('idle');
        return;
      }
      const frames = settleFrames({ from: cur, to, skidX: skidEnd(p), wobSign: p.wob });
      const opts = { duration: settleMs, fill: 'none' };
      const mine = token.current;
      if (air.current) air.current.style.willChange = 'transform';
      el.style.willChange = 'transform';
      run(air.current, frames.air, opts);
      run(shadow.current, frames.shadow, opts);
      const a = run(el, frames.cube, opts);
      setPhase('settle');
      const done = () => {
        if (token.current !== mine) return;
        stopAll();
        setPhase('idle');
      };
      if (a) a.onfinish = done;
      else done();
    };

    if (rolling && !reduced) {
      if (!tumbling.current) startTumble();
      return;
    }
    if (tumbling.current) {
      land();
      return;
    }
    // first paint, or the value changed without a roll animation: put the cube on its face
    if (!mounted.current) {
      mounted.current = true;
      shown.current = value;
      el.style.transform = restTransform(value, seed.current);
      shade(value);
      return;
    }
    if (shown.current !== value) {
      const cur = poseOf(el);
      stopAll();
      seed.current = newSeed();
      const to = restTransform(value, seed.current);
      el.style.transform = to;
      shown.current = value;
      shade(value);
      if (canAnimate(el)) {
        const mine = token.current;
        const a = reduced
          ? run(el, [{ opacity: 0.25 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' })
          : run(el, [{ transform: cur }, { transform: to }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
        if (a) a.onfinish = () => { if (token.current === mine) stopAll(); };
      }
      showResult(value);
    }
  }, [rolling, value, reduced, tumbleMs, settleMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- anticipation: the roll is on its way to the server (a tap, the Roll button or Space) ----------------
  useEffect(() => {
    const el = cube.current;
    if (!el || reduced || tumbling.current || !canAnimate(el)) return undefined;
    if (primed && !rolling) {
      if (root.current?.dataset.phase === 'primed') return undefined;
      stopAll();
      const f = primeFrames(Math.random() < 0.5 ? -1 : 1);
      const from = poseOf(el);
      if (air.current) air.current.style.willChange = 'transform';
      el.style.willChange = 'transform';
      run(air.current, f.air, { duration: 150, fill: 'forwards' });
      run(shadow.current, f.shadow, { duration: 150, fill: 'forwards' });
      run(el, f.wobble(from), { duration: 130, iterations: Infinity, direction: 'alternate' });
      setPhase('primed');
      return undefined;
    }
    if (!primed && root.current?.dataset.phase === 'primed') {
      // it was not a roll after all (turn ended / error): drop the die back gently
      stopAll();
      run(air.current, [{ transform: `translate(0%, ${(PRIME_LIFT * 100).toFixed(1)}%)` }, { transform: 'translate(0%, 0%)', easing: 'cubic-bezier(.55,0,.85,.4)' }], { duration: 160 });
      setPhase('idle');
    }
    return undefined;
  }, [primed, rolling, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const cls = `cp-die3d${result ? ' is-glow' : ''}${ready ? ' is-ready' : ''}`;
  return (
    <span className={cls} ref={root} style={{ '--cp-die-settle': `${settleMs}ms` }} {...tapProps}>
      <i className="cp-die3d__halo" />
      <span className="cp-die3d__shadow" ref={shadow} />
      <span className="cp-die3d__float">
        <span className="cp-die3d__air" ref={air}>
          <span className="cp-cube" ref={cube}>
            <span className="cp-core cp-core--a" />
            <span className="cp-core cp-core--b" />
            <span className="cp-core cp-core--c" />
            {[1, 2, 3, 4, 5, 6].map((f) => (
              <span className={`cp-face cp-face--${f}`} key={f} data-face={f}>
                <PipGrid value={f} />
              </span>
            ))}
          </span>
        </span>
      </span>
      <i className="cp-die3d__twinkle" />
      {result ? <b key={`pop${result.id}`} className="cp-die3d__pop" aria-hidden="true">{result.value}</b> : null}
      {burst ? (
        <span key={`burst${result.id}`} className="cp-die3d__burst" aria-hidden="true">
          <i className="cp-die3d__ring" />
          {burst.map((p, i) => (
            <i
              key={i}
              className={`cp-spark cp-spark--${p.tone}`}
              style={{ '--dx': p.dx, '--dy': p.dy, '--sz': p.size, '--dl': `${p.delay}ms` }}
            />
          ))}
        </span>
      ) : null}
      {ribbon ? <span key={`rib${ribbon}`} className="cp-die3d__ribbon" aria-hidden="true">Roll again!</span> : null}
    </span>
  );
}

const ASSIST_NOTE = { comeback: 'Comeback boost', mercy: 'Mercy rule', pity: 'A bonus roll was due', antibust: 'Anti-bust' };

const MODE_LABEL = {
  lucky: 'Lucky dice: a small, bounded nudge that helps players who are behind',
  fair: 'Fair dice: pure luck, no help for anyone',
};

/** The dice mode of the table (`view.cfg.dice`; lucky unless the host chose fair). */
const diceMode = (session) => {
  const m = session?.view?.cfg?.dice ?? session?.display?.cfg?.dice;
  return m === 'fair' ? 'fair' : m === 'lucky' ? 'lucky' : null;
};

/** Little glyph for the dice mode: a clover for lucky dice, a balance for fair dice. */
function ModeGlyph({ mode }) {
  return mode === 'fair' ? (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path d="M12 4v15M7 20h10M12 6.5 5 8m7-1.5L19 8M5 8l-2.4 5.6a3 3 0 0 0 4.8 0L5 8Zm14 0-2.4 5.6a3 3 0 0 0 4.8 0L19 8Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path d="M12 11.5C10.6 8.4 7.4 7.8 6.3 9.6c-1.2 1.9.3 3.6 2.2 3.6C6.3 13.2 4.8 14.6 5.8 16.3c1.2 1.8 4.1 1.1 6.2-1.8 2.1 2.9 5 3.6 6.2 1.8 1-1.7-.5-3.1-2.7-3.1 1.9 0 3.4-1.7 2.2-3.6-1.1-1.8-4.3-1.2-5.7 1.9Z" fill="currentColor" opacity=".92" />
      <path d="M12 12.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Small "Lucky dice" badge, shown when the game uses lucky dice (`view.cfg.dice === 'lucky'`). */
export function LuckyBadge({ session }) {
  const mode = session?.view?.cfg?.dice ?? session?.display?.cfg?.dice;
  if (mode !== 'lucky') return null;
  return (
    <span className="cp-lucky" title="Lucky dice: a small, bounded nudge that helps players who are behind">
      Lucky dice <span aria-hidden="true">🍀</span>
    </span>
  );
}

/** The die as the last roll left it (0 = not rolled yet). */
const shownDie = (session) => Math.round(Number((session?.display?.dice || session?.view?.dice || [0])[0])) || 0;

/** The number to feed rent previews (utilities pay a multiple of the die): the last roll, else a typical 4. */
export const dieValue = (session) => shownDie(session) || 4;

/** The ROLL action when it is the local player's turn to roll (not Traffic Jam choices, not a pending decision). */
function rollAction(session) {
  try {
    if (!session?.view || !session.me || session.view.players?.[session.view.turn]?.id !== session.me) return null;
    const spec = buildActionSpec(session);
    return spec.kind === 'roll' && spec.primary?.action?.type === 'ROLL' ? spec.primary.action : null;
  } catch {
    return null;
  }
}

const PRIME_HOLD_MS = 1500; // how long the die waits (lifted) for the server's answer
const PRIME_DELAY_MS = 90; // a button press that is not a roll (End turn) ends before this shows

/**
 * The one presentational die: a 3D cube that wobbles when you press Roll, tumbles for ANIM_MS.dice at the playback speed
 * (display.diceMs), lands on exactly the server's value and pops the number. On your turn it can be tapped (and, if
 * Settings > Shake to roll is on, shaken) to roll. `skin` = an optional dice cosmetic id (the roller's equipped skin);
 * the settle timing comes from the presenter.
 */
export function Dice({ session, skin = null }) {
  const reduced = useReducedMotion();
  const [settings] = useSettings();
  const rolling = !!session?.rolling;
  const value = shownDie(session);
  const assist = session?.display?.assist || null;
  const settleMs = session?.display?.diceSettleMs ?? 560;
  const tumbleMs = session?.display?.diceMs ?? ANIM_MS.dice;
  const mode = diceMode(session);

  const action = rollAction(session);
  const canRoll = !!action && !rolling;

  // ---- anticipation: primed from the moment the roll is requested until the server's tumble starts ----
  const [primed, setPrimed] = useState(false);
  const wasReady = useRef(false);
  const primeTimers = useRef([]);
  const clearPrimeTimers = () => { primeTimers.current.forEach(clearTimeout); primeTimers.current = []; };
  const prime = useCallback((delay = 0) => {
    clearPrimeTimers();
    const start = () => {
      setPrimed(true);
      primeTimers.current.push(setTimeout(() => setPrimed(false), PRIME_HOLD_MS));
    };
    if (delay > 0) primeTimers.current.push(setTimeout(start, delay));
    else start();
  }, []);
  useEffect(() => {
    // "ready to roll" -> "not ready, and not rolling yet" = the roll was requested (Roll button, Space, a tap or a shake)
    if (wasReady.current && !canRoll && !rolling && !primed) prime(PRIME_DELAY_MS);
    wasReady.current = canRoll;
  }, [canRoll, rolling]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rolling) { clearPrimeTimers(); setPrimed(false); }
  }, [rolling]);
  useEffect(() => () => clearPrimeTimers(), []);

  // ---- tap the die / shake the phone ----
  const last = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const actionRef = useRef(action);
  actionRef.current = action;
  const roll = useCallback(() => {
    const a = actionRef.current;
    if (!a) return;
    const now = performance.now();
    if (now - last.current < 600) return;
    last.current = now;
    try { sfx.play('click'); } catch { /* sound is optional */ }
    prime(0);
    sessionRef.current?.dispatch?.(a);
  }, [prime]);

  // Shake to roll (Settings, off by default). iOS asks for motion access on a tap, so the first tap on the die also asks.
  const shakeOn = !!settings?.shakeToRoll && canRoll;
  const [motion, setMotion] = useState(() => motionPermission());
  useEffect(() => {
    if (shakeOn && motion === 'granted') return startShakeListener(roll);
    return undefined;
  }, [shakeOn, motion, roll]);
  const tapProps = canRoll
    ? {
        onClick: () => {
          if (shakeOn && motion === 'prompt') requestMotionPermission().then(setMotion).catch(() => {});
          roll();
        },
      }
    : null;

  let hint;
  let announce;
  if (rolling) {
    hint = 'Rolling…';
    announce = 'Rolling the die';
  } else if (value === 0) {
    hint = 'Ready to roll';
    announce = 'Die ready. Use the roll button.';
  } else {
    hint = value === 6 ? 'Six! Roll again' : `Rolled ${value}`;
    announce = `Die shows ${value}. Move ${value} ${value === 1 ? 'space' : 'spaces'}.`;
  }

  const skinStyle = diceSkinStyle(skin);

  return (
    <div
      className={`cp-dice${rolling ? ' is-rolling' : ''}${reduced ? ' is-reduced' : ''}${skinStyle ? ' has-skin' : ''}${canRoll ? ' is-ready' : ''}`}
      style={skinStyle || undefined}
      data-skin={skinStyle ? skin : undefined}
      role="group"
      aria-label="Die"
      aria-busy={rolling}
    >
      <span className="cp-dice__row" aria-hidden="true">
        <Die3D value={value} rolling={rolling} reduced={reduced} tumbleMs={tumbleMs} settleMs={settleMs} primed={primed} ready={canRoll} tapProps={tapProps} />
      </span>
      {mode ? (
        <span className={`cp-dice__mode is-${mode}`} role="img" aria-label={mode === 'fair' ? 'Fair dice' : 'Lucky dice'} title={MODE_LABEL[mode]}>
          <ModeGlyph mode={mode} />
        </span>
      ) : null}
      <span className="cp-dice__hint" aria-hidden="true">{hint}</span>
      <span className="cp-sr" role="status" aria-live="polite" aria-atomic="true">{announce}</span>
      {assist && !rolling ? <span className="cp-dice__assist" title={ASSIST_NOTE[assist] || 'Lucky help'}>Lucky help <span aria-hidden="true">✦</span></span> : null}
    </div>
  );
}

export default Dice;

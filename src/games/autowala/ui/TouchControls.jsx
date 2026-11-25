// OWNER: HUD agent. On-screen controls for phones and tablets. Props: { game }.
// Shown on coarse-pointer devices, or as soon as the player touches the screen; hidden while a menu is open.
//   LEFT: a steering slider (game.input.setStick -1..1), above the minimap in portrait, beside it in landscape.
//   RIGHT: gas and brake pedals (setTouch 'up' / 'down'), and a block of buttons: horn, drift (handbrake), boost, interact (E), camera.
// Everything is pointer events with capture, so several fingers work at once; touch-action is none, so nothing scrolls or zooms.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BoltIcon, CameraIcon, DriftIcon, HandIcon, HornIcon } from './hud/icons.jsx';
import { rawPosition, stickValue } from './hud/touchMath.js';
import { useTouchMode } from './hud/touchMode.js';
import { useGameMenu } from './hud/useGameMenu.js';
import './hud/touch.css';

const HELD = ['up', 'down', 'left', 'right', 'handbrake', 'boost'];
const prevent = (e) => e.preventDefault();
const buzz = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
};

function releaseAll(game) {
  const inp = game?.input;
  if (!inp) return;
  inp.setStick(0);
  for (const n of HELD) inp.setTouch(n, false);
}

// game/input.js treats horn / interact / talk / pause / quests as one-shot taps; 'camera' may not be one yet. Probe once: if
// setTouch('camera') queues a tap, use it; otherwise press the C key for the player (the game reads it with input.pressed).
const probed = new WeakMap();
function tapCamera(game) {
  const inp = game.input;
  if (!probed.has(inp)) {
    inp.setTouch('camera', true);
    const oneShot = inp.pressed('camera');
    inp.setTouch('camera', false);
    probed.set(inp, oneShot);
  }
  if (probed.get(inp)) inp.setTouch('camera', true);
  else for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'c' }));
}

/** A button that is "down" while a finger is on it (gas, brake, handbrake, boost). */
function HoldBtn({ game, action, label, className = '', children }) {
  const [on, setOn] = useState(false);
  const down = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    game.input.setTouch(action, true);
    setOn(true);
    buzz(6);
  };
  const up = () => {
    game.input.setTouch(action, false);
    setOn(false);
  };
  useEffect(() => () => game.input.setTouch(action, false), [game, action]);
  return (
    <button type="button" className={`aw-tc-btn ${className} ${on ? 'is-on' : ''}`} aria-label={label} onPointerDown={down} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={prevent}>
      {children}
    </button>
  );
}

/** A button that fires once per touch (horn, interact, camera). */
function TapBtn({ game, label, className = '', onTap, children }) {
  const [on, setOn] = useState(false);
  const down = (e) => {
    e.preventDefault();
    setOn(true);
    onTap(game);
    buzz(10);
  };
  return (
    <button type="button" className={`aw-tc-btn ${className} ${on ? 'is-on' : ''}`} aria-label={label} onPointerDown={down} onPointerUp={() => setOn(false)} onPointerCancel={() => setOn(false)} onPointerLeave={() => setOn(false)} onContextMenu={prevent}>
      {children}
    </button>
  );
}

function SteerSlider({ game }) {
  const track = useRef(null);
  const knob = useRef(null);
  const [active, setActive] = useState(false);
  const place = (x) => {
    const rect = track.current.getBoundingClientRect();
    game.input.setStick(stickValue(x, rect));
    const half = rect.width / 2 - 28; // knob radius
    if (knob.current) knob.current.style.transform = `translateX(${(rawPosition(x, rect) * half).toFixed(1)}px)`;
  };
  const down = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setActive(true);
    place(e.clientX);
  };
  const move = (e) => {
    if (active) place(e.clientX);
  };
  const up = () => {
    setActive(false);
    game.input.setStick(0);
    if (knob.current) knob.current.style.transform = 'translateX(0px)';
  };
  useEffect(() => () => game.input.setStick(0), [game]);
  return (
    <div className={`aw-tc-steer ${active ? 'is-on' : ''}`} ref={track} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={prevent} role="slider" aria-label="Steering" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={0}>
      <span className="aw-tc-steer__l" aria-hidden="true">&lsaquo;</span>
      <span className="aw-tc-steer__tick" aria-hidden="true" />
      <span className="aw-tc-steer__r" aria-hidden="true">&rsaquo;</span>
      <div className="aw-tc-steer__knob" ref={knob} aria-hidden="true" />
    </div>
  );
}

export default function TouchControls({ game }) {
  const touch = useTouchMode();
  const menu = useGameMenu(game);
  const show = !!game && touch && !menu;
  const hornTap = useCallback((g) => g.input.setTouch('horn', true), []);
  const interactTap = useCallback((g) => g.input.setTouch('interact', true), []);

  // a menu opening (or leaving the page) while a finger is down must not leave a pedal stuck
  useEffect(() => {
    if (!show) releaseAll(game);
    return () => releaseAll(game);
  }, [show, game]);

  if (!show) return null;
  return (
    <div className="aw-tc" onContextMenu={prevent}>
      <SteerSlider game={game} />
      <div className="aw-tc-acts">
        <span className="aw-tc-gap" />
        <TapBtn game={game} label="Change camera" onTap={tapCamera} className="is-small"><CameraIcon size={22} /><small>CAM</small></TapBtn>
        <TapBtn game={game} label="Horn" onTap={hornTap} className="is-small"><HornIcon size={22} /><small>HORN</small></TapBtn>
        <HoldBtn game={game} action="handbrake" label="Handbrake and drift" className="is-small"><DriftIcon size={22} /><small>DRIFT</small></HoldBtn>
        <HoldBtn game={game} action="boost" label="Boost" className="is-small is-boost"><BoltIcon size={22} /><small>BOOST</small></HoldBtn>
        <TapBtn game={game} label="Interact" onTap={interactTap} className="is-use"><HandIcon size={24} /><small>E</small></TapBtn>
      </div>
      <div className="aw-tc-pedals">
        <HoldBtn game={game} action="down" label="Brake and reverse" className="is-brake"><span>BRAKE</span></HoldBtn>
        <HoldBtn game={game} action="up" label="Gas" className="is-gas"><span>GAS</span></HoldBtn>
      </div>
    </div>
  );
}

// Action buttons: handbrake and boost stay on while a finger is down ("hold"), horn / interact / camera fire when touched ("tap"; the horn
// repeats while held), plus the small map / radio / phone / quests / pause row and its "..." tray.
import { useEffect, useRef, useState } from 'react';
import { BoltIcon, CameraIcon, DotsIcon, DriftIcon, GearIcon, HandIcon, HornIcon, MapIcon, PauseIcon, PhoneIcon, QuestIcon, RadioIcon } from './icons.jsx';
import { createPointerSlot } from './pointerGuard.js';
import { MAIN_ACTIONS, MINOR_ACTIONS, place } from './layout.js';

const ICONS = {
  boost: BoltIcon, handbrake: DriftIcon, horn: HornIcon, camera: CameraIcon, interact: HandIcon,
  map: MapIcon, radio: RadioIcon, phone: PhoneIcon, quests: QuestIcon, pause: PauseIcon, settings: GearIcon,
};
const SHORT = { boost: 'BOOST', handbrake: 'DRIFT', horn: 'HORN', camera: 'CAM', interact: 'E' };

/** One round button. kind 'hold' | 'tap'. `repeat` (ms) makes a tap button fire again while held. */
export function ActionBtn({ id, label, kind, input, bus, fx, size, style, className = '', zone = 'pedal', short, repeat = 0, onTap }) {
  const slot = useRef(null);
  const timer = useRef(0);
  const [on, setOn] = useState(false);
  if (!slot.current) slot.current = createPointerSlot();
  const Icon = ICONS[id];

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = 0;
  };
  const letGo = () => {
    stop();
    if (kind === 'hold') bus.hold(input, false);
    setOn(false);
  };
  const down = (e) => {
    if (!slot.current.claim(e)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* gone */
    }
    setOn(true);
    fx(kind === 'hold' ? 'tap' : 'select');
    if (kind === 'hold') bus.hold(input, true);
    else {
      if (onTap) onTap(id);
      else bus.tap(input);
      if (repeat) timer.current = setInterval(() => bus.tap(input), repeat);
    }
  };
  const up = (e) => {
    if (slot.current.release(e)) letGo();
  };
  useEffect(() => {
    const let_go = () => {
      if (slot.current.release()) letGo();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') let_go();
    };
    window.addEventListener('blur', let_go);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', let_go);
      document.removeEventListener('visibilitychange', onHide);
      stop();
      if (kind === 'hold') bus.hold(input, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus]);

  return (
    <button
      type="button"
      className={`aw-ct-btn is-${id} ${kind === 'hold' ? 'is-hold' : ''} ${on ? 'is-on' : ''} ${className}`}
      style={{ width: size, height: size, ...style }}
      data-ctl-zone={zone}
      aria-label={label}
      aria-pressed={kind === 'hold' ? on : undefined}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      {Icon && <Icon size={Math.round(size * 0.44)} />}
      {short && SHORT[id] && <small>{SHORT[id]}</small>}
    </button>
  );
}

/** The five main buttons, positioned by the layout. */
export function MainActions({ layout, side, wheelSide, bus, fx }) {
  return MAIN_ACTIONS.map((a) => {
    const pos = layout.actions.find((p) => p.id === a.id);
    if (!pos) return null;
    return (
      <ActionBtn
        key={a.id} {...a} bus={bus} fx={fx} size={layout.btn} short
        repeat={a.id === 'horn' ? 380 : 0}
        style={place(pos.from === 'wheel' && wheelSide ? wheelSide : side, pos.x, pos.y)}
        zone={pos.from === 'wheel' ? 'wheel' : layout.mode === 'port' ? 'row' : 'pedal'}
      />
    );
  });
}

/** The small row (inline) or the "..." tray with map / radio / phone / quests / pause and the settings gear. */
export function MinorActions({ layout, bus, fx, wheelSide, pedalSide, onSettings }) {
  const [open, setOpen] = useState(false);
  const slot = useRef(createPointerSlot());
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => setOpen(false), 6000);
    return () => clearTimeout(t);
  }, [open]);
  const tray = layout.tray;
  const side = tray.from === 'pedal' ? pedalSide : wheelSide;
  const mini = layout.mini;
  const items = [
    ...MINOR_ACTIONS,
    { id: 'settings', label: 'Control settings', input: null },
  ];
  const tap = (item) => {
    fx('select');
    if (item.id === 'settings') onSettings();
    else bus.tap(item.input);
    setOpen(false);
  };
  const row = (extra) => (
    <div className={`aw-ct-minor ${extra}`} style={{ '--ct-mini': `${mini}px` }}>
      {items.map((it) => (
        <MiniBtn key={it.id} item={it} onTap={tap} />
      ))}
    </div>
  );
  if (tray.inline) {
    const p = layout.minor;
    return (
      <div className="aw-ct-minorwrap" style={{ ...place(p.from === 'pedal' ? pedalSide : wheelSide, p.x, p.y), '--ct-mini': `${mini}px` }} data-ctl-zone={p.from === 'pedal' ? 'row' : 'wheel'}>
        {row('is-inline')}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className={`aw-ct-btn aw-ct-tray ${open ? 'is-on' : ''}`}
        style={{ width: layout.btn, height: layout.btn, ...place(side, tray.x, tray.y) }}
        data-ctl-zone={tray.from === 'pedal' ? 'row' : 'wheel'}
        aria-label="More controls"
        aria-expanded={open}
        onPointerDown={(e) => {
          if (!slot.current.claim(e)) return;
          e.preventDefault();
          fx('select');
          setOpen((o) => !o);
        }}
        onPointerUp={(e) => slot.current.release(e)}
        onPointerCancel={(e) => slot.current.release(e)}
      >
        <DotsIcon size={22} />
      </button>
      {open && (
        <div className="aw-ct-trayrow" style={{ ...place(side, tray.from === 'pedal' ? layout.margin : tray.x, tray.y + layout.btn + 4), '--ct-mini': `${mini}px` }}>
          {row('is-tray')}
        </div>
      )}
    </>
  );
}

function MiniBtn({ item, onTap }) {
  const Icon = ICONS[item.id];
  const slot = useRef(createPointerSlot());
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      className={`aw-ct-mini ${on ? 'is-on' : ''}`}
      aria-label={item.label}
      onPointerDown={(e) => {
        if (!slot.current.claim(e)) return;
        e.preventDefault();
        setOn(true);
        onTap(item);
      }}
      onPointerUp={(e) => {
        if (slot.current.release(e)) setOn(false);
      }}
      onPointerCancel={(e) => {
        if (slot.current.release(e)) setOn(false);
      }}
      onPointerLeave={(e) => {
        if (slot.current.release(e)) setOn(false);
      }}
    >
      <Icon size={Math.round(18)} />
    </button>
  );
}

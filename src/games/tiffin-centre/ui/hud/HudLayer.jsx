// The in-game overlay controller. Takes the session snapshot (from useSession, see Hud.jsx) and wires:
//   taps on the 3D scene (scene.pick) / DOM controls / keys  ->  decideAction  ->  the action runner (walk, then work)  ->  session.dispatch
//   session events -> toasts, +rupee pops, heart cracks, emotes, aria-live announcements; tutorial spotlight -> scene highlight + pulses.
// Split from Hud.jsx so it renders (and is tested) without the session hook.
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatINR } from '@shared/format.js';
import { useReducedMotion } from '@/components/shell/hooks.js';
import ActionSheet from './ActionSheet.jsx';
import Availability from './Availability.jsx';
import CoopBar from './CoopBar.jsx';
import HandsTray from './HandsTray.jsx';
import HudIcon from './HudIcon.jsx';
import OrderRail from './OrderRail.jsx';
import StationsDock from './StationsDock.jsx';
import Toasts from './Toasts.jsx';
import TopBar from './TopBar.jsx';
import WorldBubbles from './WorldBubbles.jsx';
import { HudContext, useActionRunner, useHudBus } from './hooks.js';
import {
  BIN_TARGET, availability, bestTarget, cookAction, customerTarget, decideAction, dishInfo, effectiveHand, eventNotice, nearestTarget,
  patienceWarnings, placeName, playerChanges, runOutAlerts, slotTarget, spotKeys, teammates, urgentPaying,
} from './hudLogic.js';
import './hud.css';

const EMPTY = new Set();
const TOAST_MS = 2600;

export default function HudLayer({ session, scene, state, tickAt, status, connection, onMute, muted, onRunner, reducedOverride }) {
  const osReduced = useReducedMotion();
  const reduced = reducedOverride ?? osReduced;
  const { bus, live } = useHudBus();
  const meId = session?.meId;
  live.set(state, tickAt, status, meId);

  const hands = state?.players?.[meId]?.hands || [];
  const [selHand, setSelHand] = useState(0);
  const sel = effectiveHand(hands, selHand);
  const selRef = useRef(sel);
  selRef.current = sel;

  const [sheet, setSheet] = useState(null);
  const sheetRef = useRef(null);
  sheetRef.current = sheet;
  const [toasts, setToasts] = useState([]);
  const [liveMsgs, setLiveMsgs] = useState([]);
  const [pops, setPops] = useState([]);
  const [floats, setFloats] = useState([]);
  const [lost, setLost] = useState({ n: 0, idx: -1 });

  // ---- little helpers -----------------------------------------------------------------------------------------------------
  const ids = useRef(0);
  const timers = useRef(new Set());
  const recent = useRef(new Map());
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  const push = (n) => {
    if (!n?.text) return;
    const now = Date.now();
    if (now - (recent.current.get(n.text) || 0) < 700) return; // the same line twice in a blink is noise
    recent.current.set(n.text, now);
    const id = ++ids.current;
    setLiveMsgs((l) => [...l.slice(-3), { id, text: n.text }]);
    later(() => setLiveMsgs((l) => l.filter((x) => x.id !== id)), 8000);
    if (n.toast === false) return;
    setToasts((l) => [...l.slice(-2), { id, ...n }]);
    later(() => setToasts((l) => l.filter((x) => x.id !== id)), TOAST_MS);
  };
  const announce = (text) => push({ text, toast: false });

  // ---- scene highlight: flash > keyboard focus ring > keyboard walk > tutorial spotlight ---------------------------------------
  const hl = useRef({ flash: null, focus: null, kb: null, spot: null });
  const applyHighlight = () => {
    const h = hl.current;
    scene?.setHighlight?.(h.flash ?? h.focus ?? h.kb ?? h.spot ?? null);
  };
  const flash = (target) => {
    hl.current.flash = target;
    applyHighlight();
    later(() => {
      if (hl.current.flash === target) {
        hl.current.flash = null;
        applyHighlight();
      }
    }, 2500);
  };
  const spotlight = session?.tutorial?.spotlight ?? session?.tutorial?.step?.spotlight ?? null;
  const spotJson = JSON.stringify(spotlight);
  const spot = useMemo(() => (spotlight ? spotKeys(spotlight, state) : EMPTY), [spotJson, state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    hl.current.spot = spotlight ? { ...spotlight, station: spotlight.station ?? spotlight.id } : null;
    applyHighlight();
    return () => {
      hl.current.spot = null;
      applyHighlight();
    };
  }, [spotJson, scene]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the action runner ----------------------------------------------------------------------------------------------------
  const actions = useActionRunner(session, scene, {
    selectedHandRef: selRef,
    onRefused: () => push({ text: session?.lastError || 'Cannot do that', tone: 'bad', icon: 'alarm' }),
    onDrop: () => push({ text: 'Too late: that changed', tone: 'warn', icon: 'alarm' }),
  });
  useEffect(() => {
    onRunner?.(actions.runner);
  }, [actions.runner, onRunner]);
  const walking = actions.snap.pending?.keys ?? EMPTY;

  // ---- what a target does ----------------------------------------------------------------------------------------------------
  const kbOn = useRef(false);
  const perform = (d) => {
    if (!d) return;
    if (d.type === 'sheet') setSheet({ station: d.station, slot: d.slot });
    else if (d.type === 'dispatch') actions.request(d.action);
    else if (d.type === 'hint') push({ text: d.text, tone: 'warn', icon: 'alarm' });
  };
  const onTarget = (target) => {
    const st = live.state;
    if (!st || live.status !== 'playing') return;
    perform(decideAction(st, target, { meId, selectedHand: selRef.current }));
  };
  const onSlot = (station, slot) => onTarget(slotTarget(station, slot));
  const pickSheetDish = (dish) => {
    const s = sheetRef.current;
    setSheet(null);
    if (s) actions.request(cookAction(s.station, s.slot, dish));
  };
  const avail = useMemo(() => availability(state, meId), [state, meId]);
  const onChip = (dish) => {
    if (live.status !== 'playing') return;
    const best = bestTarget(live.state, dish);
    const name = dishInfo(dish).name;
    if (!best) {
      push({ text: `${name}: no free slot`, tone: 'warn', icon: 'alarm' });
      return;
    }
    flash(slotTarget(best.station, best.slot));
    actions.walkTo(best.station);
    if (best.mode === 'cook') setSheet({ station: best.station, slot: best.slot, dish });
    else push({ text: `${name} is ready at ${placeName(best.station, live.state)}: tap it to take`, tone: 'info', icon: 'check' });
  };
  const onTrash = () => onTarget(BIN_TARGET);

  // ---- session events -> notices --------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!session?.subscribe) return undefined;
    let prev = session.state || null;
    let prevAvail = prev ? availability(prev, session.meId) : null;
    let prevPlayers = session.players || [];
    return session.subscribe(({ state: st, events }) => {
      if (!st) return;
      for (const ev of events || []) {
        const n = eventNotice(ev, st, session.meId, formatINR);
        if (n) {
          if (n.collect) {
            const id = ++ids.current;
            setPops((l) => [...l.slice(-2), { id, amount: n.collect.amount }]);
            later(() => setPops((l) => l.filter((p) => p.id !== id)), 1400);
          }
          if (n.emote) {
            const id = ++ids.current;
            setFloats((l) => [...l.slice(-5), { id, ...n.emote }]);
            later(() => setFloats((l) => l.filter((f) => f.id !== id)), 2400);
          }
          push(n);
        }
        if (ev.type === 'life-lost') {
          setLost((l) => ({ n: l.n + 1, idx: ev.lives }));
          later(() => setLost((l) => ({ ...l, idx: -1 })), 1000);
        }
      }
      for (const w of patienceWarnings(prev, st)) push(w);
      const a = availability(st, session.meId);
      for (const r of runOutAlerts(prevAvail, a)) announce(r.text);
      for (const c of playerChanges(prevPlayers, session.players || [], session.meId)) {
        push(c.type === 'left' ? { text: `${c.name} left the table`, tone: 'warn', icon: 'users' } : { text: `${c.name} is back`, tone: 'good', icon: 'users' });
      }
      prev = st;
      prevAvail = a;
      prevPlayers = session.players || [];
    });
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard: A/D or arrows walk, Space/E acts on the nearest target, C collects, Esc closes / pauses ------------------------------
  const keyRef = useRef(null);
  keyRef.current = { actions, onTarget, push, session };
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target;
      const tag = tg?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tg?.isContentEditable) return;
      if (sheetRef.current) return; // the sheet owns its keys while open
      const { actions: A, onTarget: go, push: say, session: S } = keyRef.current;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'Escape') {
        if (S?.mode !== 'online' && live.status === 'playing' && typeof S?.pause === 'function') {
          e.preventDefault();
          S.pause();
        }
        return;
      }
      if (live.status !== 'playing') return;
      const dir = k === 'a' || k === 'ArrowLeft' ? -1 : k === 'd' || k === 'ArrowRight' ? 1 : 0;
      if (dir) {
        e.preventDefault();
        kbOn.current = true;
        A.nudge(dir);
        return;
      }
      const onButton = !!tg?.closest?.('button, a, [role="button"]');
      if (k === 'e' || (k === ' ' && !onButton)) {
        e.preventDefault();
        kbOn.current = true;
        const t = nearestTarget(live.state, A.runner.x());
        if (t) go(t);
        else say({ text: 'Nothing here: walk to a station or a customer', tone: 'warn', icon: 'alarm' });
        return;
      }
      if (k === 'c') {
        const c = urgentPaying(live.state);
        if (c) {
          e.preventDefault();
          go(customerTarget(c.id));
        }
      }
    };
    const onPointer = () => {
      if (kbOn.current) {
        kbOn.current = false;
        hl.current.kb = null;
        applyHighlight();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the avatar's ring in the 3D scene follows the nearest target while the keyboard walks
  useEffect(() => {
    let lastKey = '';
    return bus.add(() => {
      const next = kbOn.current && live.state ? nearestTarget(live.state, actions.runner.x()) : null;
      const key = next ? `${next.kind}:${next.id ?? ''}` : '';
      if (key !== lastKey) {
        lastKey = key;
        hl.current.kb = next;
        applyHighlight();
      }
    });
  }, [bus, live, actions.runner]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer on the canvas -----------------------------------------------------------------------------------------------------
  const pickRef = useRef(null);
  const hoverRaf = useRef(0);
  const rootRef = useRef(null);
  const onPickClick = (e) => {
    if (sheetRef.current) {
      setSheet(null);
      return;
    }
    const t = scene?.pick?.(e.clientX, e.clientY);
    if (t) onTarget(t);
  };
  const onPickMove = (e) => {
    if (e.pointerType !== 'mouse' || hoverRaf.current || !scene?.pick) return;
    const { clientX, clientY } = e;
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = 0;
      if (pickRef.current) pickRef.current.style.cursor = scene.pick(clientX, clientY) ? 'pointer' : 'default';
    });
  };
  useEffect(() => () => hoverRaf.current && cancelAnimationFrame(hoverRaf.current), []);

  // Publish where the HUD's top bands end as `--tc-hud-top` on the game root, so the tutorial bubble (a sibling layer in ui/menus)
  // starts below the banner, the takings plate and the full-width chalk board instead of covering them.
  const hasState = !!state;
  useEffect(() => {
    const root = rootRef.current;
    const host = root?.parentElement;
    if (!root || !host) return undefined;
    const measure = () => {
      const top = host.getBoundingClientRect().top;
      const w = root.clientWidth || 1;
      let bottom = 0;
      for (const sel of ['.tc-hud-top', '.tc-hud-coop', '.tc-hud-board']) {
        const el = root.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.width >= w * 0.6) bottom = Math.max(bottom, r.bottom - top);
      }
      host.style.setProperty('--tc-hud-top', `${Math.ceil(bottom + 8)}px`);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    for (const sel of ['.tc-hud-top', '.tc-hud-board', '.tc-hud-coop']) {
      const el = root.querySelector(sel);
      if (el) ro?.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      host.style.removeProperty('--tc-hud-top');
    };
  }, [hasState, session?.mode, avail.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;
  const online = session?.mode === 'online';
  const canPause = !online && typeof session?.pause === 'function';
  const link = session?.link || { everOpen: true };
  const sessionConn = connection === 'open' ? 'open' : connection === 'closed' ? 'closed' : 'connecting';
  const mates = online ? teammates(state, session?.players || [], meId) : [];
  const pending = actions.snap.pending;

  return (
    <HudContext.Provider value={{ bus, live }}>
      <div ref={rootRef} className={`tc-hud${reduced ? ' tc-hud--calm' : ''}`} data-mode={session?.mode || 'practice'} data-status={status} data-keyboard={kbOn.current ? '1' : '0'}>
        <div ref={pickRef} className="tc-hud-pick" aria-hidden="true" onClick={onPickClick} onPointerMove={onPickMove} />
        <WorldBubbles scene={scene} state={state} onTarget={onTarget} />
        <TopBar
          state={state}
          reduced={reduced}
          pops={pops}
          lostN={lost.n}
          lostIdx={lost.idx}
          canPause={canPause}
          onPause={() => session?.pause?.()}
          onMute={onMute}
          muted={muted}
        />
        {online && (
          <CoopBar
            mates={mates}
            floats={floats}
            meId={meId}
            connection={sessionConn}
            link={link}
            onRetry={session?.retry}
            reduced={reduced}
            onEmote={(e) => session?.dispatch?.({ type: 'emote', e })}
          />
        )}
        <Availability rows={avail} onChip={onChip} />
        <OrderRail state={state} hands={hands} spot={spot} walking={walking} onTarget={onTarget} />
        <div className="tc-hud-bottom">
          {pending && (
            <div className="tc-hud-pending" role="status">
              <HudIcon name="walk" size={16} />
              <span>{`${pending.label}...`}</span>
              <button type="button" className="tc-hud-pending-x" onClick={actions.cancel} aria-label="Cancel that job">
                <HudIcon name="close" size={14} />
              </button>
            </div>
          )}
          <HandsTray hands={hands} selectedHand={selHand} spot={spot} walking={walking} onSelect={setSelHand} onTrash={onTrash} />
          <StationsDock
            state={state}
            spot={spot}
            walking={walking}
            onSlot={onSlot}
            onFocusTarget={(t) => {
              hl.current.focus = t;
              applyHighlight();
            }}
          />
        </div>
        <Toasts toasts={toasts} live={liveMsgs} />
        {sheet && <ActionSheet sheet={sheet} state={state} avail={avail} onPick={pickSheetDish} onClose={() => setSheet(null)} />}
      </div>
    </HudContext.Provider>
  );
}

// The in-game overlay controller. Takes the session snapshot (from useSession, see Hud.jsx) and wires:
//   taps on the 3D scene (scene.pick) / DOM controls / keys  ->  decideAction  ->  the tutorial gate  ->  the action runner (walk, then work)
//   drags on the 3D scene / look keys -> scene.lookBy (first-person head turn, with inertia); off-screen targets -> scene.lookAt
//   session events -> toasts, +rupee pops, heart cracks, emotes, aria-live announcements; tutorial spotlight -> scene highlight + pulses
//   customer speech (dialogue director) -> speech bubbles over heads, the subtitle strip, the voice and the moving mouth
// Split from Hud.jsx so it renders (and is tested) without the session hook.
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatINR } from '@shared/format.js';
import { LAYOUT } from '@shared/tiffin-centre/catalog.js';
import { useReducedMotion } from '@/components/shell/hooks.js';
import ActionSheet from './ActionSheet.jsx';
import Availability from './Availability.jsx';
import CoopBar from './CoopBar.jsx';
import EdgeIndicators from './EdgeIndicators.jsx';
import HandsTray from './HandsTray.jsx';
import HudIcon from './HudIcon.jsx';
import OrderRail from './OrderRail.jsx';
import { HelpCard, QuickBar } from './QuickBar.jsx';
import StationsDock from './StationsDock.jsx';
import { GlossLive, SubtitleStrip } from './Subtitles.jsx';
import Toasts from './Toasts.jsx';
import TopBar from './TopBar.jsx';
import WorldBubbles from './WorldBubbles.jsx';
import { HudContext, useActionRunner, useHudBus } from './hooks.js';
import {
  BIN_TARGET, GATE_TEXT, activeCustomers, availability, bestTarget, cookAction, customerTarget, decideAction, dishInfo, effectiveHand, eventNotice, gateDecision,
  isActionAllowed, nearestTarget, patienceWarnings, pendingTarget, placeName, playerChanges, runOutAlerts, slotTarget, spotKeys, targetKey,
  teammates, urgentPaying,
} from './hudLogic.js';
import { LOOK, createGesture, isTurned, lookKeyIntent, stepInertia } from './look.js';
import { pickBubbles, pickSubtitle } from './dialogue.js';
import { createProjector } from './projector.js';
import { usePrefs, voiceAvailable } from './prefs.js';
import { useDialogue } from './useDialogue.js';
import './hud.css';

const EMPTY = new Set();
const TOAST_MS = 2600;
const spotXOf = (c) => LAYOUT.spotX(c.spot);

/** True on a touch-first device (decides the touch / keyboard wording of the help). */
function useCoarse() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(pointer: coarse)');
    const on = () => setCoarse(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

export default function HudLayer({ session, scene, audio = null, state, tickAt, status, connection, onMute, muted, onRunner, reducedOverride }) {
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
  const [prefs, setPrefs] = usePrefs();
  const projector = useMemo(() => createProjector(), []);
  const dlg = useDialogue(session, audio, { scene });
  const touch = useCoarse();
  useEffect(() => {
    session?.tutorial?.setPointer?.(touch ? 'touch' : 'keyboard');
  }, [touch, session]);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef(false);
  helpRef.current = helpOpen;
  const [turned, setTurned] = useState(false);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  // what the tutorial step allows: the driver's `allowed` list (null = anything), else its allows(type), else everything
  const allowedNow = () => {
    const t = session?.tutorial;
    if (!t) return undefined;
    if (t.allowed !== undefined) return t.allowed;
    return typeof t.allows === 'function' ? (a) => t.allows(a.type) : undefined;
  };
  // the head: true while the scene holds it on a target (lookAt) so a drag has to let go first
  const pinned = useRef(false);

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

  useEffect(() => {
    const sc = sceneRef.current;
    if (!spotlight?.look || !sc?.lookAt) return undefined;
    const st = live.state;
    const id = spotlight.id ?? spotlight.station;
    const target = spotlight.kind === 'customer' ? (id !== undefined && id !== null ? customerTarget(id) : (activeCustomers(st)[0] ? customerTarget(activeCustomers(st)[0].id) : null)) : { ...spotlight, station: id };
    if (!target) return undefined;
    let off = true;
    try {
      const p = sc.project?.(target, { x: 0, y: 0, visible: false });
      const w = rootRef.current?.clientWidth || window.innerWidth;
      const h = rootRef.current?.clientHeight || window.innerHeight;
      off = !p || p.visible === false || !(p.x > 0 && p.x < w && p.y > 0 && p.y < h);
    } catch {
      off = true;
    }
    if (!off) return undefined;
    pinned.current = true;
    sc.lookAt(target);
    return () => {
      if (pinned.current) {
        pinned.current = false;
        sceneRef.current?.lookAt?.(null);
      }
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
  const pending = actions.snap.pending;

  // ---- what a target does ----------------------------------------------------------------------------------------------------
  const kbOn = useRef(false);
  const perform = (d) => {
    if (!d) return;
    if (d.type === 'sheet') setSheet({ station: d.station, slot: d.slot });
    else if (d.type === 'dispatch') actions.request(d.action);
    else if (d.type === 'hint') push({ text: d.text, tone: 'warn', icon: 'alarm' });
  };
  const notYet = () => push({ text: session?.tutorial?.notYet || GATE_TEXT, tone: 'warn', icon: 'help' });
  const canMove = () => {
    if (isActionAllowed(allowedNow(), { type: 'move' })) return true;
    notYet();
    return false;
  };
  const onTarget = (target) => {
    const st = live.state;
    if (!st || live.status !== 'playing') return;
    // a tutorial step may only allow some actions: a refused one gets a friendly "not yet", a tap on a place may just walk there
    const g = gateDecision(decideAction(st, target, { meId, selectedHand: selRef.current }), target, allowedNow(), st);
    if (g.blocked) notYet();
    else if (g.walk) actions.walkTo(g.walk);
    else perform(g.go);
  };
  const onSlot = (station, slot) => onTarget(slotTarget(station, slot));
  const pickSheetDish = (dish) => {
    const s = sheetRef.current;
    setSheet(null);
    if (!s) return;
    if (!isActionAllowed(allowedNow(), { type: 'cook' })) {
      notYet();
      return;
    }
    actions.request(cookAction(s.station, s.slot, dish));
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
    if (!isActionAllowed(allowedNow(), { type: best.mode === 'cook' ? 'cook' : 'take' })) {
      notYet();
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

  // ---- looking around: drag, flick, keys, "turn to my target" ---------------------------------------------------------------------
  const pickRef = useRef(null);
  const hoverRaf = useRef(0);
  const rootRef = useRef(null);
  const gesture = useRef(null);
  if (!gesture.current) gesture.current = createGesture();
  const autoLook = useRef({ on: false, timer: 0 });
  const inertia = useRef({ v: { vYaw: 0, vPitch: 0 }, raf: 0 });
  const stopInertia = () => {
    if (inertia.current.raf) cancelAnimationFrame(inertia.current.raf);
    inertia.current = { v: { vYaw: 0, vPitch: 0 }, raf: 0 };
  };
  // Any look the PLAYER makes cancels a flick and an automatic turn.
  const releasePin = () => {
    if (!pinned.current) return;
    pinned.current = false;
    sceneRef.current?.lookAt?.(null);
  };
  const manualLook = (intent) => {
    stopInertia();
    autoLook.current.on = false;
    clearTimeout(autoLook.current.timer);
    const sc = sceneRef.current;
    if (intent === 'recentre') {
      pinned.current = false;
      sc?.lookAt?.(null);
    } else {
      releasePin();
      sc?.lookBy?.(intent.dYaw, intent.dPitch);
    }
  };
  const startInertia = (v) => {
    if (reduced || !sceneRef.current?.lookBy) return;
    if (Math.hypot(v.vYaw, v.vPitch) < LOOK.minSpeed * 3) return;
    let last = performance.now();
    inertia.current = { v, raf: 0 };
    const step = (t) => {
      const r = stepInertia(inertia.current.v, Math.min(0.05, (t - last) / 1000));
      last = t;
      sceneRef.current?.lookBy?.(r.dYaw, r.dPitch);
      inertia.current.v = r.v;
      inertia.current.raf = r.done ? 0 : requestAnimationFrame(step);
    };
    inertia.current.raf = requestAnimationFrame(step);
  };
  const lookAtCustomer = (id) => {
    stopInertia();
    autoLook.current.on = false;
    clearTimeout(autoLook.current.timer);
    pinned.current = true;
    sceneRef.current?.lookAt?.(customerTarget(id));
  };
  const keyRef = useRef(null);
  keyRef.current = { actions, onTarget, push, session, canMove, manualLook };

  // ---- keyboard: A/D or arrows walk, Space/E acts, Z/X (or Shift+arrows) look, V recentres, C collects, ? help, Esc closes / pauses ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target;
      const tag = tg?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tg?.isContentEditable) return;
      if (sheetRef.current) return; // the sheet owns its keys while open
      const { actions: A, onTarget: go, push: say, session: S, canMove: mayMove, manualLook: lookTo } = keyRef.current;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'Escape') {
        if (helpRef.current) {
          e.preventDefault();
          setHelpOpen(false);
          return;
        }
        if (S?.mode !== 'online' && live.status === 'playing' && typeof S?.pause === 'function') {
          e.preventDefault();
          S.pause();
        }
        return;
      }
      if (k === '?') {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      if (live.status !== 'playing') return;
      const look = lookKeyIntent(e);
      if (look) {
        e.preventDefault();
        lookTo(look);
        return;
      }
      const dir = k === 'a' || k === 'ArrowLeft' ? -1 : k === 'd' || k === 'ArrowRight' ? 1 : 0;
      if (dir) {
        e.preventDefault();
        kbOn.current = true;
        if (mayMove()) A.nudge(dir);
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

  // ---- pointer on the canvas: tap works, drag looks -------------------------------------------------------------------------------------
  const onPickDown = (e) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    stopInertia();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* a synthetic or already released pointer */
    }
    gesture.current.down({ x: e.clientX, y: e.clientY, t: e.timeStamp, pointerType: e.pointerType, button: e.button, viewportWidth: rootRef.current?.clientWidth || window.innerWidth });
  };
  const onPickMove = (e) => {
    if (gesture.current.active) {
      const r = gesture.current.move({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (r) {
        autoLook.current.on = false;
        clearTimeout(autoLook.current.timer);
        releasePin();
        sceneRef.current?.lookBy?.(r.look.dYaw, r.look.dPitch);
        if (pickRef.current) pickRef.current.dataset.look = '1';
      }
      return;
    }
    if (e.pointerType !== 'mouse' || hoverRaf.current || !scene?.pick) return;
    const { clientX, clientY } = e;
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = 0;
      if (pickRef.current) pickRef.current.style.cursor = scene.pick(clientX, clientY) ? 'pointer' : 'grab';
    });
  };
  const onPickUp = (e) => {
    if (pickRef.current) delete pickRef.current.dataset.look;
    const r = gesture.current.up({ t: e.timeStamp });
    if (!r) return;
    if (r.type === 'drag') {
      startInertia({ vYaw: r.vYaw, vPitch: r.vPitch });
      return;
    }
    if (sheetRef.current) {
      setSheet(null);
      return;
    }
    const t = scene?.pick?.(r.x, r.y);
    if (t) onTarget(t);
  };
  const onPickCancel = () => {
    gesture.current.cancel();
    if (pickRef.current) delete pickRef.current.dataset.look;
  };
  useEffect(
    () => () => {
      if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current);
      stopInertia();
      clearTimeout(autoLook.current.timer);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // When the job you queued is about something off screen, turn your head to it (and turn back a moment after it is done).
  const pendingKey = pending ? targetKey(pendingTarget(pending.action)) : '';
  useEffect(() => {
    const sc = sceneRef.current;
    const t = pending ? pendingTarget(pending.action) : null;
    const al = autoLook.current;
    if (t && sc?.lookAt) {
      let off = true;
      try {
        const p = sc.project?.(t, { x: 0, y: 0, visible: false });
        const w = rootRef.current?.clientWidth || window.innerWidth;
        const h = rootRef.current?.clientHeight || window.innerHeight;
        off = !p || p.visible === false || !(p.x > 0 && p.x < w && p.y > 0 && p.y < h);
      } catch {
        off = false;
      }
      if (off) {
        clearTimeout(al.timer);
        pinned.current = true;
        sc.lookAt(t);
        al.on = true;
      }
    } else if (al.on) {
      clearTimeout(al.timer);
      al.timer = setTimeout(() => {
        if (al.on) {
          al.on = false;
          pinned.current = false;
          sceneRef.current?.lookAt?.(null);
        }
      }, 900);
    }
  }, [pendingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feed where the head points to the tutorial (a step may wait for a look around) and light the recentre button.
  useEffect(() => {
    let last = 0;
    let wasTurned = false;
    return bus.add((t) => {
      if (t - last < 120) return;
      last = t;
      const look = sceneRef.current?.getLook?.();
      if (!look) return;
      try {
        session?.tutorial?.noteLook?.(look);
      } catch {
        /* the tutorial must never break the HUD */
      }
      const now = isTurned(look);
      if (now !== wasTurned) {
        wasTurned = now;
        setTurned(now);
      }
    });
  }, [bus, session]);

  // Publish where the HUD's bands end on the game root: `--tc-hud-top` (the bottom edge of the banner, takings plate and chalk board) and
  // `--tc-hud-bottom` (the top of the chit strip and dock, as a distance from the bottom), so the coach bar (a sibling layer in
  // ui/menus) sits clear of the stall and of the HUD. The projector also learns the HUD's size here.
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
      const hostBox = host.getBoundingClientRect();
      let lowest = hostBox.height;
      for (const sel of ['.tc-hud-bottom', '.tc-hud-railbox']) {
        const el = root.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.width >= w * 0.6) lowest = Math.min(lowest, r.top - hostBox.top);
      }
      host.style.setProperty('--tc-hud-bottom', `${Math.ceil(hostBox.height - lowest + 8)}px`);
      projector.size.w = root.clientWidth;
      projector.size.h = root.clientHeight;
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    for (const sel of ['.tc-hud-top', '.tc-hud-board', '.tc-hud-coop', '.tc-hud-bottom', '.tc-hud-railbox']) {
      const el = root.querySelector(sel);
      if (el) ro?.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      host.style.removeProperty('--tc-hud-top');
      host.style.removeProperty('--tc-hud-bottom');
    };
  }, [hasState, session?.mode, avail.length, projector]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;
  const online = session?.mode === 'online';
  const canPause = !online && typeof session?.pause === 'function';
  const link = session?.link || { everOpen: true };
  const sessionConn = connection === 'open' ? 'open' : connection === 'closed' ? 'closed' : 'connecting';
  const mates = online ? teammates(state, session?.players || [], meId) : [];

  // speech: at most three bubbles (in view first, angriest first), one subtitle line (the newest in view, else the most urgent)
  const inView = projector.inView.size ? projector.inView : null;
  const bubbleIds = new Set(pickBubbles(dlg.active, { inView }));
  const subEntry = pickSubtitle(dlg.active, state, inView, 0);
  const voiceMissing = prefs.voices && voiceAvailable(audio, prefs.lang === 'hi' || prefs.lang === 'dk' ? 'hi' : 'te') === false;

  return (
    <HudContext.Provider value={{ bus, live }}>
      <div ref={rootRef} className={`tc-hud${reduced ? ' tc-hud--calm' : ''}`} data-mode={session?.mode || 'practice'} data-status={status} data-keyboard={kbOn.current ? '1' : '0'}>
        <div
          ref={pickRef}
          className="tc-hud-pick"
          aria-hidden="true"
          onPointerDown={onPickDown}
          onPointerMove={onPickMove}
          onPointerUp={onPickUp}
          onPointerCancel={onPickCancel}
          onContextMenu={(e) => e.preventDefault()}
        />
        <WorldBubbles
          scene={scene}
          state={state}
          onTarget={onTarget}
          projector={projector}
          getCookX={() => actions.runner.x()}
          spotXOf={spotXOf}
          speech={dlg.active}
          bubbleIds={bubbleIds}
          subs={prefs.subs}
        />
        <EdgeIndicators scene={scene} state={state} projector={projector} rootRef={rootRef} getCookX={() => actions.runner.x()} spotXOf={spotXOf} onLook={lookAtCustomer} reduced={reduced} />
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
        <SubtitleStrip entry={subEntry} subs={prefs.subs} token={subEntry?.u.customer} />
        <OrderRail state={state} hands={hands} spot={spot} walking={walking} onTarget={onTarget} onLook={lookAtCustomer} />
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
          <div className="tc-hud-utility">
            <HandsTray hands={hands} selectedHand={selHand} spot={spot} walking={walking} onSelect={setSelHand} onTrash={onTrash} />
            <QuickBar
              prefs={prefs}
              onPrefs={setPrefs}
              turned={turned}
              onRecentre={() => manualLook('recentre')}
              helpOpen={helpOpen}
              onHelp={() => setHelpOpen((o) => !o)}
              voiceMissing={voiceMissing}
            />
          </div>
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
        <GlossLive items={dlg.gloss} />
        {helpOpen && <HelpCard touch={touch} onClose={() => setHelpOpen(false)} />}
        {sheet && <ActionSheet sheet={sheet} state={state} avail={avail} onPick={pickSheetDish} onClose={() => setSheet(null)} />}
      </div>
    </HudContext.Provider>
  );
}

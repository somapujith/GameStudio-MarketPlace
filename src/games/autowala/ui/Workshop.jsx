// OWNER: workshop agent. The GTA-style customisation menu for Mama's Garage. Props: { game, snap }. Renders null unless snap.menu === 'workshop'.
// Navigation has three levels like Los Santos Customs: categories -> sections (when a category has several) -> items.
// Keyboard (arrows, Enter, Esc), mouse, touch (tap to preview, tap again or the big button to buy, drag the 3D view) and gamepad.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, rowStatus, sectionRows, sectionView } from '../gameplay/workshop/menuModel.js';
import { fmtRs, previewLoadout } from '../gameplay/workshop/shop.js';
import { find, getPath, PLATE_STYLES, sanitizeBadge, sanitizeBanner, sanitizePlate } from '../gameplay/catalog.js';
import { playHorn, stopHorn } from '../audio/horns.js';
import { useCountUp, useGamepad, useMedia } from './workshop/hooks.js';
import { GridCell, InputRow, ItemRow, NavRow, UpgradeRow } from './workshop/Rows.jsx';
import { BannerCard, PlateCard, StatsCard } from './workshop/Cards.jsx';
import { LANDSCAPE_QUERY } from './menus/menuLayout.js';
import { CloseGlyph } from './menus/glyphs.jsx';
import './workshop.css';

const COLS = 3;
/** Where the auto sits on screen (fraction of width right, of height up): beside the desktop panel, above the phone sheet, right of the sideways phone's list. */
const SHIFT = { desk: [0.1, 0], port: [0, 0.2], land: [0.2, 0] };
const wrapIndex = (i, n) => (n ? ((i % n) + n) % n : 0);
const typed = {
  'plate.text': (s) => String(s).toUpperCase().replace(/[^A-Z0-9 -]/g, '').replace(/ {2,}/g, ' ').slice(0, 10),
  'decals.badge': (s) => sanitizeBadge(s),
  'decals.banner': (s) => String(s).replace(/[\u0000-\u001f<>]/g, '').replace(/ {2,}/g, ' ').slice(0, 22),
  'decals.rearWindow': (s) => String(s).replace(/[\u0000-\u001f<>]/g, '').replace(/ {2,}/g, ' ').slice(0, 22),
};
const cleanText = { 'plate.text': sanitizePlate, 'decals.badge': sanitizeBadge, 'decals.banner': sanitizeBanner, 'decals.rearWindow': sanitizeBanner };

const safe = (fn) => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

export default function Workshop({ game, snap }) {
  const ws = game?.ctx?.workshop;
  const profile = game?.ctx?.profile;
  const open = snap?.menu === 'workshop' && !!ws && !!profile;
  const phase = snap?.workshopPhase || 'closed';
  const live = open && phase === 'open';
  const sideways = useMedia(LANDSCAPE_QUERY); // a phone held sideways: the list on the left, the auto on the right
  const upright = useMedia('(max-width: 760px), (max-aspect-ratio: 1/1)'); // a phone held upright: the auto on top, the list as a sheet
  const narrow = sideways || upright; // either way the info card goes inside the list and the key legend goes away
  const layout = sideways ? 'land' : upright ? 'port' : 'desk';

  const [nav, setNav] = useState({ level: 0, cat: 0, sec: 0, row: 0 });
  const [, setRev] = useState(0);
  const bump = () => setRev((r) => r + 1);
  const [note, setNote] = useState(null);
  const [shake, setShake] = useState(false);
  const [texts, setTexts] = useState({});
  const [lastInput, setLastInput] = useState('kbd');
  const pointerType = useRef('mouse');
  const rowRefs = useRef([]);
  const inputRef = useRef(null);
  const openedAt = useRef(0);

  const data = profile?.data;
  const wallet = snap?.wallet ?? data?.wallet ?? 0;
  const shownWallet = useCountUp(wallet);

  // Mama's repair job: a pinned button above the list while the auto is dented (ctx.career.repairCost() > 0); also the R key and the pad's X
  const career = game?.ctx?.career;
  const dent = Math.round((Number(snap?.career?.damage ?? career?.damage) || 0) * 100);
  const repairQuote = open && typeof career?.repairCost === 'function' ? Math.max(0, Math.round(safe(() => career.repairCost()) || 0)) : 0;
  const hasRepair = repairQuote > 0;
  const cat = CATEGORIES[nav.cat];
  const sec = nav.level >= 1 ? cat.sections[nav.sec] : null;
  const rows = useMemo(() => (nav.level === 2 && sec ? sectionRows(sec) : []), [nav.level, sec]);
  const row = nav.level === 2 ? rows[nav.row] : null;

  // reset whenever the garage closes; seed the text fields from the saved look when it opens
  useEffect(() => {
    if (!open) {
      setNav({ level: 0, cat: 0, sec: 0, row: 0 });
      setNote(null);
      return;
    }
    openedAt.current = performance.now();
    const lo = profile.data.loadout;
    setTexts({ 'plate.text': lo.plate.text, 'decals.badge': lo.decals.badge, 'decals.banner': lo.decals.banner, 'decals.rearWindow': lo.decals.rearWindow });
  }, [open, profile]);

  // ---- camera: preset per category / section, and where the auto sits beside the panel
  const view = nav.level === 0 ? cat.view : sectionView(cat, cat.sections[nav.sec]);
  useEffect(() => {
    if (live) ws.camera.setView(view);
  }, [live, view, ws]);
  useEffect(() => {
    if (open) ws.camera.setShift(...SHIFT[layout]);
  }, [open, layout, ws]);

  // ---- live preview of the highlighted row (never charges)
  const curOf = (path) => getPath(data.loadout, path);
  useEffect(() => {
    if (!live) return;
    if (row && row.type === 'item') ws.preview(row.path, row.value);
    else if (row && row.type === 'toggle') ws.preview(row.path, !curOf(row.path));
    else if (row && row.type === 'input' && cleanText[row.path]?.(texts[row.path] || '')) ws.preview(row.path, texts[row.path]);
    else ws.clearPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, row, texts, nav.level]);
  useEffect(() => () => { safe(() => ws?.clearPreview()); }, [ws]);

  // ---- horns play as you browse them
  useEffect(() => {
    if (!live || nav.level !== 2 || !sec?.audio || !row || row.type !== 'item') return undefined;
    const id = setTimeout(() => safe(() => playHorn(row.value)), 160);
    return () => { clearTimeout(id); safe(() => stopHorn()); };
  }, [live, nav.level, sec, row]);

  // ---- notes ("Installed Bonalu Red -Rs 260", "Not enough rupees")
  useEffect(() => {
    if (!note) return undefined;
    const id = setTimeout(() => setNote(null), 2800);
    return () => clearTimeout(id);
  }, [note]);
  useEffect(() => {
    if (!shake) return undefined;
    const id = setTimeout(() => setShake(false), 520);
    return () => clearTimeout(id);
  }, [shake]);

  // ---- actions
  const status = (r) => rowStatus(data, data.loadout, r, wallet);

  const act = useCallback((r) => {
    if (!r || !ws) return;
    let res;
    if (r.type === 'item') res = ws.buy(r.path, r.value);
    else if (r.type === 'toggle') res = ws.buy(r.path, !getPath(profile.data.loadout, r.path));
    else if (r.type === 'upgrade') res = ws.buy(r.path, (profile.data.upgrades[r.key] || 0) + 1);
    else if (r.type === 'input') res = ws.buy(r.path, texts[r.path] || '');
    if (!res) return;
    if (res.ok) {
      setNote({ tone: res.already ? 'info' : 'good', text: res.already ? 'Already fitted' : `${res.price > 0 ? 'Installed' : 'Fitted'} ${res.name}${res.price > 0 ? `  -${fmtRs(res.price)}` : ''}` });
      if (r.type === 'input') setTexts((t) => ({ ...t, [r.path]: getPath(profile.data.loadout, r.path) }));
    } else {
      setNote({ tone: 'bad', text: res.code === 'funds' ? 'Not enough rupees' : res.reason });
      if (res.code === 'funds') setShake(true);
    }
    bump();
  }, [ws, profile, texts]);

  const doRepair = useCallback(() => {
    const c = game?.ctx?.career;
    if (!c?.repair) return;
    const quote = Math.max(0, Math.round(safe(() => c.repairCost()) || 0));
    if (quote <= 0) { setNote({ tone: 'info', text: 'Nothing to fix' }); return; }
    const res = safe(() => c.repair({ partial: wallet < quote })) || { ok: false, reason: 'The mechanic is busy' };
    if (res.ok) {
      const left = safe(() => Number(c.damage)) || 0;
      setNote({ tone: 'good', text: `${left <= 0.005 ? 'Good as new' : 'Patched up'}  -${fmtRs(res.cost)}` });
    } else {
      setNote({ tone: 'bad', text: res.reason || 'Could not repair' });
      setShake(true);
      safe(() => game.ctx.toast?.(res.reason || 'Could not repair', { tone: 'bad', ms: 2400 }));
    }
    bump();
  }, [game, wallet]);

  const enterCat = (i) => {
    const c = CATEGORIES[i];
    if (c.sections.length === 1) enterSec(i, 0);
    else setNav({ level: 1, cat: i, sec: 0, row: 0 });
  };
  const enterSec = (ci, si) => {
    const list = sectionRows(CATEGORIES[ci].sections[si]);
    let start = list.findIndex((r) => r.type !== 'input' && rowStatus(data, data.loadout, r, wallet).tone === 'installed');
    if (start < 0) start = 0;
    setNav({ level: 2, cat: ci, sec: si, row: start });
  };
  const back = () => {
    if (nav.level === 2) setNav((n) => ({ ...n, level: CATEGORIES[n.cat].sections.length > 1 ? 1 : 0 }));
    else if (nav.level === 1) setNav((n) => ({ ...n, level: 0 }));
    else ws.close();
  };
  const length = nav.level === 0 ? CATEGORIES.length : nav.level === 1 ? cat.sections.length : rows.length;
  const key = nav.level === 0 ? 'cat' : nav.level === 1 ? 'sec' : 'row';
  const goto = (i) => setNav((n) => ({ ...n, [key]: wrapIndex(i, length) }));
  const isGrid = nav.level === 2 && sec?.kind === 'grid';
  const move = (dy) => {
    if (isGrid) goto(nav.row + dy * COLS);
    else goto(nav[key] + dy);
  };
  const moveH = (dx) => {
    if (isGrid) setNav((n) => ({ ...n, row: Math.max(0, Math.min(rows.length - 1, n.row + dx)) }));
    else if (dx < 0 && nav.level > 0) back();
    else if (dx > 0 && nav.level < 2) activate();
  };
  const activate = () => {
    if (nav.level === 0) enterCat(nav.cat);
    else if (nav.level === 1) enterSec(nav.cat, nav.sec);
    else act(row);
  };
  const tab = (d) => setNav({ level: 0, cat: wrapIndex(nav.cat + d, CATEGORIES.length), sec: 0, row: 0 });

  // always-current handlers for the listeners below
  const A = useRef({});
  A.current = { move, moveH, activate, back, tab, nav, row, isGrid, repair: hasRepair ? doRepair : null };

  // keyboard
  useEffect(() => {
    if (!open) return undefined;
    const held = new Set();
    const orbit = () => ws.camera.setInput((held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0), (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0), (held.has('-') ? 1 : 0) - (held.has('=') || held.has('+') ? 1 : 0));
    const onDown = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const inField = e.target?.tagName === 'INPUT';
      const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (!['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', ' ', 'Tab'].includes(k) && inField) return;
      if (phase === 'leaving') { if (k === 'Escape') eat(); return; }
      setLastInput((x) => (x === 'pad' || x === 'touch' ? 'kbd' : x));
      const fresh = performance.now() - openedAt.current > 450 && !e.repeat;
      if (k === 'Escape') { eat(); if (fresh) { if (inField) e.target.blur(); A.current.back(); } return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        eat();
        if (e.shiftKey) ws.camera.drag(0, k === 'ArrowUp' ? -24 : 24);
        else A.current.move(k === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (inField && !e.shiftKey) return; // caret movement
        eat();
        if (e.shiftKey) ws.camera.drag(k === 'ArrowLeft' ? -24 : 24, 0);
        else A.current.moveH(k === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (inField) return; // Enter inside a field is handled by the field itself
      if (k === 'Enter' || k === ' ' || k === 'e') { eat(); if (fresh) A.current.activate(); return; }
      if (k === 'Backspace') { eat(); if (fresh) A.current.back(); return; }
      if (k === 'Tab') { eat(); A.current.tab(e.shiftKey ? -1 : 1); return; }
      if (k === 'r' && A.current.repair) { eat(); if (fresh) A.current.repair(); return; }
      if (['a', 'd', 'w', 's', '-', '=', '+'].includes(k)) { eat(); held.add(k); orbit(); }
    };
    const onUp = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (held.delete(k)) { orbit(); e.stopImmediatePropagation(); }
    };
    const onBlur = () => { held.clear(); orbit(); };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
      ws.camera.setInput(0, 0, 0);
    };
  }, [open, phase, ws]);

  // gamepad
  useGamepad(live, {
    onNav: (dx, dy) => (dy ? A.current.move(dy) : A.current.moveH(dx)),
    onSelect: () => A.current.activate(),
    onBack: () => A.current.back(),
    onLeave: () => ws.close(),
    onTab: (d) => A.current.tab(d),
    onRepair: () => A.current.repair?.(),
    onOrbit: (x, y, z) => ws.camera.setInput(x, y, -z),
    onPadUse: () => setLastInput('pad'),
  });

  // focus the text field when a field row is highlighted with the keyboard / pad (not on touch: no surprise keyboard)
  useEffect(() => {
    if (live && row?.type === 'input' && lastInput !== 'touch') inputRef.current?.focus({ preventScroll: true });
    else if (document.activeElement?.tagName === 'INPUT' && document.activeElement.classList.contains('aw-ws-input')) document.activeElement.blur();
  }, [live, row, lastInput]);

  // keep the highlighted row in view
  const hlIndex = nav[key];
  useEffect(() => {
    const el = rowRefs.current[hlIndex];
    if (hlIndex === 0 && el?.parentElement) el.parentElement.scrollTop = 0; // the info card above the first row stays in view
    else if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hlIndex, nav.level, live]);

  // ---- dragging / pinching / wheel on the 3D view
  const ptrs = useRef(new Map());
  const pinch = useRef(0);
  const onViewDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    if (e.pointerType === 'touch') setLastInput('touch');
  };
  const onViewMove = (e) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) ws.camera.zoom(-(d - pinch.current) * 0.006);
      pinch.current = d;
    } else ws.camera.drag(dx, dy);
  };
  const onViewUp = (e) => {
    ptrs.current.delete(e.pointerId);
    pinch.current = 0;
  };
  const onViewWheel = (e) => ws.camera.zoom(e.deltaY * 0.0012);

  if (!open) return null;

  // ---- what to draw
  const items = nav.level === 0 ? CATEGORIES : nav.level === 1 ? cat.sections : rows;
  const highlighted = row;
  const hs = highlighted ? status(highlighted) : null;
  const title = nav.level === 0 ? "Mama's Garage" : nav.level === 1 ? cat.label : sec.label;
  const crumb = nav.level === 0 ? 'Choose a category' : nav.level === 1 ? 'Choose a section' : cat.sections.length > 1 ? cat.label : cat.blurb;
  const te = nav.level === 0 ? 'మామా గ్యారేజ్' : cat.te;

  // what the cards show: the saved look with the highlighted row applied
  let shown = data.loadout;
  if (row && (row.type === 'item' || row.type === 'toggle')) shown = previewLoadout(data.loadout, row.path, row.type === 'item' ? row.value : !curOf(row.path));
  else if (row?.type === 'input' && cleanText[row.path]?.(texts[row.path] || '')) shown = previewLoadout(data.loadout, row.path, texts[row.path]);
  let card = null;
  if (cat.id === 'plate') card = <PlateCard plate={shown.plate} style={find(PLATE_STYLES, shown.plate.style)} />;
  else if (cat.id === 'performance') {
    const key2 = row?.type === 'upgrade' ? row.key : null;
    card = <StatsCard bars={ws.stats(key2, data.upgrades)} title={key2 ? `${row.name}: now and next` : 'Your auto'} />;
  } else if (sec?.path === 'decals.banner' && nav.level === 2) card = <BannerCard text={shown.decals.banner} />;
  else if (sec?.path === 'decals.rearWindow' && nav.level === 2) card = <BannerCard title="Rear window" text={shown.decals.rearWindow} />;

  const setRowRef = (i) => (el) => { rowRefs.current[i] = el; };
  const hover = (i) => (e) => {
    if (e.pointerType === 'mouse' && nav[key] !== i) goto(i);
  };
  const click = (i) => () => {
    const touch = pointerType.current === 'touch';
    if (nav.level === 0) enterCat(i);
    else if (nav.level === 1) enterSec(nav.cat, i);
    else if (touch && nav.row !== i) setNav((n) => ({ ...n, row: i }));
    else if (nav.row !== i) { setNav((n) => ({ ...n, row: i })); act(rows[i]); }
    else act(rows[i]);
  };

  const renderRow = (r, i) => {
    if (nav.level < 2) {
      const c = r;
      return <NavRow key={c.id} ref={setRowRef(i)} label={c.label} te={c.te} hint={nav.level === 0 ? undefined : undefined} hl={i === hlIndex} onHover={hover(i)} onClick={click(i)} />;
    }
    const st = status(r);
    const rk = `${r.path}:${String(r.value ?? r.key ?? r.type)}`;
    if (r.type === 'upgrade') return <UpgradeRow key={rk} ref={setRowRef(i)} row={r} status={st} hl={i === nav.row} onHover={hover(i)} onClick={click(i)} />;
    if (r.type === 'input') {
      const bad = !cleanText[r.path]?.(texts[r.path] || '');
      return (
        <InputRow
          key={rk} ref={setRowRef(i)} row={r} status={st} hl={i === nav.row} invalid={bad} inputRef={i === nav.row ? inputRef : null}
          value={texts[r.path] ?? ''} onHover={hover(i)}
          onChange={(v) => { setTexts((t) => ({ ...t, [r.path]: (typed[r.path] || ((s) => s))(v) })); if (nav.row !== i) setNav((n) => ({ ...n, row: i })); }}
          onSubmit={() => act(r)}
        />
      );
    }
    if (sec.kind === 'grid') return <GridCell key={rk} ref={setRowRef(i)} row={r} status={st} hl={i === nav.row} onHover={hover(i)} onClick={click(i)} />;
    return (
      <ItemRow
        key={rk} ref={setRowRef(i)} row={r} status={st} hl={i === nav.row} onHover={hover(i)} onClick={click(i)}
        onPlay={sec.audio ? () => safe(() => playHorn(r.value)) : undefined}
      />
    );
  };

  // the action button under the list
  let action = null;
  if (nav.level === 2 && highlighted && hs) {
    const label = highlighted.type === 'input' ? 'Apply' : hs.tone === 'installed' ? (highlighted.type === 'toggle' ? 'Take off' : 'Installed') : hs.tone === 'max' ? 'Maxed' : highlighted.type === 'upgrade' ? 'Fit next level' : 'Install';
    action = { label, price: hs.tone === 'price' || hs.tone === 'locked' ? hs.label : hs.tone === 'owned' ? 'Owned' : '', off: hs.tone === 'max' || (hs.tone === 'installed' && highlighted.type !== 'toggle') };
  }

  const nameOf = highlighted?.name;
  const stateClass = `aw-ws${live ? '' : ' is-away'}${narrow ? ' is-narrow' : ''} is-${layout}`;

  return (
    <div className={stateClass} data-phase={phase} onPointerDownCapture={(e) => { pointerType.current = e.pointerType; if (e.pointerType === 'touch') setLastInput('touch'); }}>
      <div className="aw-ws-view" onPointerDown={onViewDown} onPointerMove={onViewMove} onPointerUp={onViewUp} onPointerCancel={onViewUp} onWheel={onViewWheel} aria-hidden="true" />

      <header className="aw-ws-top">
        <div className="aw-ws-brand">
          <b>Mama&rsquo;s Garage</b>
          <span lang="te">మామా గ్యారేజ్</span>
        </div>
        <div className={`aw-ws-wallet${shake ? ' is-shake' : ''}`} aria-live="polite">
          <small>Wallet</small>
          <b>{fmtRs(shownWallet)}</b>
        </div>
        <button type="button" className="aw-ws-leave" onClick={() => ws.close()}>Leave garage</button>
      </header>

      <aside className="aw-ws-panel" aria-label="Garage menu">
        <div className="aw-ws-head">
          {nav.level > 0 && <button type="button" className="aw-ws-back" onClick={back} aria-label="Back"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" /></svg></button>}
          {nav.level === 0 && narrow && <button type="button" className="aw-ws-back aw-ws-close" onClick={() => ws.close()} aria-label="Leave the garage"><CloseGlyph /></button>}
          <div className="aw-ws-head-text">
            <h2>{title}</h2>
            <p>{crumb}{te && nav.level === 0 ? '' : ''}</p>
          </div>
          <span className="aw-ws-head-te" lang="te">{te}</span>
        </div>
        {hasRepair && nav.level < 2 && (
          <button type="button" className={`aw-ws-fix${wallet < repairQuote ? ' is-part' : ''}`} onClick={doRepair} aria-label={`Repair the dents, ${fmtRs(repairQuote)}${wallet < repairQuote ? ', part job: what you can afford' : ''}`}>
            <span className="aw-ws-fix-main">
              <b>{wallet < repairQuote ? 'Part repair' : 'Repair'}</b>
              <span lang="te">మరమ్మత్తు</span>
            </span>
            <span className="aw-ws-fix-info">{dent}% dented</span>
            <span className="aw-ws-fix-price">{fmtRs(repairQuote)}</span>
            <kbd aria-hidden="true">R</kbd>
          </button>
        )}
        <div className={`aw-ws-list${isGrid ? ' is-grid' : ''}`} role="listbox" aria-label={title}>
          {narrow && card && <div className="aw-ws-card is-inline" role="group" aria-label="Preview">{card}</div>}
          {items.map(renderRow)}
        </div>
        <div className="aw-ws-foot">
          <div className="aw-ws-detail">
            {nav.level === 2 && nameOf && (
              <>
                <b>{nameOf}</b>
                {highlighted.type === 'upgrade' && <span>{highlighted.blurb}</span>}
                {highlighted.type === 'input' && <span>{highlighted.hint}. {highlighted.price > 0 ? `${fmtRs(highlighted.price)} per change.` : ''}</span>}
              </>
            )}
            {nav.level < 2 && (
              <span>
                {cat.blurb}
              </span>
            )}
            {note && <em key={note.text} className={`aw-ws-note is-${note.tone}`} role="status">{note.text}</em>}
          </div>
          {action && (
            <button type="button" className={`aw-ws-buy${action.off ? ' is-off' : ''}`} onClick={activate}>
              <span>{action.label}</span>
              {action.price && <small>{action.price}</small>}
            </button>
          )}
        </div>
      </aside>

      {!narrow && card && <aside className="aw-ws-card is-dock">{card}</aside>}

      {!narrow && (
        <footer className="aw-ws-legend" aria-hidden="true">
          {lastInput === 'pad' ? (
            <>
              <span><kbd>D-pad</kbd> Select</span><span><kbd>A</kbd> Install</span><span><kbd>B</kbd> Back</span><span><kbd>LB</kbd><kbd>RB</kbd> Category</span><span><kbd>R-stick</kbd> Orbit</span><span><kbd>Y</kbd> Leave</span>
            </>
          ) : (
            <>
              <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> Select</span><span><kbd>&larr;</kbd><kbd>&rarr;</kbd> Swatches</span><span><kbd>Enter</kbd> Install</span><span><kbd>Esc</kbd> Back</span><span><kbd>A</kbd><kbd>D</kbd> / drag Orbit</span><span><kbd>Wheel</kbd> Zoom</span>
            </>
          )}
        </footer>
      )}
    </div>
  );
}

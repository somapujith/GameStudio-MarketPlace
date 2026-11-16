// The Power Card hand: a small fan of up to two cards next to the Roll control, and the select -> confirm -> play flow.
// Contract: <PowerTray session placement='panel'|'phone' panelHost? onInfo? />   (docs/POWER_CARDS.md section 3.1)
//   session.options.power   the engine's `{ canPlay, reason?, cards: [{ uid, id, exp, ok, reason?, targets? }] }`; absent = rule off = renders nothing
//   session.dispatch        `{ type: 'PLAY_POWER', card: uid }` or, for Swap Tiles only, `{ ..., target: playerId }` (the key is omitted otherwise)
//   placement 'panel'       the wide control panel: the fan sits in the die row (left of the die), the detail panel is portalled into `panelHost`
//                           (the Play pane, ControlPanel passes it) and falls back to rendering in place when there is none
//   placement 'phone'       inside the phone board centre (PhoneCentre): the fan is a bottom-left layer beside the die, the panel opens over the hero art
//   onInfo                  optional: opens the Power cards guide
// DOM events (window CustomEvents, so other layers need no prop plumbing; both are fire-and-forget):
//   `hg:power-guide`  detail { source: 'tray' }  the info button was pressed. The guide sheet listens and opens itself.
//   `hg:power-target` detail { ids: string[], card?: uid, picked?: id|null }  Swap Tiles targeting is on: these rivals are eligible
//                     (the board may ring them). Sent again with { ids: [] } when targeting ends (cancel, confirm, unmount).
// The tray never covers a board tile (it lives in the centre) and never moves the Roll button (it is not in the action row).
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sfx } from '@/lib/sfx.js';
import Icon from '../ui/Icon.jsx';
import PowerCard from './PowerCard.jsx';
import PowerCardArt from './PowerCardArt.jsx';
import PowerCoach from './PowerCoach.jsx';
import TargetPicker from './TargetPicker.jsx';
import {
  INITIAL_SELECTION, PIPS, POWER_GUIDE_EVENT, POWER_TARGET_EVENT, buildPowerView, handKey, needsTarget, playAction, roundsLeft,
  selectionReducer, stepIndex, targetsFor,
} from './powerModel.js';
import '@/styles/power.css';

const PENDING_MS = 8000; // the server answers well within this; after it the card simply returns to the hand
const ARRIVE_MS = 700;
const CRUMBLE_MS = 760;
const TOAST_MS = 5000;

const emit = (name, detail) => {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* no DOM (tests, SSR) */ }
};
const click = () => {
  try { sfx.play('click'); } catch { /* sound is optional */ }
};

/** Diffs the hand between renders: new uids pop in, an expired card leaves a crumbling ghost. Never on mount, never for a played card. */
function useHandMotion(cards, round, playedUid) {
  const prev = useRef(cards);
  const timers = useRef([]);
  const [fresh, setFresh] = useState(null);
  const [ghosts, setGhosts] = useState([]);
  useEffect(() => {
    const before = prev.current;
    prev.current = cards;
    if (handKey(before) === handKey(cards)) return;
    const now = new Set(cards.map((c) => c.uid));
    const was = new Set(before.map((c) => c.uid));
    const added = cards.filter((c) => !was.has(c.uid)).map((c) => c.uid);
    const gone = before
      .map((card, i) => ({ card, i, n: before.length, key: `${card.uid}:${i}` }))
      .filter((g) => !now.has(g.card.uid) && g.card.uid !== playedUid.current && roundsLeft(g.card.exp, round) === 0);
    if (added.length) {
      setFresh(new Set(added));
      timers.current.push(setTimeout(() => setFresh(null), ARRIVE_MS));
    }
    if (gone.length) {
      setGhosts((gs) => [...gs, ...gone]);
      timers.current.push(setTimeout(() => setGhosts((gs) => gs.filter((g) => !gone.includes(g))), CRUMBLE_MS));
    }
  }, [cards, round, playedUid]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  return { fresh, ghosts };
}

function Pips({ ex }) {
  return (
    <span className={`pw-pips${ex.last ? ' is-last' : ''}`} aria-hidden="true">
      {Array.from({ length: PIPS }, (_, i) => <i key={i} className={ex.pips[i] ? 'is-on' : ''} />)}
    </span>
  );
}

function Tray({ session, model, placement, panelHost, onInfo }) {
  const [st, act] = useReducer(selectionReducer, INITIAL_SELECTION);
  const pid = `pw${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const { cards } = model;
  const n = cards.length;
  const selCard = cards.find((c) => c.uid === st.sel) || null;
  const [focusIdx, setFocusIdx] = useState(0);
  const [live, setLive] = useState('');
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const cardEls = useRef({});
  const playBtn = useRef(null);
  const firstTarget = useRef(null);
  const confirmBtn = useRef(null);
  const restoreUid = useRef(null);
  const lastSel = useRef(null);
  const playedUid = useRef(null);
  const sawBlank = useRef(false);
  const { fresh, ghosts } = useHandMotion(cards, model.round, playedUid);

  if (selCard) lastSel.current = selCard;
  const idx = Math.min(focusIdx, Math.max(0, n - 1));

  /* ---- the server decides ---- */
  const fail = useCallback((message) => act({ type: 'failed', message }), []);
  useEffect(() => {
    if (st.step !== 'pending') { sawBlank.current = false; return undefined; }
    if (model.played) {
      playedUid.current = st.sel;
      setLive(`${lastSel.current?.name || 'Card'} played.`);
      act({ type: 'resolved' });
      return undefined;
    }
    if (!selCard) { // the card left the hand: played (the presenter caught up) or gone
      act({ type: 'resolved' });
      return undefined;
    }
    if (model.blank) sawBlank.current = true;
    else if (sawBlank.current) { // options came back and the card is still here, not played: the server said no
      fail(`${selCard.name} could not be played. Try again.`);
      return undefined;
    }
    const t = setTimeout(() => fail('The table did not answer. Try again.'), PENDING_MS);
    return () => clearTimeout(t);
  }, [st.step, st.sel, model.played, model.blank, selCard, fail]);

  /* a selected card that disappears (expired, hand changed) closes the panel */
  useEffect(() => {
    if (st.sel && !selCard && st.step !== 'pending') act({ type: 'resolved' });
  }, [st.sel, st.step, selCard]);

  /* expired cards are announced (the presenter's toast is separate) */
  const knownRef = useRef(cards);
  useEffect(() => {
    const before = knownRef.current;
    knownRef.current = cards;
    if (handKey(before) === handKey(cards)) return;
    const now = new Set(cards.map((c) => c.uid));
    const dead = before.filter((c) => !now.has(c.uid) && c.uid !== playedUid.current && roundsLeft(c.exp, model.round) === 0);
    if (dead.length) setLive(dead.length === 1 ? `${dead[0].name} expired.` : `${dead.length} power cards expired.`);
    else if (cards.length > before.length) setLive('You drew a power card.');
  }, [cards, model.round]);

  /* ---- toast ---- */
  useEffect(() => {
    if (!st.error) return undefined;
    const t = setTimeout(() => act({ type: 'clearError' }), TOAST_MS);
    return () => clearTimeout(t);
  }, [st.error]);

  /* ---- focus: Play on open, the first rival / Confirm in targeting, the card again on close ---- */
  useEffect(() => {
    const go = (el) => el && el.focus({ preventScroll: true });
    if (st.step === 'detail') go(playBtn.current);
    else if (st.step === 'target') go(firstTarget.current);
    else if (st.step === 'confirm') go(confirmBtn.current);
    else if (st.step === 'idle' && restoreUid.current) {
      go(cardEls.current[restoreUid.current]);
      restoreUid.current = null;
    }
  }, [st.step]);

  /* ---- Swap Tiles: tell the board which rivals are eligible ---- */
  const swapTargets = useMemo(() => (selCard && needsTarget(selCard) ? targetsFor(model, selCard) : []), [model, selCard]);
  const eligible = (st.step === 'target' || st.step === 'confirm') ? swapTargets.filter((r) => r.ok).map((r) => r.id) : [];
  const eligibleKey = eligible.join('|');
  useEffect(() => {
    if (!eligibleKey) return undefined;
    emit(POWER_TARGET_EVENT, { ids: eligibleKey.split('|'), card: st.sel, picked: st.target });
    return () => emit(POWER_TARGET_EVENT, { ids: [] });
  }, [eligibleKey, st.sel, st.target]);

  /* ---- a tap anywhere else closes the panel (never while the server is deciding) ---- */
  const open = st.step !== 'idle' && st.step !== 'pending';
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      restoreUid.current = null;
      act({ type: 'cancel' });
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  /* ---- handlers ---- */
  const onCard = useCallback((e) => {
    const uid = e.currentTarget.dataset.uid;
    restoreUid.current = uid;
    click();
    act({ type: 'select', uid });
  }, []);

  const send = (card, target) => {
    const sent = session.dispatch?.(playAction(card, target));
    if (sent === false) fail('The table is busy. Try again in a moment.');
  };
  const onPlay = () => {
    if (!selCard || !selCard.ok || st.step !== 'detail') return;
    click();
    if (needsTarget(selCard)) { act({ type: 'play', needsTarget: true }); return; }
    act({ type: 'play', needsTarget: false });
    send(selCard);
  };
  const onConfirm = () => {
    if (!selCard || st.step !== 'confirm' || !st.target) return;
    click();
    act({ type: 'confirm' });
    send(selCard, st.target);
  };
  const cancel = () => act({ type: 'cancel' });
  const back = () => act({ type: 'back' });

  const info = () => {
    emit(POWER_GUIDE_EVENT, { source: 'tray' });
    onInfo?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    const uid = e.target?.dataset?.uid;
    if (!uid) return;
    const to = stepIndex(cards.findIndex((c) => c.uid === uid), e.key, n);
    if (to < 0) return;
    e.preventDefault();
    setFocusIdx(to);
    cardEls.current[cards[to].uid]?.focus();
  };

  /* ---- render ---- */
  const nowPlaying = st.step === 'pending';
  const showTargets = !!selCard && needsTarget(selCard) && (st.step === 'target' || st.step === 'confirm' || (nowPlaying && st.target));
  const whyId = `${pid}-why`;

  const panel = selCard && st.step !== 'idle' ? (
    <div
      ref={panelRef}
      className={`pw-panel pw-tone-${selCard.tone}`}
      role="group"
      aria-labelledby={`${pid}-t`}
      aria-busy={nowPlaying || undefined}
      data-step={showTargets ? (st.step === 'target' ? 'target' : 'confirm') : st.step}
      data-placement={placement}
    >
      <div className="pw-panel__head">
        <span className="pw-panel__art"><PowerCardArt id={selCard.id} size={44} /></span>
        <div className="pw-panel__title">
          <p className="pw-panel__name" id={`${pid}-t`}>{selCard.name}</p>
          {selCard.expiry.left != null ? (
            <p className={`pw-panel__exp${selCard.expiry.last ? ' is-last' : ''}`}>
              <Pips ex={selCard.expiry} />
              <span>{selCard.expiry.text}</span>
            </p>
          ) : null}
        </div>
        <button type="button" className="pw-panel__help" onClick={info} aria-label="How power cards work" title="How power cards work">
          <Icon name="info" size={18} />
        </button>
      </div>

      {showTargets ? (
        <TargetPicker
          rivals={swapTargets}
          picked={st.target}
          pending={nowPlaying}
          onPick={(id) => { click(); act({ type: 'pick', id }); }}
          onConfirm={onConfirm}
          onBack={back}
          confirmRef={confirmBtn}
          firstRef={firstTarget}
          idPrefix={pid}
        />
      ) : (
        <>
          <div className="pw-panel__body">
            {!selCard.ok ? <p className="pw-why" id={whyId}><Icon name="info" size={15} /><span>{selCard.reason}</span></p> : null}
            <p className="pw-panel__long">{selCard.long}</p>
          </div>
          <div className="pw-acts">
            <button type="button" className="pw-btn" onClick={cancel} disabled={nowPlaying}>Cancel</button>
            <button
              type="button"
              ref={playBtn}
              className="pw-btn pw-btn--primary"
              onClick={onPlay}
              aria-disabled={!selCard.ok || undefined}
              aria-busy={nowPlaying || undefined}
              aria-describedby={selCard.ok ? undefined : whyId}
            >
              {nowPlaying ? (<><i className="pw-spin" aria-hidden="true" />Playing…</>) : 'Play card'}
            </button>
          </div>
        </>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="pw-tray"
      data-fx-power-tray=""
      data-placement={placement}
      data-n={n}
      data-step={st.step}
      data-played={model.played || undefined}
      onKeyDown={onKeyDown}
    >
      {n === 0 ? (
        <div className="pw-empty">
          <span className="pw-empty__txt">No power cards</span>
          <button type="button" className="pw-info" onClick={info} aria-label="About power cards" title="About power cards">
            <Icon name="info" size={18} />
          </button>
        </div>
      ) : (
        <>
          <div className="pw-fan" role="group" aria-label={`Your power cards, ${n} of 2`} data-pending={nowPlaying || undefined}>
            {cards.map((c, i) => {
              const dim = !c.ok;
              return (
                <div key={c.uid} className="pw-slot" style={{ '--i': i, '--n': n }} data-new={fresh?.has(c.uid) || undefined} data-sel={c.uid === st.sel || undefined}>
                  <PowerCard
                    id={c.id}
                    left={c.left}
                    selected={c.uid === st.sel && st.step !== 'idle'}
                    dimmed={dim}
                    describedBy={dim ? `${pid}-r${i}` : undefined}
                    tabIndex={i === idx ? 0 : -1}
                    innerRef={(el) => { if (el) cardEls.current[c.uid] = el; else delete cardEls.current[c.uid]; }}
                    data-uid={c.uid}
                    data-fx-power-card={c.uid}
                    aria-expanded={c.uid === st.sel && st.step !== 'idle'}
                    onClick={onCard}
                  />
                  {dim ? <span className="pw-sr" id={`${pid}-r${i}`}>{c.reason}</span> : null}
                </div>
              );
            })}
            {ghosts.map((g) => (
              <span key={g.key} className="pw-ghost" style={{ '--i': g.i, '--n': g.n }} aria-hidden="true">
                <PowerCard id={g.card.id} variant="face" />
              </span>
            ))}
          </div>
          {model.played ? <span className="pw-played">Played this turn</span> : null}
        </>
      )}
      <PowerCoach hasCards={n > 0} hidden={st.step !== 'idle'} />
      {st.error ? <p className="pw-toast" role="alert">{st.error}</p> : null}
      <p className="pw-live pw-sr" role="status" aria-live="polite">{live}</p>
      {panel && placement === 'panel' && panelHost ? createPortal(panel, panelHost) : panel}
    </div>
  );
}

export default function PowerTray({ session, placement = 'panel', panelHost = null, onInfo }) {
  const model = useMemo(
    () => buildPowerView(session),
    // the model only reads these; everything else on the session changes constantly during play
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.options, session?.view, session?.display, session?.me],
  );
  if (!model.on) return null;
  return <Tray session={session} model={model} placement={placement} panelHost={panelHost} onInfo={onInfo} />;
}

// The whole game screen. Depends ONLY on the `session` interface (docs/CONTRACT.md section 6) plus the Hustle additions
// (session.clock, roomPlayers, card, handoff, flights; docs/HUSTLE_PLAN.md 3.9).
//   >= 960px: [ player pods | square board (control panel in its centre) | player pods + chat ]: players sit at the board's corners
//   < 960px:  pods in a row above and a row below the board, chat under it
//   < 600px:  portrait phone: the simple table (phone/PhoneTable.jsx): top bar, board, players, one big action button, chat bar
//             (it replaces the pods / control panel / dock below; everything else on this screen is shared)
//   short landscape (phones on their side): [opponents | board | wallet bar + dock]
//   (phones: the chat lives in a tray that the dock's Chat button opens; see turn/ChatTray.jsx and styles/gamemobile.css)
// Overlays over the board: turn hand-off banner, card reveal, the Snatch pop-up (phones: a floating panel above the action
// row, inside PhoneTable); fixed overlays: speech bubbles, emote pops, coin flights.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '@/lib/sfx.js';
import Board from './Board.jsx';
import ControlPanel, { panelBadges } from './ControlPanel.jsx';
import { useActionSpec } from './ActionBar.jsx';
import PlayerPods, { usesMiddleEdges } from './PlayerPods.jsx';
import PlayerSheet, { StatsSheet } from './PlayerSheet.jsx';
import PropertySheet from './PropertySheet.jsx';
import AuctionSheet from './AuctionSheet.jsx';
import { LogSheet } from './LogPanel.jsx';
import EmoteBar from './EmoteBar.jsx';
import GameOverModal from './GameOverModal.jsx';
import MenuSheet from './MenuSheet.jsx';
import RulesSheet from './RulesSheet.jsx';
import TradeSheet from './TradeSheet.jsx';
import DebtSheet from './DebtSheet.jsx';
import SetCelebration from './SetCelebration.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';
import Icon from './ui/Icon.jsx';
import { useIsWide, useMedia, useReducedMotion } from './ui/helpers.js';
import { useGameChrome, useKeyboardInset, useLayoutMode } from './ui/viewport.js';
import RoundBadge, { TargetBadge } from './turn/RoundBadge.jsx';
import NetRace, { ConnChip, LeaderChip } from './ui/NetRace.jsx';
import { TargetToasts, useTargetWatch, withNotes } from './turn/TargetWatch.jsx';
import { RESIGN_CONFIRM, RESIGN_KEEP, RESIGN_TEXT, RESIGN_TITLE, canResign, leaveDialog, useResign } from './turn/resign.js';
import { targetOf } from './turn/target.js';
import TurnBanner from './turn/TurnBanner.jsx';
import CardReveal, { useCardAnnouncer } from './turn/CardReveal.jsx';
import SnatchPopup, { useSnatchAnnouncer } from './SnatchPopup.jsx';
import SpeechBubble, { EmoteFloats } from './turn/SpeechBubble.jsx';
import ActionDock from './turn/ActionDock.jsx';
import ChatTray from './turn/ChatTray.jsx';
import ManageSheet from './turn/ManageSheet.jsx';
import PhoneTable from './phone/PhoneTable.jsx';
import { useTurnAlerts } from './turn/clock.js';
import { modeLabel } from './turn/room.js';
import '../../styles/game.css';
import '../../styles/turn.css';
import '../../styles/gamemobile.css';
import FxLayer from './fx/FxLayer.jsx';
import ActivityFeed from './feed/ActivityFeed.jsx';
import FeedToasts from './feed/FeedToasts.jsx';


/** Portrait phones get the wallet bar + bottom action dock. */
export const usePhone = () => useLayoutMode() === 'phone';

/** Reports the height of `ref` as --hg-dock on the game root and <html> (the board is sized from it; shell toasts sit above it). */
function useReportHeight(ref, on) {
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.closest('.hg-game');
    if (!on || !el || !root) return undefined;
    const doc = document.documentElement;
    const set = () => {
      const h = `${Math.ceil(el.getBoundingClientRect().height)}px`;
      root.style.setProperty('--hg-dock', h);
      doc.style.setProperty('--hg-dock', h);
    };
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--hg-dock');
      doc.style.removeProperty('--hg-dock');
    };
  }, [ref, on]);
}

function TopBar({ session, onBack, onMenu }) {
  const cfg = session.display?.cfg || session.view?.cfg;
  return (
    <header className="hg-top" data-goal={targetOf(cfg) ? '' : undefined}>
      <button type="button" className="hg-roundbtn" onClick={onBack} aria-label="Leave game">
        <Icon name="back" size={22} strokeWidth={2.4} />
      </button>
      <div className="hg-top-mid">
        <div className="hg-top-row">
          <span className="hg-table-title"><i className="hg-table-mark" aria-hidden="true" />HYDERABAD TYCOON</span>
          <p className="hg-goal">
            <span className="hg-mode">{modeLabel(cfg)}</span>
            <span className="hg-goal-sep" aria-hidden="true">&middot;</span>
            <RoundBadge session={session} />
            <TargetBadge session={session} bar />
            <LeaderChip session={session} />
          </p>
        </div>
        <NetRace session={session} />
      </div>
      <div className="hg-top-end">
        <ConnChip session={session} />
        <button type="button" className="hg-roundbtn" onClick={onMenu} aria-label="Menu" aria-haspopup="dialog">
          <Icon name="more" size={22} />
        </button>
      </div>
    </header>
  );
}

/**
 * The table's one polite live region: always mounted, starts empty; `say(text)` clears it and sets the new line a
 * beat later so a repeated line is read again. Used for card reveals and the one "10 seconds left" warning.
 */
export function useLiveRegion() {
  const [text, setText] = useState('');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = useCallback((line) => {
    clearTimeout(timer.current);
    setText('');
    if (!line) return;
    timer.current = setTimeout(() => setText(String(line)), 60);
  }, []);
  return [text, say];
}

/** The trade deadline for TradeSheet: only when the clock is waiting on the trade's answer. */
export function tradeDeadline(session) {
  const t = session?.view?.trade;
  const c = session?.clock;
  if (!t || !c?.deadline || !Array.isArray(c.waitingFor)) return undefined;
  return c.waitingFor.map(String).includes(String(t.to)) ? c.deadline : undefined;
}

export default function GameView({ session: rawSession, onExit }) {
  const resign = useResign(rawSession);
  // the screen's session: the real one plus what only this screen knows (you resigned / are resigning) and the heads-up log notes
  const base = useMemo(() => ({ ...rawSession, resigned: resign.resigned, resigning: resign.resigning }), [rawSession, resign.resigned, resign.resigning]);
  const wide = useIsWide();
  const layout = useLayoutMode();
  const compact = layout !== 'wide'; // phones: portrait ('phone') and on their side ('land')
  const portrait = useMedia('(orientation: portrait)');
  const phoneSimple = layout === 'phone' && portrait; // portrait phones get the simple table (phone/PhoneTable.jsx)
  const reduced = useReducedMotion();
  const [tileId, setTileId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [rules, setRules] = useState(false);
  const [stats, setStats] = useState(false);
  const [trade, setTrade] = useState(false);
  const [manage, setManage] = useState(null); // null | 'manage' | 'trade' (phones)
  const [logOpen, setLogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const bottomRef = useRef(null);
  const [confirm, setConfirm] = useState(false);
  const unlocked = useRef(false);
  const ready = !!(base?.view && base?.display);
  useGameChrome();
  useKeyboardInset(compact);
  useReportHeight(bottomRef, compact && ready);
  useEffect(() => { if (!compact) setChatOpen(false); }, [compact]);

  // one action spec + the one Space / Enter shortcut for the whole screen (panel and dock share it)
  const actions = useActionSpec(ready ? base : { options: {}, view: { players: [] }, me: '', dispatch: () => {} }, { keys: ready });
  const [liveText, say] = useLiveRegion();
  useTurnAlerts(base, say);
  useCardAnnouncer(base, say);
  useSnatchAnnouncer(base, say);
  const { toasts: targetToasts, notes: targetNotes } = useTargetWatch(base, say);
  const session = useMemo(() => withNotes(base, targetNotes), [base, targetNotes]);
  useEffect(() => {
    if (resign.resigned) say('You resigned. You are out of the game and can watch the rest of it.');
  }, [resign.resigned, say]);

  const openTile = useCallback((id) => setTileId(id), []);
  const closeTile = useCallback(() => setTileId(null), []);
  const openTrade = useCallback(() => setTrade(true), []);

  /* the optional night-market ambient bed plays only while the game screen is open (Settings > Ambient) */
  useEffect(() => {
    try { sfx.setScene?.(true); } catch { /* optional */ }
    return () => { try { sfx.setScene?.(false); } catch { /* optional */ } };
  }, []);

  /* WebAudio needs a user gesture */
  useEffect(() => {
    const unlock = () => {
      if (unlocked.current) return;
      unlocked.current = true;
      try { sfx.unlock?.(); } catch { /* optional */ }
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  if (!ready) {
    return (
      <div className="hg-game hg-game--loading" role="status">
        <p>Loading game&hellip;</p>
      </div>
    );
  }

  const leave = leaveDialog(resign.status);
  const badges = panelBadges(actions.spec, session);
  const playerCount = (session.display?.players ?? session.view?.players ?? []).length;
  const seated = (session.display?.players ?? session.view?.players ?? []).some((p) => p.id === session.me);
  const opponents = Math.max(0, playerCount - (seated ? 1 : 0));

  return (
    <div
      className={`hg-game${compact ? ` hg-game--compact hg-game--${layout}` : ''}`}
      data-wide={wide ? '' : undefined}
      data-rm={reduced ? '' : undefined}
      data-layout={phoneSimple ? 'phone-simple' : undefined}
    >
      <h1 className="hg-sr">Hyderabad Tycoon</h1>
      <p className="hg-sr" aria-live="polite" aria-atomic="true" data-testid="table-live">{liveText}</p>
      {phoneSimple ? (
        <PhoneTable
          session={session}
          actions={actions}
          badges={badges}
          highlightTile={tileId}
          overlays={(
            <>
              <SetCelebration session={session} />
              <TargetToasts toasts={targetToasts} />
              <TurnBanner session={session} />
              <CardReveal session={session} />
            </>
          )}
          onBack={() => setConfirm(true)}
          onMenu={() => setMenu(true)}
          onSelectPlayer={setPlayerId}
          onOpenTile={openTile}
          onManage={() => setManage('manage')}
          onTrade={openTrade}
          onManageTrade={() => setManage('trade')}
        />
      ) : <TopBar session={session} onBack={() => setConfirm(true)} onMenu={() => setMenu(true)} />}

      {phoneSimple ? null : <main className="hg-table" aria-label="Game table" data-n={playerCount} data-opp={opponents} data-mid={usesMiddleEdges(playerCount) ? '' : undefined} data-goal={targetOf(session.display?.cfg || session.view?.cfg) ? '' : undefined}>
        <PlayerPods session={session} onSelect={setPlayerId} mode={compact ? 'others' : 'all'} layout={layout} />
        <div className="hg-boardcol">
          <div className="hg-boardwrap">
            <Board
              session={session}
              onTileClick={openTile}
              highlightTile={tileId}
              center={(
                <ControlPanel
                  session={session}
                  onOpenTile={openTile}
                  onOpenTrade={openTrade}
                  actions={actions}
                  docked={compact}
                />
              )}
            />
            <SetCelebration session={session} />
            <TargetToasts toasts={targetToasts} />
            <TurnBanner session={session} />
            <CardReveal session={session} />
            <SnatchPopup session={session} placement="board" />
          </div>
        </div>
        {compact || usesMiddleEdges(playerCount) ? null : <div className="hg-feedcard"><ActivityFeed session={session} max={14} /></div>}
        {compact ? null : <div className="hg-chatcard">{usesMiddleEdges(playerCount) ? <ActivityFeed session={session} max={3} compact /> : null}<EmoteBar session={session} /></div>}
      </main>}

      {compact && !phoneSimple ? (
        <div className="hg-bottom" ref={bottomRef}>
          {seated ? <PlayerPods session={session} onSelect={setPlayerId} mode="me" layout={layout} /> : null}
          <ActionDock
            session={session}
            spec={actions.spec}
            fire={actions.fire}
            badges={badges}
            chatOpen={chatOpen}
            onChat={() => setChatOpen((v) => !v)}
            onManage={() => setManage('manage')}
            onTrade={() => setManage('trade')}
          />
        </div>
      ) : null}
      {compact && !phoneSimple ? <ChatTray open={chatOpen} onClose={() => setChatOpen(false)}><EmoteBar session={session} /></ChatTray> : null}

      <SpeechBubble session={session} />
      <EmoteFloats session={session} />
      <FxLayer flights={session.flights || []} session={session} />
      <FeedToasts session={session} />

      <PropertySheet session={session} tileId={tileId} onClose={closeTile} />
      <PlayerSheet
        session={session}
        playerId={playerId}
        onClose={() => setPlayerId(null)}
        onOpenTile={openTile}
        onResign={canResign(session) ? () => { setPlayerId(null); resign.ask(); } : undefined}
      />
      <StatsSheet session={session} open={stats} onClose={() => setStats(false)} onOpenTile={openTile} />
      <TradeSheet session={session} open={trade} onClose={() => setTrade(false)} deadline={tradeDeadline(session)} />
      <AuctionSheet session={session} />
      <DebtSheet session={session} />
      {compact ? (
        <ManageSheet
          session={session}
          open={!!manage}
          tab={manage || 'manage'}
          onTab={setManage}
          onClose={() => setManage(null)}
          onOpenTile={openTile}
          onOpenTrade={() => { setManage(null); openTrade(); }}
        />
      ) : null}
      <MenuSheet
        session={session}
        open={menu}
        onClose={() => setMenu(false)}
        onRules={() => setRules(true)}
        onStats={() => { setMenu(false); setStats(true); }}
        onLog={() => { setMenu(false); setLogOpen(true); }}
        onManage={phoneSimple ? () => { setMenu(false); setManage('manage'); } : undefined}
        onTrade={phoneSimple ? () => { setMenu(false); setManage('trade'); } : undefined}
        onQuit={() => setConfirm(true)}
        onResign={resign.ask}
      />
      <LogSheet session={session} open={logOpen} onClose={() => setLogOpen(false)} />
      <RulesSheet session={session} open={rules} onClose={() => setRules(false)} />
      <ConfirmDialog
        open={resign.asking && canResign(session)}
        title={RESIGN_TITLE}
        text={RESIGN_TEXT}
        confirmLabel={RESIGN_CONFIRM}
        cancelLabel={RESIGN_KEEP}
        danger
        onCancel={resign.cancel}
        onConfirm={() => { setMenu(false); resign.confirm(); }}
      />
      <ConfirmDialog
        open={confirm}
        title={leave.title}
        text={leave.text}
        confirmLabel={leave.confirm}
        cancelLabel={leave.cancel}
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); setMenu(false); onExit?.(); }}
      />
      <GameOverModal session={session} onExit={onExit} />
    </div>
  );
}

export { GameView };

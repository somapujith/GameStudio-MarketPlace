// The whole game screen. Depends ONLY on the `session` interface (docs/CONTRACT.md section 6) plus the Hustle additions
// (session.clock, roomPlayers, card, handoff, flights; docs/HUSTLE_PLAN.md 3.9).
//   >= 960px: [ player pods | square board (control panel in its centre) | player pods + chat ]: players sit at the board's corners
//   < 960px:  pods in a row above and a row below the board, chat under it
//   < 600px:  the same at full width, plus a fixed bottom action dock
// Overlays over the board: turn hand-off banner, card reveal; fixed overlays: speech bubbles, emote pops, coin flights.
import { useCallback, useEffect, useRef, useState } from 'react';
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
import RoundBadge from './turn/RoundBadge.jsx';
import TurnBanner from './turn/TurnBanner.jsx';
import CardReveal, { useCardAnnouncer } from './turn/CardReveal.jsx';
import SpeechBubble, { EmoteFloats } from './turn/SpeechBubble.jsx';
import ActionDock from './turn/ActionDock.jsx';
import ManageSheet from './turn/ManageSheet.jsx';
import { useTurnAlerts } from './turn/clock.js';
import { modeLabel } from './turn/room.js';
import '../../styles/game.css';
import '../../styles/turn.css';
import FxLayer from './fx/FxLayer.jsx';


/** Phones get the bottom action dock. */
export const usePhone = () => useMedia('(max-width: 599px)');

function TopBar({ session, onBack, onMenu }) {
  const cfg = session.display?.cfg || session.view?.cfg;
  return (
    <header className="hg-top">
      <button type="button" className="hg-roundbtn" onClick={onBack} aria-label="Leave game">
        <Icon name="back" size={22} strokeWidth={2.4} />
      </button>
      <div className="hg-top-mid">
        <span className="hg-table-title"><i className="hg-table-mark" aria-hidden="true" />HYDERABAD TYCOON</span>
        <p className="hg-goal">
          <span className="hg-mode">{modeLabel(cfg)}</span>
          <span className="hg-goal-sep" aria-hidden="true">&middot;</span>
          <RoundBadge session={session} />
        </p>
      </div>
      <button type="button" className="hg-roundbtn" onClick={onMenu} aria-label="Menu" aria-haspopup="dialog">
        <Icon name="more" size={22} />
      </button>
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

export default function GameView({ session, onExit }) {
  const wide = useIsWide();
  const phone = usePhone();
  const reduced = useReducedMotion();
  const [tileId, setTileId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [rules, setRules] = useState(false);
  const [stats, setStats] = useState(false);
  const [trade, setTrade] = useState(false);
  const [manage, setManage] = useState(null); // null | 'manage' | 'trade' (phones)
  const [logOpen, setLogOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const unlocked = useRef(false);
  const ready = !!(session?.view && session?.display);

  // one action spec + the one Space / Enter shortcut for the whole screen (panel and dock share it)
  const actions = useActionSpec(ready ? session : { options: {}, view: { players: [] }, me: '', dispatch: () => {} }, { keys: ready });
  const [liveText, say] = useLiveRegion();
  useTurnAlerts(session, say);
  useCardAnnouncer(session, say);

  const openTile = useCallback((id) => setTileId(id), []);
  const closeTile = useCallback(() => setTileId(null), []);
  const openTrade = useCallback(() => setTrade(true), []);

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

  const badges = panelBadges(actions.spec, session);
  const playerCount = (session.display?.players ?? session.view?.players ?? []).length;

  return (
    <div
      className={`hg-game${phone ? ' hg-game--phone' : ''}`}
      data-wide={wide ? '' : undefined}
      data-rm={reduced ? '' : undefined}
    >
      <h1 className="hg-sr">Hyderabad Tycoon</h1>
      <p className="hg-sr" aria-live="polite" aria-atomic="true" data-testid="table-live">{liveText}</p>
      <TopBar session={session} onBack={() => setConfirm(true)} onMenu={() => setMenu(true)} />

      <main className="hg-table" aria-label="Game table" data-n={playerCount} data-mid={usesMiddleEdges(playerCount) ? '' : undefined}>
        <PlayerPods session={session} onSelect={setPlayerId} />
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
                  docked={phone}
                />
              )}
            />
            <SetCelebration session={session} />
            <TurnBanner session={session} />
            <CardReveal session={session} />
          </div>
        </div>
        <div className="hg-chatcard"><EmoteBar session={session} /></div>
      </main>

      {phone ? (
        <ActionDock
          session={session}
          spec={actions.spec}
          fire={actions.fire}
          badges={badges}
          onManage={() => setManage('manage')}
          onTrade={() => setManage('trade')}
        />
      ) : null}

      <SpeechBubble session={session} />
      <EmoteFloats session={session} />
      <FxLayer flights={session.flights || []} />

      <PropertySheet session={session} tileId={tileId} onClose={closeTile} />
      <PlayerSheet session={session} playerId={playerId} onClose={() => setPlayerId(null)} onOpenTile={openTile} />
      <StatsSheet session={session} open={stats} onClose={() => setStats(false)} onOpenTile={openTile} />
      <TradeSheet session={session} open={trade} onClose={() => setTrade(false)} deadline={tradeDeadline(session)} />
      <AuctionSheet session={session} />
      <DebtSheet session={session} />
      {phone ? (
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
        onQuit={() => setConfirm(true)}
      />
      <LogSheet session={session} open={logOpen} onClose={() => setLogOpen(false)} />
      <RulesSheet session={session} open={rules} onClose={() => setRules(false)} />
      <ConfirmDialog
        open={confirm}
        title="Leave the game?"
        text="You will leave this match."
        confirmLabel="Leave"
        cancelLabel="Keep playing"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); setMenu(false); onExit?.(); }}
      />
      <GameOverModal session={session} onExit={onExit} />
    </div>
  );
}

export { GameView };

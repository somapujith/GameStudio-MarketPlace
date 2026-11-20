// The whole table on a portrait phone, kept as simple as a two-player board game:
//   top bar            back · "₹50L net worth to win · Round 7 of 20" · menu
//   board              full width; its centre is the calm PhoneCentre (caption, tile chip, hero art, the die)
//   buy popup          a card over the board while I decide on a district (decision/DecisionCard.jsx does the same for a transport ride / the Traffic Jam)
//   players            avatar + piece + name + "cash (net worth)" for everyone, "Your turn" under whoever plays
//   snatch pop-up      a floating panel just above the action row while a Snatch window is open (zero-height slot: nothing moves)
//   action row         ONE big button (Roll / Buy / End turn ...), Manage and Trade beside it
//   chat bar           "Say hello…", emoji, send
// Everything else (rules, log, stats, sound, resign) is behind the "..." menu. GameView renders this instead of its pods,
// control panel and dock when `layout === 'phone'` and the screen is in portrait; every sheet, banner and effect it already
// owns still works on top (see styles/phone.css for the z-order and the sizing).
import { useMemo, useState } from 'react';
import { TILES } from '@shared/board.js';
import Board from '../Board.jsx';
import PhoneBoardContext from './PhoneBoardContext.js';
import PhoneTopBar from './PhoneTopBar.jsx';
import PhoneCentre from './PhoneCentre.jsx';
import PhonePlayers from './PhonePlayers.jsx';
import PhoneActions from './PhoneActions.jsx';
import PhoneChatBar from './PhoneChatBar.jsx';
import BuyCard from './BuyCard.jsx';
import SnatchPopup from '../SnatchPopup.jsx';
import DecisionCard, { useDecisionCard } from '../decision/DecisionCard.jsx';
import { buyActions, buyCardData } from './phoneModel.js';
import { tradeStatus } from '../ui/tradeModel.js';
import '../../../styles/phone.css';
import '../../../styles/phoneboard.css';

/** The district I am being asked to buy (or pass on), or null. */
export function buyDecision(session, spec) {
  const pend = session?.view?.pending;
  if (!(spec?.kind === 'buy' || spec?.kind === 'skip') || pend?.type !== 'buy') return null;
  const tile = TILES[pend.tile];
  return tile ? { tile, pend } : null;
}

export default function PhoneTable({
  session, actions, badges = {}, highlightTile = null, overlays = null,
  onBack, onMenu, onSelectPlayer, onOpenTile, onManage, onTrade, onManageTrade,
}) {
  const { spec, fire } = actions;
  const [hidden, setHidden] = useState('');
  const decision = buyDecision(session, spec);
  const key = decision ? `${decision.tile.id}:${session.view?.turnCount ?? ''}:${session.view?.round ?? ''}` : '';
  const showCard = !!decision && hidden !== key;
  const landing = useDecisionCard(session, spec); // transport ride / Traffic Jam: the other landing decisions, same popup idea
  const me = (session.display?.players ?? session.view?.players ?? []).find((p) => p.id === session.me);
  const data = useMemo(
    () => (decision ? buyCardData(decision.tile, {
      cash: me?.cash ?? 0,
      price: decision.pend.price,
      canBuy: !!session.options?.buy,
      cfg: session.view?.cfg,
    }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, me?.cash, session.options?.buy, session.view?.cfg?.rentPercent],
  );
  const doors = buyActions(spec);
  const n = (session.display?.players ?? session.view?.players ?? []).length;

  const onChip = (chip) => {
    if (decision && chip.id === decision.tile.id && hidden === key) setHidden('');
    else onOpenTile?.(chip.id);
  };
  // the Trade button opens the composer when I may propose (or my offer is waiting); otherwise the Trade tab, which says why not
  const canOffer = tradeStatus(session).can || session.view?.trade?.from === session.me;

  return (
    <PhoneBoardContext.Provider value>
      <div className="ph" data-n={n} data-buy={showCard || landing.show ? '' : undefined}>
        <PhoneTopBar session={session} spec={spec} onBack={onBack} onMenu={onMenu} />

        <main className="ph-stage" aria-label="Game table">
          <div className="ph-board" data-fx-board="">
            <Board
              session={session}
              onTileClick={onOpenTile}
              highlightTile={highlightTile}
              center={<PhoneCentre session={session} spec={spec} onChip={onChip} />}
            />
            {overlays}
            {showCard && data ? (
              <BuyCard
                data={data}
                session={session}
                onBuy={doors.buy ? fire(doors.buy) : undefined}
                onPass={doors.skip ? fire(doors.skip) : undefined}
                onDismiss={() => setHidden(key)}
              />
            ) : null}
            {landing.show ? (
              <DecisionCard decision={landing.decision} session={session} fire={fire} onDismiss={landing.hide} placement="phone" />
            ) : null}
          </div>
        </main>

        <PhonePlayers session={session} onSelect={onSelectPlayer} />
        <div className="sn-slot"><SnatchPopup session={session} placement="phone" /></div>
        <PhoneActions
          session={session}
          spec={spec}
          fire={fire}
          badges={badges}
          onManage={onManage}
          onTrade={canOffer ? onTrade : onManageTrade}
          hidePills={showCard ? ['skip'] : landing.show ? (landing.decision.kind === 'ride' ? ['ride'] : ['pay', 'wait']) : undefined}
          reopen={landing.reopen}
        />
        <PhoneChatBar session={session} />
      </div>
    </PhoneBoardContext.Provider>
  );
}

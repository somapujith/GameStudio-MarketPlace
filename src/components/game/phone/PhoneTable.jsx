// The whole table on a portrait phone, kept as simple as a two-player board game:
//   top bar            back · "₹50L net worth to win · Round 7 of 20" · menu
//   board              full width; its centre is the calm PhoneCentre (caption, tile chip, hero art, the die)
//   buy popup          a card over the board while I decide on a district
//   players            avatar + piece + name + "cash (net worth)" for everyone, "Your turn" under whoever plays
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
import { buyActions, buyCardData } from './phoneModel.js';
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
  const me = (session.display?.players ?? session.view?.players ?? []).find((p) => p.id === session.me);
  const data = useMemo(
    () => (decision ? buyCardData(decision.tile, {
      cash: me?.cash ?? 0,
      price: decision.pend.price,
      auction: session.view?.cfg?.auctionOnDecline !== false,
      canBuy: !!session.options?.buy,
    }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, me?.cash, session.options?.buy, session.view?.cfg?.auctionOnDecline],
  );
  const doors = buyActions(spec);
  const n = (session.display?.players ?? session.view?.players ?? []).length;

  const onChip = (chip) => {
    if (decision && chip.id === decision.tile.id && hidden === key) setHidden('');
    else onOpenTile?.(chip.id);
  };
  const canOffer = !!session.options?.trade?.canOffer || !!session.view?.trade;

  return (
    <PhoneBoardContext.Provider value>
      <div className="ph" data-n={n} data-buy={showCard ? '' : undefined}>
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
                onBuy={doors.buy ? fire(doors.buy) : undefined}
                onPass={doors.skip ? fire(doors.skip) : undefined}
                onDismiss={() => setHidden(key)}
              />
            ) : null}
          </div>
        </main>

        <PhonePlayers session={session} onSelect={onSelectPlayer} />
        <PhoneActions
          session={session}
          spec={spec}
          fire={fire}
          badges={badges}
          onManage={onManage}
          onTrade={canOffer ? onTrade : onManageTrade}
          hidePills={showCard ? ['skip'] : undefined}
        />
        <PhoneChatBar session={session} />
      </div>
    </PhoneBoardContext.Provider>
  );
}

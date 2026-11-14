// Tap a scoreboard row: that player's piece, status (turn, stuck in traffic, chai token), net worth split into
// cash / districts / upgrades, match stats (rent, taxes, rides, chai saved ...) and districts by collection.
// StatsSheet ("View stats") shows every player at once, richest first.
import '@/styles/sheets.css';
import { formatINR, compactINR } from '@shared/format.js';
import Sheet from './ui/Sheet.jsx';
import Pill from './ui/Pill.jsx';
import Icon from './ui/Icon.jsx';
import PlayerToken, { artPart, cosmeticsOf } from './ui/PlayerToken.jsx';
import TileChip from './ui/TileChip.jsx';
import { activePlayer, pieceName, setProgress, settingsSummary, useHeld, useStateLike, worthParts } from './ui/helpers.js';

/** One card per collection the player has a district in: name, n/total, chips with their business level. */
function SetCards({ rows, state, onOpenTile }) {
  return (
    <ul className="hg-setlist">
      {rows.map((r) => (
        <li key={r.set.id} className={`hg-setcard${r.full ? ' is-full' : ''}`} style={{ '--sc': r.set.color }}>
          <div className="hg-setcard-head">
            <i className="hg-setdot" />
            <b>{r.set.name}</b>
            <span className={`hg-setprog${r.full ? ' is-full' : ''}`}>{r.owned.length}/{r.total}{r.full ? ' full set' : ''}</span>
          </div>
          <div className="hg-chips">
            {r.owned.map((t) => (
              <TileChip key={t} tileId={t} level={state.levels?.[t] || 0} mortgaged={!!state.mortgaged?.[t]} onClick={onOpenTile} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Status pills: bankrupt, turn, stuck in traffic, chai token. */
export function PlayerTags({ session, p }) {
  const over = session.view?.phase === 'over';
  return (
    <div className="hg-ps-tags">
      {p.bankrupt ? <Pill tone="bad">Bankrupt</Pill> : null}
      {!p.bankrupt && activePlayer(session)?.id === p.id && !over ? <Pill tone="blue">Turn</Pill> : null}
      {!p.bankrupt && p.stuck ? <Pill tone="warn" icon={<span aria-hidden="true">🚦</span>}>Stuck in traffic</Pill> : null}
      {!p.bankrupt && p.chai > 0 ? <Pill tone="gold" icon={<span aria-hidden="true">☕</span>}>Chai token{p.chai > 1 ? ` ×${p.chai}` : ''}</Pill> : null}
    </div>
  );
}

/** Cash / districts / upgrades as numbers and one stacked bar. */
export function WorthBreakdown({ parts, compact = false }) {
  const pos = Math.max(1, parts.cash + parts.districts + parts.upgrades);
  const seg = (v) => `${Math.max(0, (v / pos) * 100)}%`;
  return (
    <div className={`hg-worth${compact ? ' is-compact' : ''}`}>
      <div className="hg-worth-total">
        <span>Net worth</span>
        <b>{formatINR(parts.total)}</b>
      </div>
      <div className="hg-worth-bar" aria-hidden="true">
        <i className="is-cash" style={{ width: seg(parts.cash) }} />
        <i className="is-land" style={{ width: seg(parts.districts) }} />
        <i className="is-up" style={{ width: seg(parts.upgrades) }} />
      </div>
      <dl className="hg-worth-parts">
        <div className="is-cash"><dt>Cash</dt><dd>{compact ? compactINR(parts.cash) : formatINR(parts.cash)}</dd></div>
        <div className="is-land"><dt>Districts</dt><dd>{compact ? compactINR(parts.districts) : formatINR(parts.districts)}</dd></div>
        <div className="is-up"><dt>Upgrades</dt><dd>{compact ? compactINR(parts.upgrades) : formatINR(parts.upgrades)}</dd></div>
        {parts.debt > 0 ? <div className="is-debt"><dt>Debt</dt><dd>&minus;{compact ? compactINR(parts.debt) : formatINR(parts.debt)}</dd></div> : null}
      </dl>
    </div>
  );
}

function StatGrid({ stats, laps }) {
  if (!stats && !Number.isFinite(laps)) return null;
  const s = stats || {};
  const items = [
    ['Rent earned', formatINR(s.rentEarned || 0)],
    ['Rent paid', formatINR(s.rentPaid || 0)],
    ['Biggest rent', formatINR(s.biggestRent || 0)],
    ['Taxes & fees', formatINR(s.taxPaid || 0)],
    ['Bought', String(s.propertiesBought || 0)],
    ['Upgrades', String(s.upgrades || 0)],
    ['Rides', String(s.rides || 0)],
    ['Chai saved', formatINR(s.chaiSaved || 0)],
  ];
  if (Number.isFinite(laps)) items.push(['Laps', String(laps)]);
  return (
    <dl className="hg-stats hg-stats--grid">
      {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

export default function PlayerSheet({ session, playerId, onClose, onOpenTile }) {
  const id = useHeld(playerId);
  const state = useStateLike(session);
  const p = id != null ? state.players.find((x) => x.id === id) : null;
  const live = id != null ? session.view?.players?.find((x) => x.id === id) : null;
  const rows = id != null ? setProgress(state.owners, id) : [];
  const parts = p ? worthParts(state, p.id) : null;
  const shown = live ? { ...p, chai: live.chai ?? p?.chai, stuck: live.stuck ?? p?.stuck } : p;
  const cos = p ? cosmeticsOf(session, p) : null;
  const TitleChip = cos?.title ? artPart('TitleChip') : null;

  return (
    <Sheet open={playerId != null} onClose={onClose} ariaLabel={p ? `${p.name} details` : 'Player details'} className="hg-playersheet"
      header={p ? (
        <div className="hg-ps-head" data-drag="" style={{ '--pc': p.color }}>
          <PlayerToken player={p} size={56} frame={cos?.frame} />
          <div className="hg-ps-who">
            <h2>{p.name}{p.id === session.me ? <small> (you)</small> : null}</h2>
            {p.piece || TitleChip ? (
              <p className="hg-ps-piece">
                {p.piece ? pieceName(p.piece) : null}
                {TitleChip ? <TitleChip title={cos.title} size="sm" /> : null}
              </p>
            ) : null}
            <PlayerTags session={session} p={shown} />
          </div>
        </div>
      ) : null}
    >
      {p ? (
        <>
          <WorthBreakdown parts={parts} />
          <h3 className="hg-h3">This match</h3>
          <StatGrid stats={live?.stats || p.stats} laps={live?.laps ?? p.laps} />

          <h3 className="hg-h3">Districts</h3>
          {rows.length === 0 ? (
            <p className="hg-empty">{p.bankrupt ? 'All districts went back to the bank.' : 'No districts yet.'}</p>
          ) : (
            <SetCards rows={rows} state={state} onOpenTile={onOpenTile} />
          )}
        </>
      ) : null}
    </Sheet>
  );
}

/** Every player at a glance: net worth split and districts by collection (richest first). */
export function StatsSheet({ session, open, onClose, onOpenTile }) {
  const state = useStateLike(session);
  const summary = settingsSummary(session.display?.cfg || session.view?.cfg, session.display?.goal);
  const list = state.players
    .map((p) => ({ p, parts: worthParts(state, p.id), rows: setProgress(state.owners, p.id) }))
    .sort((a, b) => (Number(!!a.p.bankrupt) - Number(!!b.p.bankrupt)) || (b.parts.total - a.parts.total));
  const alive = list.filter((x) => !x.p.bankrupt);
  const leaderId = alive.length > 1 && alive[0].parts.total > alive[1].parts.total ? alive[0].p.id : null;

  return (
    <Sheet open={open} onClose={onClose} title="Player stats" className="hg-statssheet" desktop="modal">
      <p className="hg-summary hg-st-sum">{summary}</p>
      <ol className="hg-st-list">
        {list.map(({ p, parts, rows }) => (
          <li key={p.id} className={`hg-st-player${p.bankrupt ? ' is-out' : ''}`} style={{ '--pc': p.color }}>
            <div className="hg-st-head">
              <PlayerToken player={p} size={40} frame={cosmeticsOf(session, p)?.frame} />
              <div className="hg-st-who">
                <h3>
                  {leaderId === p.id ? <Icon name="crown" size={16} className="hg-mb-crown" /> : null}
                  {p.name}{p.id === session.me ? <small> (you)</small> : null}
                </h3>
                <PlayerTags session={session} p={p} />
              </div>
            </div>
            <WorthBreakdown parts={parts} compact />
            {rows.length === 0 ? (
              <p className="hg-empty">{p.bankrupt ? 'All districts went back to the bank.' : 'No districts yet.'}</p>
            ) : (
              <SetCards rows={rows} state={state} onOpenTile={onOpenTile} />
            )}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

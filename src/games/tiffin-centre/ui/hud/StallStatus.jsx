// The STALL STATUS strip (chalk-board style, street look): the events banner (rain, cricket, power cut, festival, inspector countdown, delivery boy),
// the LPG gauge with its Swap button, one stock bar per ingredient group (batter shows its freshness and a "Sour!" warning), and the menu-board toggle.
// Hidden on level 0 (no operations there). It sits inside the Availability chalk board (`children`), so it adds no layout of its own.
// Props: { state, onStock(item), onSwap(), onBoard() }.
import { useState } from 'react';
import HudIcon from './HudIcon.jsx';
import { boardView, eventBanner, gasView, stockGroups } from './opsLogic.js';

/** How many things on the strip need a look (stock out / low / sour, gas low / out, an event running) and whether any is urgent. */
export function statusAlerts({ events, groups, gas }) {
  const bad = groups.filter((g) => g.tone !== 'ok');
  const gasBad = gas && (gas.tone === 'low' || gas.tone === 'out');
  const urgent = bad.some((g) => g.tone === 'out' || g.tone === 'sour') || (gas && gas.tone === 'out') || events.some((e) => e.id === 'inspector' || e.id === 'power');
  return { count: bad.length + (gasBad ? 1 : 0) + events.length, urgent: !!urgent };
}

function Events({ events }) {
  if (!events.length) return null;
  return (
    <ul className="tc-hud-events" aria-label="Happening now">
      {events.map((e) => (
        <li key={e.id} className="tc-hud-event" data-tone={e.tone} data-ev={e.id} title={e.note}>
          <HudIcon name={e.icon} size={16} />
          <b>{e.id === 'inspector' ? e.headline : e.name}</b>
          <span className="tc-hud-te" lang="te">{e.te}</span>
          <small>{e.id === 'inspector' ? '' : e.waiting ? 'waiting for a spot' : `${e.left}s`}</small>
          <span className="tc-hud-sr">{`${e.note}`}</span>
        </li>
      ))}
    </ul>
  );
}

export function GasGauge({ gas, onSwap, spotOn = false }) {
  const ticks = Array.from({ length: gas.swapTicks }, (_, i) => i < gas.swapDone);
  return (
    <div className="tc-hud-gas" data-tone={gas.tone} role="group" aria-label={gas.aria}>
      <HudIcon name="gas" size={18} />
      <span className="tc-hud-gas-meter">
        <span className="tc-hud-gas-bar" role="img" aria-label={`${gas.pct} percent gas`}>
          <i style={{ width: `${gas.swapping ? gas.swapFrac * 100 : gas.frac * 100}%` }} />
        </span>
        <small className="tc-hud-gas-label">{gas.label}</small>
      </span>
      {gas.swapping ? (
        <span className="tc-hud-gas-ticks" role="progressbar" aria-label="Changing the cylinder" aria-valuemin={0} aria-valuemax={gas.swapTicks} aria-valuenow={gas.swapDone}>
          {ticks.map((on, i) => (
            <i key={i} className={on ? 'is-on' : ''} />
          ))}
        </span>
      ) : (
        <button
          type="button"
          className={`tc-hud-gas-swap${spotOn ? ' is-spot' : ''}`}
          data-spot="gas"
          data-alert={gas.tone === 'low' || gas.tone === 'out' ? '1' : undefined}
          aria-disabled={gas.canSwap ? undefined : 'true'}
          aria-label={gas.canSwap ? `Swap the cylinder for ₹${gas.cost}` : `Swap the cylinder: ${gas.reason}`}
          title={gas.canSwap ? `Walk to the stand and change the cylinder (₹${gas.cost}, ${gas.swapTicks}s with the burners off)` : gas.reason}
          onClick={onSwap}
        >
          <b>Swap</b>
          <small>{`₹${gas.cost}`}</small>
        </button>
      )}
    </div>
  );
}

// Props: { state, onStock(item), onSwap(), onBoard(), forceOpen?, spot? (the tutorial's pulse keys: 'gas', 'board') }. The stock panel (LPG gauge, stock bars, Board tile) folds behind the Stall button on every
// screen so the picture stays clear and opens as an overlay beside the chalk board; the events stay visible under the button. `forceOpen` (a tutorial spotlight or a walk to the gas stand) unfolds it.
export default function StallStatus({ state, onStock, onSwap, onBoard, forceOpen = false, spot = null }) {
  const [open, setOpen] = useState(false);
  const events = eventBanner(state);
  const groups = stockGroups(state);
  const gas = gasView(state);
  const board = groups.length ? boardView(state) : null;
  if (!events.length && !groups.length && !gas) return null;
  const alert = board ? board.suggestCount > 0 : false;
  const al = statusAlerts({ events, groups, gas });
  const spotGas = !!spot?.has('gas');
  const spotBoard = !!spot?.has('board');
  const shown = open || forceOpen || spotGas || spotBoard;
  return (
    <div className="tc-hud-status" role="group" aria-label="Stall status" data-open={shown ? '1' : '0'}>
      <button
        type="button"
        className="tc-hud-status-toggle"
        aria-expanded={shown}
        aria-controls="tc-hud-status-body"
        aria-label={`Stall status: ${al.count ? `${al.count} to look at` : 'all fine'}. ${shown ? 'Hide' : 'Show'} stock and gas`}
        data-alert={al.urgent ? '1' : al.count ? '2' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <HudIcon name="stall" size={20} />
        <span className="tc-hud-status-toggle-txt">Stall</span>
        {al.count > 0 && <b className="tc-hud-status-toggle-n" aria-hidden="true">{al.count}</b>}
      </button>
      <Events events={events} />
      <div className="tc-hud-status-body" id="tc-hud-status-body">
      {(groups.length > 0 || gas) && (
        <ul className="tc-hud-stock" aria-label="Stock">
          {gas && (
            <li className="tc-hud-stock-li is-gas">
              <GasGauge gas={gas} onSwap={onSwap} spotOn={spotGas} />
            </li>
          )}
          {groups.map((g) => (
            <li key={g.id} className="tc-hud-stock-li">
              <button
                type="button"
                className="tc-hud-stockbar"
                data-tone={g.tone}
                data-group={g.id}
                data-band={g.band || undefined}
                aria-label={`${g.ariaLabel}. Press to prepare more`}
                title={g.rows.map((r) => `${r.name}: ${r.text}`).join(', ')}
                onClick={() => onStock(g.item)}
              >
                <span className="tc-hud-sb-name">
                  {g.label}
                  {g.pending > 0 && <i className="tc-hud-sb-pend" aria-hidden="true">{`+${g.pending}`}</i>}
                </span>
                <span className="tc-hud-sb-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(g.tone === 'out' ? 0 : 6, g.frac * 100)}%` }} />
                </span>
                <span className="tc-hud-sb-n" aria-hidden="true">
                  {g.count > 1 ? `${g.worst.short} ` : ''}
                  <b>{g.tone === 'out' ? 'Out' : g.text}</b>
                  {g.fresh !== null && <em className="tc-hud-sb-fresh">{g.band === 'sour' ? 'Sour!' : `${Math.round(g.fresh)}%`}</em>}
                </span>
              </button>
            </li>
          ))}
          {board && (
            <li className="tc-hud-stock-li">
              <button
                type="button"
                className={`tc-hud-stockbar is-board${spotBoard ? ' is-spot' : ''}`}
                data-spot="board"
                data-alert={alert ? '1' : undefined}
                aria-label={`Menu board: ${board.offCount} sold out${alert ? `, ${board.suggestCount} cannot be made right now` : ''}. Press to open`}
                onClick={onBoard}
              >
                <span className="tc-hud-sb-name">
                  <HudIcon name="board" size={14} /> Board
                </span>
                <span className="tc-hud-sb-n" aria-hidden="true">
                  <b>{board.offCount ? `${board.offCount} off` : 'All on'}</b>
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
      </div>
    </div>
  );
}

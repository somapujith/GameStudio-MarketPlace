// The STALL STATUS strip (chalk-board style, street look): the events banner (rain, cricket, power cut, festival, inspector countdown, delivery boy),
// the LPG gauge with its Swap button, one stock bar per ingredient group (batter shows its freshness and a "Sour!" warning), and the menu-board toggle.
// Hidden on level 0 (no operations there). It sits inside the Availability chalk board (`children`), so it adds no layout of its own.
// Props: { state, onStock(item), onSwap(), onBoard() }.
import HudIcon from './HudIcon.jsx';
import { boardView, eventBanner, gasView, stockGroups } from './opsLogic.js';

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

export function GasGauge({ gas, onSwap }) {
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
          className="tc-hud-gas-swap"
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

export default function StallStatus({ state, onStock, onSwap, onBoard }) {
  const events = eventBanner(state);
  const groups = stockGroups(state);
  const gas = gasView(state);
  const board = groups.length ? boardView(state) : null;
  if (!events.length && !groups.length && !gas) return null;
  const alert = board ? board.suggestCount > 0 : false;
  return (
    <div className="tc-hud-status" role="group" aria-label="Stall status">
      <Events events={events} />
      {(groups.length > 0 || gas) && (
        <ul className="tc-hud-stock" aria-label="Stock">
          {gas && (
            <li className="tc-hud-stock-li is-gas">
              <GasGauge gas={gas} onSwap={onSwap} />
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
                className="tc-hud-stockbar is-board"
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
  );
}

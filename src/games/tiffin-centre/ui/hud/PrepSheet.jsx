// The PREP SHEET: the back counter behind the cook. Two job slots with their progress (and a Collect button when a job is ready), every ingredient
// of the shelf with its stock, freshness, recipe time, cost and yield, and (levels with a market) a Buy button, 40% dearer. A job that cannot start says
// why ("Slot busy", "Shelf full"), one that will only wait says so ("Power cut", "No gas"). Keys: 1-9 prepare that ingredient, arrows move, Esc or P close.
// Props: { state, selected (an ingredient id to highlight), onClose, onPrep(item), onCollect(slot), onBuy(item, n), onNotify(text) }.
import { useEffect, useRef, useState } from 'react';
import { formatINR } from '@shared/format.js';
import HudIcon from './HudIcon.jsx';
import { BUY_SIZES, buyBlock, buyPrice, prepView } from './opsLogic.js';

function Job({ s, onCollect }) {
  const label = s.st === 'empty' ? `Job ${s.idx + 1}: free` : s.ready ? `Job ${s.idx + 1}: ${s.name} ready` : `Job ${s.idx + 1}: ${s.name}, ${s.secs} seconds left${s.paused ? `, paused by ${s.paused.toLowerCase()}` : ''}`;
  return (
    <li className="tc-hud-job" data-st={s.st} data-paused={s.paused ? '1' : undefined} aria-label={label}>
      <span className="tc-hud-job-name">
        <b>{s.st === 'empty' ? 'Free' : s.name}</b>
        {s.st !== 'empty' && <span className="tc-hud-te">{s.te}</span>}
      </span>
      {s.st === 'empty' && <span className="tc-hud-job-note">Pick something below</span>}
      {s.st === 'cooking' && (
        <>
          <span className="tc-hud-job-bar" role="progressbar" aria-label={`${s.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)}>
            <i style={{ width: `${s.progress * 100}%` }} />
          </span>
          <span className="tc-hud-job-note">{s.paused ? `Paused: ${s.paused}` : `${s.secs}s`}</span>
        </>
      )}
      {s.ready && (
        <button type="button" className="tc-hud-job-collect" data-alert="1" onClick={() => onCollect(s.idx)} aria-label={`Collect ${s.yield} portions of ${s.name}`}>
          <b>Collect</b>
          <small>{`+${s.yield}`}</small>
        </button>
      )}
    </li>
  );
}

export default function PrepSheet({ state, selected = null, onClose, onPrep, onCollect, onBuy, onNotify }) {
  const ref = useRef(null);
  const [size, setSize] = useState(5);
  const view = prepView(state);
  const cb = useRef({});
  cb.current = { onPrep, onClose, items: view?.items || [], onNotify };

  useEffect(() => {
    const prev = typeof document !== 'undefined' ? document.activeElement : null;
    const root = ref.current;
    const row = selected ? root?.querySelector(`[data-item="${selected}"]`) : null;
    (row?.querySelector('button[data-prep]') || root?.querySelector('button[data-prep]') || root?.querySelector('button'))?.focus?.({ preventScroll: true });
    row?.scrollIntoView?.({ block: 'nearest' });
    return () => prev?.focus?.({ preventScroll: true });
  }, [selected]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'Escape' || k === 'p') {
        e.preventDefault();
        e.stopPropagation();
        cb.current.onClose();
        return;
      }
      if (/^[1-9]$/.test(k)) {
        const it = cb.current.items[Number(k) - 1];
        if (it) {
          e.preventDefault();
          e.stopPropagation();
          if (it.disabled) cb.current.onNotify?.(it.blockText);
          else cb.current.onPrep(it.item);
        }
        return;
      }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        const btns = [...(ref.current?.querySelectorAll('button[data-prep]') || [])];
        if (!btns.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = btns.indexOf(document.activeElement);
        btns[i < 0 ? 0 : k === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!view) return null;
  return (
    <div className="tc-hud-sheetwrap is-prep" onClick={onClose}>
      <div ref={ref} className="tc-hud-sheet tc-hud-prepsheet" role="dialog" aria-modal="true" aria-label="Prep counter" onClick={(e) => e.stopPropagation()}>
        <header className="tc-hud-sheet-head">
          <span>
            <b>Prep counter</b>
            <small>Behind you: make stock before the shelf runs dry (1-9, P or Esc to close)</small>
          </span>
          <button type="button" className="tc-hud-btn" onClick={onClose} aria-label="Close (Esc)">
            <HudIcon name="close" size={20} />
          </button>
        </header>
        <div className="tc-hud-prep-body">
          <ul className="tc-hud-jobs" aria-label="Prep jobs">
            {view.slots.map((s) => (
              <Job key={s.idx} s={s} onCollect={onCollect} />
            ))}
          </ul>
          {view.market && (
            <div className="tc-hud-buysize" role="group" aria-label="Market runner: how many portions to buy">
              <span>Market runner (40% dearer)</span>
              {BUY_SIZES.map((n) => (
                <button key={n} type="button" className={`tc-hud-sizebtn${size === n ? ' is-on' : ''}`} aria-pressed={size === n} onClick={() => setSize(n)}>
                  {`x${n}`}
                </button>
              ))}
            </div>
          )}
          <ul className="tc-hud-prep-items">
            {view.items.map((it, i) => {
              const buyWhy = view.market ? buyBlock(state, it.item, size) : 'No market';
              return (
                <li key={it.item} className={`tc-hud-prep-item${selected === it.item ? ' is-selected' : ''}`} data-item={it.item} data-tone={it.tone}>
                  <span className="tc-hud-keycap" aria-hidden="true">{i < 9 ? i + 1 : ''}</span>
                  <span className="tc-hud-prep-name">
                    <b className="tc-hud-en">{it.name}</b>
                    <span className="tc-hud-te">{it.te}</span>
                    <small className="tc-hud-prep-how">{it.how}</small>
                    <span className="tc-hud-prep-stock" data-tone={it.tone}>
                      <span className="tc-hud-prep-meter" aria-hidden="true">
                        <i style={{ width: `${Math.max(it.tone === 'out' ? 0 : 5, it.frac * 100)}%` }} />
                      </span>
                      <span>{it.tone === 'out' ? 'Out' : `${it.text} left`}</span>
                      {it.fresh !== null && it.fresh !== undefined && <em data-band={it.band}>{it.band === 'sour' ? 'Sour!' : `${Math.round(it.fresh)}% fresh`}</em>}
                      {it.pending > 0 && <em className="tc-hud-prep-pend">{`+${it.pending} on the way`}</em>}
                    </span>
                  </span>
                  <span className="tc-hud-prep-acts">
                    <button
                      type="button"
                      className="tc-hud-prepbtn"
                      data-prep=""
                      data-soft={it.block && !it.block.hard ? '1' : undefined}
                      aria-disabled={it.disabled ? 'true' : undefined}
                      aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                      aria-label={`Prepare ${it.name}: ${it.yield} portions in ${it.ticks} seconds for ${formatINR(it.cost)}${it.block ? `. ${it.block.hard ? 'Cannot: ' : 'It will wait: '}${it.blockText}` : ''}`}
                      onClick={() => (it.disabled ? onNotify?.(it.blockText) : onPrep(it.item))}
                    >
                      <b>Prep</b>
                      <small>{`+${it.yield} · ${it.ticks}s · ${formatINR(it.cost)}`}</small>
                    </button>
                    {view.market && (
                      <button
                        type="button"
                        className="tc-hud-buybtn"
                        aria-disabled={buyWhy ? 'true' : undefined}
                        aria-label={buyWhy ? `Buy ${it.name}: ${buyWhy}` : `Buy ${size} ${it.name} from the market for ${formatINR(buyPrice(it.item, size))}`}
                        onClick={() => (buyWhy ? onNotify?.(buyWhy) : onBuy(it.item, size))}
                      >
                        <b>{`Buy ${size}`}</b>
                        <small>{formatINR(buyPrice(it.item, size))}</small>
                      </button>
                    )}
                  </span>
                  {it.block && (
                    <span className="tc-hud-prep-why" data-hard={it.block.hard ? '1' : '0'} role="note">
                      {it.block.hard ? it.blockText : `${it.blockText}: it will wait`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

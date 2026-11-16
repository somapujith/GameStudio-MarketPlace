import { memo } from 'react';
import { Avatar } from '@/components/art/index.js';
import Icon from '../ui/Icon.jsx';
import '@/styles/power.css';

/**
 * The Swap Tiles targeting step, shown inside the tray's panel. The list of avatar buttons is the accessible path (the board
 * highlight is optional, see the `hg:power-target` event in PowerTray.jsx).
 *   rivals    [{ id, name, avatar, color, ok, reason }]  from powerModel.targetsFor (eligible first)
 *   picked    the rival id awaiting confirmation, or null (list step)
 *   onPick(id) / onConfirm() / onBack()      pending  the server is deciding: everything is inert
 * List step: Back and the question share one row (the list gets the room); eligible rivals are buttons, ineligible ones are listed
 * disabled with their reason underneath.
 * Confirm step: "Trade places with Ravi?" with Confirm / Back.
 */
function TargetPicker({ rivals, picked = null, onPick, onConfirm, onBack, pending = false, confirmRef, firstRef, idPrefix = 'pw' }) {
  const who = picked ? rivals.find((r) => r.id === picked) : null;
  if (who) {
    return (
      <div className="pw-target pw-target--confirm">
        <p className="pw-target__q" id={`${idPrefix}-confirm`} role="group" aria-label={`Trade places with ${who.name}?`}>
          <span className="pw-target__ava" style={{ '--pc': who.color }}><Avatar preset={who.avatar} size={32} /></span>
          <span>Trade places with <b>{who.name}</b>?</span>
        </p>
        <div className="pw-acts">
          <button type="button" className="pw-btn" onClick={onBack} disabled={pending}>Back</button>
          <button type="button" className="pw-btn pw-btn--primary" ref={confirmRef} onClick={onConfirm} aria-busy={pending || undefined} aria-disabled={pending || undefined}>
            {pending ? (<><i className="pw-spin" aria-hidden="true" />Swapping…</>) : (<><Icon name="check" size={18} />Confirm</>)}
          </button>
        </div>
      </div>
    );
  }
  const anyOk = rivals.some((r) => r.ok);
  let firstOk = true;
  return (
    <div className="pw-target">
      <div className="pw-target__top">
        <button type="button" className="pw-btn pw-target__back" ref={anyOk ? undefined : firstRef} onClick={onBack}>Back</button>
        <p className="pw-target__h" id={`${idPrefix}-targets`}>Choose a rival to trade places with</p>
      </div>
      <ul className="pw-target__list" aria-labelledby={`${idPrefix}-targets`}>
        {rivals.map((r) => {
          const isFirst = r.ok && firstOk;
          if (isFirst) firstOk = false;
          return (
            <li key={r.id}>
              <button
                type="button"
                ref={isFirst ? firstRef : undefined}
                className={`pw-rival${r.ok ? '' : ' is-off'}`}
                style={{ '--pc': r.color }}
                aria-disabled={!r.ok || undefined}
                aria-describedby={r.ok ? undefined : `${idPrefix}-why-${r.id}`}
                onClick={() => { if (r.ok) onPick?.(r.id); }}
              >
                <span className="pw-rival__ava"><Avatar preset={r.avatar} size={34} /></span>
                <span className="pw-rival__txt">
                  <b>{r.name}</b>
                  {r.ok ? null : <small id={`${idPrefix}-why-${r.id}`}>{r.reason}</small>}
                </span>
                {r.ok ? <Icon name="chevronDown" size={16} className="pw-rival__go" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {anyOk ? null : <p className="pw-why" role="note">No rival can swap right now.</p>}
    </div>
  );
}

export default memo(TargetPicker);

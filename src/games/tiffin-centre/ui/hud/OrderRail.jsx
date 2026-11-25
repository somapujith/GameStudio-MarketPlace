// The kitchen chit rail: one paper chit per customer on a steel clip, in spot order. The coin ring on each chit drains smoothly between
// ticks (written straight to CSS variables from the shared frame bus: no React state per frame). A paying customer shows a glowing
// rupee note with a countdown ring and a big COLLECT button.
import { useRef } from 'react';
import { LOOK } from './look.js';
import { formatINR } from '@shared/format.js';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { useFrame } from './hooks.js';
import { activeCustomers, customerTarget, ticketFrame, ticketModel } from './hudLogic.js';

const STATE_WORD = { waiting: 'waiting', eating: 'eating', paying: 'ready to pay' };

function chitLabel(t) {
  const needs = t.chips.filter((c) => !c.served).map((c) => c.name);
  const done = t.chips.length - needs.length;
  const what = needs.length ? `needs ${needs.join(' and ')}` : 'all served';
  const extra = (t.badges || []).map((b) => b.title).join('. ');
  return `Token ${t.token}, ${t.name}, ${t.kindLabel}, ${STATE_WORD[t.st] || t.st}, ${what}${done ? `, ${done} of ${t.chips.length} served` : ''}${extra ? `. ${extra}` : ''}`;
}

function Chit({ t, spotOn, walkOn, collectSpot, collectWalk, onTap, onLook, register }) {
  return (
    <li
      ref={(el) => register(t.id, el)}
      className={`tc-hud-chit${spotOn ? ' is-spot' : ''}${walkOn ? ' is-walking' : ''}`}
      data-st={t.st}
      data-big={t.badges?.some((b) => b.id === 'big' || b.id === 'delivery') ? '1' : undefined}
      data-tone={t.st === 'paying' ? 'ok' : t.st === 'eating' ? 'eat' : 'ok'}
      data-ticket={t.id}
      style={{ '--tilt': `${((t.id * 37) % 5) - 2}deg` }}
    >
      <span className="tc-hud-clip" aria-hidden="true" />
      <button type="button" className="tc-hud-chit-main" data-badges={t.badges?.length ? '1' : undefined} onClick={() => onTap(t.id)} aria-label={chitLabel(t)} data-spot={`ticket:${t.id}`}>
        <span className="tc-hud-token" aria-hidden="true">
          <i className="tc-hud-token-hole" />
          <small>TOKEN</small>
          <b>{t.token}</b>
        </span>
        <span className="tc-hud-coin" aria-hidden="true">
          <span className="tc-hud-coin-num" data-num="" />
          <span className="tc-hud-coin-ico">{t.st === 'paying' ? <HudIcon name="rupee" size={16} /> : t.st === 'eating' ? <HudIcon name="chai" size={16} /> : null}</span>
        </span>
        <span className="tc-hud-who">
          <b>{t.name}</b>
          <small>{t.st === 'eating' ? 'Eating...' : t.st === 'paying' ? 'Pay now!' : t.kindLabel}</small>
        </span>
        {t.badges?.length > 0 && (
          <span className="tc-hud-badges" aria-hidden="true">
            {t.badges.map((b) => (
              <span key={b.id} className={`tc-hud-badge is-${b.id} is-${b.tone}`} title={b.title}>
                <HudIcon name={b.icon} size={13} />
                <span>{b.label}</span>
                {b.pips !== undefined && (
                  <span className="tc-hud-pips">
                    {[0, 1, 2].map((n) => (
                      <HudIcon key={n} name="star" size={9} className={n < b.pips ? 'is-on' : 'is-off'} />
                    ))}
                  </span>
                )}
                {Number.isFinite(b.secs) && <b className="tc-hud-badge-secs">{`${b.secs}s`}</b>}
              </span>
            ))}
          </span>
        )}
        <span className="tc-hud-dishes">
          {t.chips.map((c, i) => (
            <span key={i} className={`tc-hud-dishchip${c.served ? ' is-served' : ''}${c.inHand && !c.served ? ' is-inhand' : ''}${c.broken ? ' is-broken' : ''}`}>
              <DishIcon dish={c.dish} size={28} />
              <span className="tc-hud-dishname">
                <span className="tc-hud-en">{c.name}</span>
                <span className="tc-hud-te">{c.te}</span>
              </span>
              {c.broken && (
                <span className="tc-hud-half" title="Broken dish: half price">
                  {'½'}
                </span>
              )}
              {c.served && (
                <span className="tc-hud-tick" aria-hidden="true">
                  <HudIcon name="check" size={12} />
                </span>
              )}
            </span>
          ))}
        </span>
      </button>
      <button type="button" className="tc-hud-chit-look" onClick={() => onLook(t.id)} aria-label={`Look at token ${t.token}`} title="Look at them">
        <HudIcon name="eye" size={16} />
      </button>
      {t.st === 'paying' && (
        <button
          type="button"
          className={`tc-hud-collect${collectSpot ? ' is-spot' : ''}${collectWalk ? ' is-walking' : ''}`}
          data-spot={`collect:${t.id}`}
          onClick={() => onTap(t.id, true)}
          aria-label={`Collect ${formatINR(t.total)} from token ${t.token}, ${t.name}`}
        >
          <span className="tc-hud-note" aria-hidden="true" />
          <span className="tc-hud-collect-txt">
            <small>COLLECT</small>
            <b>{formatINR(t.total)}</b>
          </span>
          <span className="tc-hud-collect-secs" data-paysecs="" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export default function OrderRail({ state, hands, spot, walking, onTarget, onLook }) {
  const els = useRef(new Map());
  const lastTap = useRef({ id: null, t: 0 });
  // One tap works on the customer; a second tap on the same chit within a moment turns your head to them instead (no second job queued).
  const onTap = (id, force = false) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const l = lastTap.current;
    if (!force && l.id === id && now - l.t < LOOK.doubleMs && onLook) {
      lastTap.current = { id: null, t: 0 };
      onLook(id);
      return;
    }
    lastTap.current = { id, t: now };
    onTarget(customerTarget(id));
  };
  const register = (id, el) => {
    if (el) els.current.set(id, { el, num: el.querySelector('[data-num]'), secs: null, last: {} });
    else els.current.delete(id);
  };
  useFrame((_t, frac, st) => {
    if (!st) return;
    for (const c of st.customers || []) {
      const rec = els.current.get(c.id);
      if (!rec) continue;
      const f = ticketFrame(c, st, frac);
      const { el, last } = rec;
      const p = f.p.toFixed(3);
      if (last.p !== p) {
        el.style.setProperty('--p', p);
        last.p = p;
      }
      if (last.tone !== f.tone) {
        el.dataset.tone = f.tone;
        last.tone = f.tone;
      }
      const shake = f.shake ? '1' : '0';
      if (last.shake !== shake) {
        el.dataset.shake = shake;
        last.shake = shake;
      }
      const text = c.st === 'eating' ? '' : String(f.secs);
      if (rec.num && last.text !== text) {
        rec.num.textContent = text;
        last.text = text;
      }
      if (c.st === 'paying') {
        const ps = el.querySelector('[data-paysecs]');
        if (ps && last.pay !== f.secs) {
          ps.textContent = `${f.secs}s`;
          last.pay = f.secs;
        }
      }
    }
  });
  const list = activeCustomers(state);
  return (
    <section className="tc-hud-railbox" aria-label="Orders">
      <div className="tc-hud-railwire" aria-hidden="true" />
      <ol className="tc-hud-rail" tabIndex={list.length === 0 ? -1 : undefined}>
        {list.length === 0 && <li className="tc-hud-rail-empty">No tokens yet. Keep the tawa hot!</li>}
        {list.map((c) => {
          const t = ticketModel(c, state, hands);
          return (
            <Chit
              key={c.id}
              t={t}
              spotOn={spot.has(`ticket:${c.id}`)}
              walkOn={walking.has(`ticket:${c.id}`)}
              collectSpot={spot.has(`collect:${c.id}`)}
              collectWalk={walking.has(`collect:${c.id}`)}
              onTap={onTap}
              onLook={(id) => onLook?.(id)}
              register={register}
            />
          );
        })}
      </ol>
    </section>
  );
}

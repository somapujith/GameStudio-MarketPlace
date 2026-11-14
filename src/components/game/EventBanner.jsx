// The current city event ("Hyderabad Rush Hour", docs/HUSTLE_PLAN.md 3.6), shown at the top of the control panel while
// `session.view.event` is set ({ id, title, text, kind, round, group?, groups?, mult?, amount? }).
// Reads the LATEST state (session.view): the event is rules information, valid for the whole round.
//   <EventBanner session />   -> a live region that is always mounted (so screen readers pick up insertions);
//   the banner inside is keyed by event id + round, so a new event is announced once and re-renders are silent.
// On the compact layout (< 420px container) the one-liner wraps under the title instead of disappearing.
import { GROUPS } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import '@/styles/controlpanel.css';

export const EVENT_EMOJI = {
  rush_hour: '🚦',
  biryani_boom: '🍛',
  wedding_season: '💍',
  festival: '🪔',
  monsoon: '🌧️',
};

const fmtMult = (m) => `x${Number(m)}`;

/** What the banner shows for an event. Pure; exported for testing. -> null | { key, id, emoji, title, text, chips[] } */
export function eventInfo(event) {
  if (!event || !event.id) return null;
  const ids = [...(event.group ? [event.group] : []), ...(Array.isArray(event.groups) ? event.groups : [])];
  const mult = event.mult != null ? fmtMult(event.mult) : null;
  const chips = [...new Set(ids)]
    .map((id) => GROUPS[id])
    .filter(Boolean)
    .map((g) => ({ color: g.color, name: g.name }));
  if (mult && chips.length) chips[chips.length - 1].mult = mult;
  if (!chips.length && Number(event.amount) > 0) chips.push({ color: 'var(--cp-gold)', name: formatINR(event.amount), amount: true });
  return {
    key: `${event.id}:${event.round ?? ''}`,
    id: event.id,
    emoji: EVENT_EMOJI[event.id] || '🎉',
    title: event.title || event.id,
    text: event.text || '',
    chips,
    // kept for older callers: the first group chip
    chip: chips[0] && !chips[0].amount ? chips[0] : null,
  };
}

export default function EventBanner({ session }) {
  const info = eventInfo(session?.view?.event);
  return (
    <div className="cp-event-wrap" role="status" aria-live="polite" aria-atomic="true">
      {info ? (
        <div key={info.key} className="cp-event" data-event={info.id} title={info.text ? `${info.title}. ${info.text}` : info.title}>
          <span className="cp-event__emoji" aria-hidden="true">{info.emoji}</span>
          <span className="cp-event__body">
            <b className="cp-event__title">{info.title}</b>
            {info.text ? <span className="cp-event__text">{info.text}</span> : null}
          </span>
          {info.chips.length ? (
            <span className="cp-event__chips">
              {info.chips.map((c) => (
                <span key={c.name} className={`cp-event__chip${c.amount ? ' is-amount' : ''}`} style={{ '--gc': c.color }}>
                  {c.amount ? null : <i aria-hidden="true" />}
                  <small>{c.name}</small>
                  {c.mult ? <span>{c.mult}</span> : null}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

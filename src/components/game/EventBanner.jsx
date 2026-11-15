// The current city event ("Hyderabad Rush Hour", docs/HUSTLE_PLAN.md 3.6), shown as a "city news flash" strip at the top of the
// board-centre panel while `session.view.event` is set ({ id, title, text, kind, round, group?, groups?, mult?, amount? }).
// Reads the LATEST state (session.view): the event is rules information, valid for the whole round.
//   <EventBanner session />   -> a live region that is always mounted (so screen readers pick up insertions);
//   the strip inside is keyed by event id + round, so a new event is announced once and re-renders are silent.
// Look (moments/moments.css): a red NEWS tag with a blinking live dot, the event's emoji, the headline and one-liner, and
// a coloured chip per affected collection with a multiplier badge (green up arrow = rents rise, red down = fall). The strip
// is tinted with the collection's colour, slides in with a spring and a shine sweep once, then sits still for the round.
// The affected tiles themselves glow on the board (Tile's `event` hint). It never moves anything else and takes no input.
// On the compact layout (< 420px container) the one-liner is visually hidden (still read by screen readers) so the strip
// keeps to a single line: title + the affected-collection chips.
import { GROUPS } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { eventEmoji } from './board/eventFlag.js';
import './moments/moments.css';

export const EVENT_EMOJI = {
  rush_hour: '🚦',
  biryani_boom: '🍛',
  wedding_season: '💍',
  festival: '🪔',
  monsoon: '🌧️',
};

const fmtMult = (m) => `x${Number(m)}`;

/** What the banner shows for an event. Pure; exported for testing. -> null | { key, id, emoji, title, text, chips[], tone, accent } */
export function eventInfo(event) {
  if (!event || !event.id) return null;
  const ids = [...(event.group ? [event.group] : []), ...(Array.isArray(event.groups) ? event.groups : [])];
  const mult = event.mult != null ? fmtMult(event.mult) : null;
  const down = event.mult != null && Number(event.mult) < 1;
  const chips = [...new Set(ids)]
    .map((id) => GROUPS[id])
    .filter(Boolean)
    .map((g) => ({ color: g.color, name: g.name }));
  if (mult && chips.length) Object.assign(chips[chips.length - 1], { mult, dir: down ? 'down' : 'up' });
  const amount = Number(event.amount);
  if (!chips.length && amount > 0) chips.push({ color: 'var(--cp-gold)', name: formatINR(event.amount), amount: true });
  else if (!chips.length && amount < 0) chips.push({ color: 'var(--cp-gold)', name: formatINR(event.amount), amount: true, dir: 'down' });
  const tone = down || amount < 0 ? 'down' : event.id === 'festival' || amount > 0 ? 'gift' : 'up';
  const accent = chips.find((c) => !c.amount)?.color || null;
  return {
    key: `${event.id}:${event.round ?? ''}`,
    id: event.id,
    emoji: eventEmoji(event.id),
    title: event.title || event.id,
    text: event.text || '',
    chips,
    tone,
    accent,
    // kept for older callers: the first group chip
    chip: chips[0] && !chips[0].amount ? chips[0] : null,
  };
}

export default function EventBanner({ session }) {
  const info = eventInfo(session?.view?.event);
  return (
    <div className="cp-event-wrap" role="status" aria-live="polite" aria-atomic="true">
      {info ? (
        <div
          key={info.key}
          className="mo-news"
          data-event={info.id}
          data-tone={info.tone}
          style={info.accent ? { '--ev-c': info.accent } : undefined}
          title={info.text ? `${info.title}. ${info.text}` : info.title}
        >
          <span className="mo-news__flag" aria-hidden="true"><i />News</span>
          <span className="mo-news__emoji" aria-hidden="true">{info.emoji}</span>
          <span className="mo-news__body">
            <b className="mo-news__title">{info.title}</b>
            {info.text ? <span className="mo-news__text">{info.text}</span> : null}
          </span>
          {info.chips.length ? (
            <span className="mo-news__chips">
              {info.chips.map((c, i) => (
                <span key={c.name} className={`mo-news__chip${c.amount ? ' is-amount' : ''}`} style={{ '--gc': c.color, '--i': i }}>
                  {c.amount ? null : <i aria-hidden="true" />}
                  <small>{c.name}</small>
                  {c.mult ? <span className="mo-news__mult" data-dir={c.dir}><span aria-hidden="true">{c.dir === 'down' ? '▼' : '▲'}</span> {c.mult}</span> : null}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

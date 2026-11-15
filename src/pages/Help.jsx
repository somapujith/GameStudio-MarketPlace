import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { paths } from '@/platform/paths.js';
import LegalPage from '@/components/shell/legal/LegalPage.jsx';
import { Blocks, Contact, plainText } from '@/components/shell/legal/rich.jsx';
import { contactEmail } from '@/components/shell/legal/contact.js';
import { FAQ, FAQ_GROUPS } from '@/components/shell/legal/faq.js';

const QUICK = ['create-table', 'join-table', 'reconnect', 'install-app'];

/** Lower-case search text of an entry: question, answer and its group name. */
const haystack = (item) =>
  `${item.q} ${item.a.map(plainText).join(' ')} ${FAQ_GROUPS.find((g) => g.id === item.group)?.label || ''}`.toLowerCase();

const INDEX = FAQ.map((item) => ({ item, text: haystack(item) }));

/** Every word typed must appear somewhere in the entry. */
export function searchFaq(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return FAQ;
  return INDEX.filter(({ text }) => words.every((w) => text.includes(w))).map(({ item }) => item);
}

function FaqItem({ item, open, forced, onToggle }) {
  const panelId = `${item.id}-panel`;
  const isOpen = open || forced;
  return (
    <div className={`xl-faq__item${isOpen ? ' is-open' : ''}`} id={item.id}>
      <h3 className="xl-faq__q">
        <button type="button" id={`${item.id}-btn`} aria-expanded={isOpen} aria-controls={panelId} onClick={() => onToggle(item.id)}>
          <span>{item.q}</span>
          <HubIcon name="chevDown" size={20} className="xl-faq__chev" />
        </button>
      </h3>
      <div className="xl-faq__panel" id={panelId} role="region" aria-labelledby={`${item.id}-btn`} inert={!isOpen}>
        <div className="xl-faq__panelin">
          <div className="xl-prose">
            <Blocks blocks={item.a} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Help() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const searchId = useId();
  const { hash } = useLocation();
  const searching = query.trim().length > 0;

  const results = useMemo(() => searchFaq(query), [query]);
  const visible = useMemo(() => new Set(results.map((r) => r.id)), [results]);

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A link such as /help#install-app opens that answer and scrolls to it.
  useEffect(() => {
    const id = hash ? decodeURIComponent(hash.slice(1)) : '';
    if (!id || !FAQ.some((f) => f.id === id)) return undefined;
    setQuery('');
    setOpen((prev) => new Set(prev).add(id));
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'center' }), 80);
    return () => clearTimeout(t);
  }, [hash]);

  const sections = FAQ_GROUPS.map((g) => {
    const items = FAQ.filter((f) => f.group === g.id && visible.has(f.id));
    return {
      id: `group-${g.id}`,
      title: g.label,
      items,
      body: (
        <div className="xl-faq">
          {items.map((item) => (
            <FaqItem key={item.id} item={item} open={open.has(item.id)} forced={searching} onToggle={toggle} />
          ))}
        </div>
      ),
    };
  }).filter((s) => s.items.length > 0);

  const hero = (
    <div className="xl-helphero">
      <form className="xl-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="hub-sr" htmlFor={searchId}>
          Search the help articles
        </label>
        <HubIcon name="search" size={20} className="xl-search__icon" />
        <input
          id={searchId}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck="false"
          placeholder="Search help"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
        />
        {query ? (
          <button type="button" className="xl-search__clear" onClick={() => setQuery('')} aria-label="Clear search">
            <HubIcon name="close" size={18} />
          </button>
        ) : null}
      </form>
      <p className="xl-search__count" role="status" aria-live="polite">
        {searching ? (results.length ? `${results.length} ${results.length === 1 ? 'answer' : 'answers'} found` : 'No answers found') : ' '}
      </p>
      {!searching ? (
        <ul className="xl-quick" aria-label="Popular questions">
          {QUICK.map((id) => {
            const f = FAQ.find((x) => x.id === id);
            return f ? (
              <li key={id}>
                <a className="st-chip xl-quick__chip" href={`#${id}`}>
                  {f.q.replace(/\?$/, '')}
                </a>
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
    </div>
  );

  return (
    <LegalPage
      eyebrow="Help centre"
      title="Help"
      lead="Short answers about tables, codes, friends, connection trouble and installing the app."
      description="Help for GameHub: create or join a table, room codes and friend codes, guests and sign-in, reconnecting, supported browsers, installing the app and daily rewards."
      hero={hero}
      sections={sections}
    >
      {sections.length === 0 ? (
        <div className="xl-empty st-card" role="note">
          <HubIcon name="search" size={28} />
          <h2 className="xl-h2">Nothing matches “{query.trim()}”</h2>
          <p>Try fewer or different words, such as “code”, “friend”, “install” or “connection”.</p>
          <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={() => setQuery('')}>
            Clear search
          </button>
        </div>
      ) : null}

      <aside className="xl-still st-card" aria-labelledby="xl-still-h">
        <h2 id="xl-still-h" className="xl-still__h">
          Still stuck?
        </h2>
        <p>
          Send us the room code, the time and what you saw. {contactEmail() ? 'Use the address below.' : 'Ask the person who runs your GameHub for their support contact.'}
        </p>
        <Contact lead="Contact:" />
        <p className="xl-still__links">
          <Link to={paths.privacy()}>Privacy</Link> · <Link to={paths.terms()}>Terms</Link> · <Link to={paths.about()}>About GameHub</Link>
        </p>
      </aside>
    </LegalPage>
  );
}

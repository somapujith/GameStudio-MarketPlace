import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { BRAND } from '@/platform/brand.js';
import '@/styles/x-legal.css';

/**
 * Shared frame for About / Help / Privacy / Terms: hero, a table of contents (sticky column from 900 px, a scrolling
 * chip row on phones) and readable sections with anchored headings.
 *
 *   <LegalPage eyebrow title lead description meta={[...]} sections={[{ id, title, body }]} hero={node}>
 *     {extra content rendered under the sections}
 *   </LegalPage>
 */
export default function LegalPage({ eyebrow, title, docTitle, lead, description, meta = [], sections, hero = null, children = null, wide = false }) {
  useDocTitle(`${docTitle || title} · ${BRAND.name}`);
  useMetaDescription(description);
  const active = useActiveSection(sections.map((s) => s.id));
  useHashScroll();

  return (
    <div className="hub-page xl-page">
      <header className="xl-hero">
        <p className="xl-eyebrow">{eyebrow}</p>
        <h1 className="xl-h1">{title}</h1>
        {lead ? <p className="xl-lead">{lead}</p> : null}
        {meta.length ? (
          <ul className="xl-meta">
            {meta.map((m) => (
              <li key={m} className="st-chip">{m}</li>
            ))}
          </ul>
        ) : null}
        {hero}
      </header>

      <div className="xl-layout">
        <nav className="xl-toc" aria-label="On this page">
          <p className="xl-toc__title">On this page</p>
          <ol className="xl-toc__list">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={active === s.id ? 'is-active' : undefined} aria-current={active === s.id ? 'location' : undefined}>
                  {s.short || s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={`xl-body${wide ? ' xl-body--wide' : ''}`}>
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="xl-section st-reveal" style={{ '--i': Math.min(i, 5) }} aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`} className="xl-h2">
                {s.title}
                <a className="xl-anchor" href={`#${s.id}`} aria-label={`Link to “${s.title}”`}>
                  #
                </a>
              </h2>
              <div className="xl-prose">{s.body}</div>
            </section>
          ))}
          {children}
        </div>
      </div>
    </div>
  );
}

/** <meta name="description"> follows the page while it is mounted, then goes back to the site default. */
function useMetaDescription(text) {
  useEffect(() => {
    if (!text || typeof document === 'undefined') return undefined;
    const el = document.querySelector('meta[name="description"]');
    if (!el) return undefined;
    const prev = el.getAttribute('content');
    el.setAttribute('content', text);
    return () => {
      if (prev != null) el.setAttribute('content', prev);
    };
  }, [text]);
}

/** Id of the section currently under the top of the viewport (for the TOC highlight). */
function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0] || '');
  const key = ids.join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => seen.get(id));
        if (first) setActive(first);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/** A link such as /privacy#data opened cold must land on its section (the page mounts after the browser's own attempt). */
function useHashScroll() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || hash.length < 2) return undefined;
    const id = decodeURIComponent(hash.slice(1));
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [hash]);
}

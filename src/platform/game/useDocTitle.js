import { useEffect } from 'react';

/**
 * Sets `document.title` while the calling screen is mounted (index.html only has one static title).
 *
 *   useDocTitle('Page · GameHub');
 *   useDocTitle('Hyderabad Tycoon · GameHub', { description: '...', path: '/games/hyderabad-tycoon', type: 'website' });
 *
 * With a second argument the page also gets a meta description, Open Graph / Twitter tags, a canonical link
 * (built from `path` and the current origin) and, when `jsonLd` is given, an application/ld+json block. Every tag
 * is created or updated in place and put back (or removed) when the screen unmounts, so a shared link and a
 * crawler that runs scripts see the right title for the right game, and the next screen starts clean.
 */

const SITE_TYPES = new Set(['website', 'article', 'game']);

function upsert(head, selector, create, set) {
  let el = head.querySelector(selector);
  const created = !el;
  if (created) {
    el = create();
    head.appendChild(el);
  }
  const prev = created ? null : set.read(el);
  set.write(el);
  return () => {
    if (created) el.remove();
    else set.restore(el, prev);
  };
}

function metaTag(head, attr, key, content) {
  return upsert(
    head,
    `meta[${attr}="${key}"]`,
    () => {
      const m = document.createElement('meta');
      m.setAttribute(attr, key);
      return m;
    },
    { read: (el) => el.getAttribute('content'), write: (el) => el.setAttribute('content', content), restore: (el, prev) => (prev === null ? el.removeAttribute('content') : el.setAttribute('content', prev)) },
  );
}

function absolute(path) {
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return '';
  }
}

/** Applies the tags; returns the function that undoes them. Exported for tests. */
export function applyPageMeta(meta = {}) {
  if (typeof document === 'undefined' || !document.head) return () => {};
  const head = document.head;
  const undo = [];
  const title = typeof meta.title === 'string' ? meta.title : document.title;
  const desc = typeof meta.description === 'string' ? meta.description.replace(/\s+/g, ' ').trim() : '';
  const type = SITE_TYPES.has(meta.type) ? meta.type : 'website';
  const url = typeof meta.path === 'string' && meta.path ? absolute(meta.path) : '';

  if (desc) {
    undo.push(metaTag(head, 'name', 'description', desc));
    undo.push(metaTag(head, 'property', 'og:description', desc));
    undo.push(metaTag(head, 'name', 'twitter:description', desc));
  }
  undo.push(metaTag(head, 'property', 'og:title', title));
  undo.push(metaTag(head, 'name', 'twitter:title', title));
  undo.push(metaTag(head, 'property', 'og:type', type === 'game' ? 'website' : type));
  if (url) {
    undo.push(metaTag(head, 'property', 'og:url', url));
    undo.push(
      upsert(
        head,
        'link[rel="canonical"]',
        () => {
          const l = document.createElement('link');
          l.setAttribute('rel', 'canonical');
          return l;
        },
        { read: (el) => el.getAttribute('href'), write: (el) => el.setAttribute('href', url), restore: (el, prev) => (prev === null ? el.removeAttribute('href') : el.setAttribute('href', prev)) },
      ),
    );
  }
  if (typeof meta.image === 'string' && meta.image) {
    const img = absolute(meta.image);
    if (img) {
      undo.push(metaTag(head, 'property', 'og:image', img));
      undo.push(metaTag(head, 'name', 'twitter:image', img));
    }
  }
  if (meta.noindex) undo.push(metaTag(head, 'name', 'robots', 'noindex'));
  if (meta.jsonLd && typeof meta.jsonLd === 'object') {
    try {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.setAttribute('data-page-meta', '');
      s.textContent = JSON.stringify(meta.jsonLd).replace(/</g, '\u003c');
      head.appendChild(s);
      undo.push(() => s.remove());
    } catch {
      /* structured data is a nicety */
    }
  }
  return () => undo.reverse().forEach((fn) => fn());
}

export default function useDocTitle(title, meta) {
  // `meta` is usually an object literal: key the effect on its content, not its identity
  const key = meta ? JSON.stringify(meta) : '';
  useEffect(() => {
    if (title) document.title = title;
    if (!key) return undefined;
    return applyPageMeta({ ...JSON.parse(key), title });
  }, [title, key]);
}

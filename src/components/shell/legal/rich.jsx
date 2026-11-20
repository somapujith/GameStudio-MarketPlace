import { Link } from 'react-router-dom';
import { contactEmail } from './contact.js';

/*
 * Tiny content renderer so page copy can live as plain data (and the Help search can index the very same text).
 *
 *   inline markup inside any string:   [label](/path)   [label](mailto:x@y)   **bold**   `code`
 *   blocks:  'a paragraph'            -> <p>
 *            { ul: [...] } { ol: [...] }   lists (each item is an inline string)
 *            { note: '...' }          a highlighted aside
 *            { table: { head: [...], rows: [[...], ...] } }   (stacks on phones)
 *            { contact: 'Write to us at' } a paragraph with the contact address; renders nothing when none is configured
 */

const TOKEN = /(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;

function Inline({ text }) {
  const parts = String(text).split(TOKEN);
  return parts.map((part, i) => {
    if (!part) return null;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith('/')) return <Link key={i} to={href}>{label}</Link>;
      return <a key={i} href={href}>{label}</a>;
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Plain text of a block (markup stripped): what search indexes. */
export function plainText(block) {
  const strip = (s) =>
    String(s)
      .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  if (typeof block === 'string') return strip(block);
  if (!block || typeof block !== 'object') return '';
  if (block.ul || block.ol) return (block.ul || block.ol).map(strip).join(' ');
  if (block.note) return strip(block.note);
  if (block.table) return [...block.table.head, ...block.table.rows.flat()].map(strip).join(' ');
  return '';
}

function Table({ head, rows, caption }) {
  return (
    <div className="xl-tablewrap">
      <table className="xl-table">
        {caption ? <caption className="hub-sr">{caption}</caption> : null}
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} data-label={head[c]}>
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Contact({ lead = 'Contact:' }) {
  const email = contactEmail();
  if (!email) return null;
  return (
    <p className="xl-contact">
      {lead} <a href={`mailto:${email}`}>{email}</a>
    </p>
  );
}

/** Render a list of blocks. */
export function Blocks({ blocks }) {
  return (blocks || []).map((b, i) => {
    if (typeof b === 'string') return <p key={i}><Inline text={b} /></p>;
    if (b.ul) return <ul key={i}>{b.ul.map((li, j) => <li key={j}><Inline text={li} /></li>)}</ul>;
    if (b.ol) return <ol key={i}>{b.ol.map((li, j) => <li key={j}><Inline text={li} /></li>)}</ol>;
    if (b.note) return <p key={i} className="xl-note"><Inline text={b.note} /></p>;
    if (b.table) return <Table key={i} {...b.table} />;
    if (b.contact) return <Contact key={i} lead={b.contact} />;
    return null;
  });
}

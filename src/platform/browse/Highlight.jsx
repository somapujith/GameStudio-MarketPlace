import { highlightParts } from './searchGames.js';

/** Text with the matched part of `query` wrapped in <mark>. No query: plain text. */
export default function Highlight({ text, query }) {
  const parts = highlightParts(text, query);
  if (parts.length === 1 && !parts[0].hit) return <>{parts[0].text}</>;
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i} className="bw-mark">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

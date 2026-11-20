import './IndiaArt.css';

export const INDIA_ART = {
  charminar: { src: 'charminar', alt: 'A torn-paper block print of Charminar and Hyderabad street life' },
  mumbai: { src: 'mumbai', alt: 'A torn-paper block print of the Gateway of India in Mumbai' },
  jaipur: { src: 'jaipur', alt: 'A torn-paper block print of Hawa Mahal in Jaipur' },
  chennai: { src: 'chennai', alt: 'A torn-paper block print of Chennai Central railway station' },
  kolkata: { src: 'kolkata', alt: 'A torn-paper block print of Howrah Bridge and a Kolkata tram' },
  'gully-cricket': { src: 'gully-cricket', alt: 'A torn-paper block print of a gully cricket match in an Indian neighbourhood' },
};

/** Original street-print artwork; the surrounding page supplies its frame and caption. */
export default function IndiaArt({ art = 'charminar', className = '', decorative = false, loading = 'lazy' }) {
  const piece = Object.hasOwn(INDIA_ART, art) ? INDIA_ART[art] : INDIA_ART.charminar;
  return (
    <figure className={`india-art ${className}`.trim()}>
      <img
        src={`/art/india/${piece.src}.webp`}
        alt={decorative ? '' : piece.alt}
        width="768"
        height="1024"
        loading={loading}
        decoding="async"
        draggable="false"
      />
    </figure>
  );
}

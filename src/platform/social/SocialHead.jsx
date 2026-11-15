/** Page title for the social screens: signage eyebrow, big display headline, one line, optional chips/actions. */
export default function SocialHead({ eyebrow, title, sub, aside, id = 'sc-title' }) {
  return (
    <header className="sc-head st-reveal">
      <div className="sc-head__text">
        {eyebrow && <span className="st-eyebrow">{eyebrow}</span>}
        <h1 id={id} className="sc-head__title">
          {title}
        </h1>
        {sub && <p className="sc-head__sub">{sub}</p>}
      </div>
      {aside && <div className="sc-head__aside">{aside}</div>}
    </header>
  );
}

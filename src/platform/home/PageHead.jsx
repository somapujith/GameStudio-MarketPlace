/** Title block for the hub pages (Rank, Profile, Shop). `eyebrow` (optional) adds the small signage label above. */
export default function PageHead({ title, sub, icon, actions, eyebrow, id = 'hh2-title' }) {
  return (
    <header className="hh2-pagehead">
      {icon && (
        <span className="hh2-pagehead__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="hh2-pagehead__text">
        {eyebrow && <span className="st-eyebrow">{eyebrow}</span>}
        <h1 id={id} className="hub-h1">
          {title}
        </h1>
        {sub && <p className="hub-lead">{sub}</p>}
      </div>
      {actions && <div className="hh2-pagehead__actions">{actions}</div>}
    </header>
  );
}

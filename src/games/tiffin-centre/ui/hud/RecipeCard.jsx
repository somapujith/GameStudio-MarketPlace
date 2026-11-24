// A recipe card: the dish icon and name, then the steps in English, Telugu and Hindi, then Chotu's tip. Used by the tutorial coach and by
// the '?' recipe peek in the cook sheet, so a player can look up any dish during normal play.
import DishIcon from './DishIcon.jsx';
import { getRecipe } from './recipeData.js';
import './recipe.css';

export default function RecipeCard({ dish, className = '' }) {
  const r = getRecipe(dish);
  if (!r) return null;
  return (
    <section className={`tc-hud-recipe ${className}`.trim()} aria-label={`Recipe: ${r.name}`}>
      <header>
        <DishIcon dish={dish} size={34} />
        <span>
          <b>{r.name}</b>
          <span className="tc-hud-te" lang="te">{r.te}</span>
        </span>
      </header>
      <ol>
        {r.steps.map((s, i) => (
          <li key={i}>
            <span className="tc-hud-recipe-en">{s.en}</span>
            {s.te && <span className="tc-hud-recipe-te tc-hud-te" lang="te">{s.te}</span>}
            {s.hi && <span className="tc-hud-recipe-hi" lang="hi">{s.hi}</span>}
          </li>
        ))}
      </ol>
      {r.tip && (
        <p className="tc-hud-recipe-tip">
          {r.tip}
          {r.tipTe && <span className="tc-hud-te" lang="te">{r.tipTe}</span>}
          {r.tipHi && <span lang="hi">{r.tipHi}</span>}
        </p>
      )}
    </section>
  );
}

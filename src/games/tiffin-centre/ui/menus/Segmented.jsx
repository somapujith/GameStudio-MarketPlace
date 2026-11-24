// A segmented radio group (role="radiogroup" with roving tabindex and arrow keys), the same look as the pace picker.
import { radioKeys } from './hooks.js';
import './menus.css';

export default function Segmented({ options, value, onChange, label, wrap = false }) {
  return (
    <div className={`tc-menu-pace${wrap ? ' is-wrap' : ''}`} role="radiogroup" aria-label={label} onKeyDown={radioKeys}>
      {options.map((o) => {
        const on = (o.id ?? o.value) === value;
        return (
          <button
            key={o.id ?? o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.hint}
            className={`tc-menu-pace__opt${on ? ' is-on' : ''}`}
            onClick={() => onChange?.(o.id ?? o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

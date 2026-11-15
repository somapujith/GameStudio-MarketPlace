import { useId } from 'react';
import { fieldDefault, fieldOptions, formatValue, isCurved, rangeText, sliderPos, sliderSteps, sliderValue } from './settings.js';
import '@/styles/online.css';
import '@/styles/x-lobby.css';

// The controls a game's `manifest.settings` schema is drawn with (docs/MARKETPLACE.md section 4): chips, a segmented
// pill row, a -/+ stepper (with an optional slider and quick picks) and a switch. SettingsPanel owns the state; these
// only draw a value and report what the host did.

export function Chips({ label, options, value, onPick, disabled }) {
  return (
    <div role="radiogroup" aria-label={label} className="ho-chips">
      {options.map((o) => {
        const on = Object.is(o.value, value);
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} className={`ho-chip${on ? ' is-on' : ''}`} onClick={() => onPick(o.value)} disabled={disabled}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented({ label, options, value, onPick, disabled }) {
  return (
    <div role="radiogroup" aria-label={label} className="ho-seg">
      {options.map((o) => {
        const on = Object.is(o.value, value);
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} className={`ho-seg__opt${on ? ' is-on' : ''}`} onClick={() => onPick(o.value)} disabled={disabled}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({ label, valueText, onMinus, onPlus, minusOff, plusOff, disabled }) {
  return (
    <div className="ho-stepper" role="group" aria-label={label}>
      <button type="button" className="ho-stepper__btn" onClick={onMinus} disabled={disabled || minusOff} aria-label={`Decrease ${label}`}>
        &minus;
      </button>
      <output className="ho-stepper__val" aria-live="polite">
        {valueText}
      </output>
      <button type="button" className="ho-stepper__btn" onClick={onPlus} disabled={disabled || plusOff} aria-label={`Increase ${label}`}>
        +
      </button>
    </div>
  );
}

/** A segmented control is a pill row when it is short; many or long options wrap as chips instead. */
const isCompact = (options) => options.length <= 3 && options.reduce((n, o) => n + String(o.label ?? '').length, 0) <= 26;

/** A slider over the legal values of a stepper field, with a -/+ button each side. `onChange(value, { drag: true })`. */
function SliderRow({ field, value, values, onChange, onStep, onRelease, disabled }) {
  const steps = sliderSteps(field);
  const min = typeof field.min === 'number' ? field.min : -Infinity;
  const max = typeof field.max === 'number' ? field.max : Infinity;
  const num = typeof value === 'number';
  const label = field.label;
  const pos = sliderPos(field, value, values);
  return (
    <div className="xl-slider">
      <button type="button" className="ho-stepper__btn xl-slider__btn" onClick={() => onStep(-1)} disabled={disabled || (num && value <= min)} aria-label={`Decrease ${label}`}>
        &minus;
      </button>
      <input
        type="range"
        className={`xl-slider__input${num ? '' : ' is-off'}${isCurved(field) ? ' is-curved' : ''}`}
        min={0}
        max={steps}
        step={1}
        value={pos}
        style={{ '--p': `${steps ? (pos / steps) * 100 : 0}%` }}
        disabled={disabled || !steps}
        aria-label={label}
        aria-valuetext={formatValue(field, value, { plain: true })}
        onChange={(e) => onChange(sliderValue(field, e.target.value), { drag: true })}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        onBlur={onRelease}
      />
      <button type="button" className="ho-stepper__btn xl-slider__btn" onClick={() => onStep(1)} disabled={disabled || (num && value >= max)} aria-label={`Increase ${label}`}>
        +
      </button>
    </div>
  );
}

/**
 * One schema field, rendered by its `type`. `onChange(value)` / `onStep(dir)` are the host's edits.
 *
 * Rule editor extras (all optional): `rule` draws the field as a rule row (label + value + reset + help + range and
 * default), `modified` marks a value that is not the default and shows the reset button (`onReset`), `error` is the
 * server's rejection of the last edit, `onRelease` fires when a slider is let go (the panel sends right then).
 */
export function SettingField({ field, value, values, onChange, onStep, disabled, hideHelp = false, rule = false, modified = false, onReset, onRelease, error }) {
  const id = useId();
  const options = fieldOptions(field, values); // `values`: every setting right now (hidden / default-marked options)
  const helpId = field.help && !hideHelp ? `${id}-help` : undefined;
  const help = field.help && !hideHelp ? (
    <p className="ho-help" id={helpId}>
      {field.help}
    </p>
  ) : null;
  const def = fieldDefault(field, values);
  const defText = formatValue(field, def, { compact: rule }); // a rule row reads "₹16L"; the older plain fields keep the full amount
  const range = field.type === 'stepper' ? rangeText(field) : '';
  const errorId = error ? `${id}-err` : undefined;

  const reset = rule && modified && onReset ? (
    <button type="button" className="xl-rule__reset" onClick={onReset} disabled={disabled} aria-label={`Reset ${field.label} to its default, ${defText}`}>
      Reset
    </button>
  ) : null;
  const meta = rule ? (
    <p className="xl-rule__meta">
      {range && <span>Range {range}</span>}
      <span>Default {defText}</span>
    </p>
  ) : null;
  const err = error ? (
    <p className="ho-inline-error xl-rule__err" id={errorId} role="alert">
      {error}
    </p>
  ) : null;
  const shell = (children, valueText) => (
    <div className={`ho-field${rule ? ` xl-rule${modified ? ' is-modified' : ''}` : ''}`} data-rule={rule ? field.key : undefined}>
      {rule ? (
        <div className="xl-rule__head">
          <span className="ho-field__label xl-rule__label">{field.label}</span>
          {valueText != null && <span className="xl-rule__val">{valueText}</span>}
          {reset}
        </div>
      ) : (
        <div className="ho-field__label">{field.label}</div>
      )}
      {children}
      {help}
      {meta}
      {err}
    </div>
  );

  if (field.type === 'toggle') {
    return (
      <div className={`ho-field${rule ? ` xl-rule${modified ? ' is-modified' : ''}` : ''}`} data-rule={rule ? field.key : undefined}>
        <div className={rule ? 'xl-rule__switchrow' : undefined}>
          <button
            type="button"
            role="switch"
            aria-checked={!!value}
            aria-describedby={[helpId, errorId].filter(Boolean).join(' ') || undefined}
            className={`ho-switch${value ? ' is-on' : ''}`}
            onClick={() => onChange(!value)}
            disabled={disabled}
          >
            <span className="ho-switch__label">{field.label}</span>
            <span className="ho-switch__track" aria-hidden="true">
              <span className="ho-switch__thumb" />
            </span>
          </button>
          {reset}
        </div>
        {help}
        {meta}
        {err}
      </div>
    );
  }

  if (field.type === 'stepper') {
    const min = typeof field.min === 'number' ? field.min : -Infinity;
    const max = typeof field.max === 'number' ? field.max : Infinity;
    const valueText = formatValue(field, value, { compact: rule });
    // a nullable field without an explicit "Off" option gets one
    const needsOff = !!field.nullable && !(Array.isArray(field.options) && field.options.some((o) => o && o.value === null));
    const picks = needsOff ? [{ value: null, label: field.nullLabel || 'Off' }, ...options] : options;
    if (field.slider) {
      return shell(
        <>
          <SliderRow field={field} value={value} values={values} onChange={onChange} onStep={onStep} onRelease={onRelease} disabled={disabled} />
          {picks.length > 0 && <Chips label={`${field.label} quick picks`} options={picks} value={value} onPick={onChange} disabled={disabled} />}
        </>,
        valueText,
      );
    }
    const stepper = (
      <Stepper
        label={field.label.toLowerCase()}
        valueText={valueText}
        onMinus={() => onStep(-1)}
        onPlus={() => onStep(1)}
        minusOff={typeof value === 'number' && value <= min}
        plusOff={typeof value === 'number' && value >= max}
        disabled={disabled}
      />
    );
    return shell(
      <>
        {picks.length > 0 && <Chips label={`${field.label} quick picks`} options={picks} value={value} onPick={onChange} disabled={disabled} />}
        {picks.length > 0 ? (
          <div className="ho-field__row">
            <span className="ho-muted">Custom</span>
            {stepper}
          </div>
        ) : (
          <div className="ho-field__row">{stepper}</div>
        )}
      </>,
    );
  }

  // segmented
  return shell(
    isCompact(options) ? (
      <Segmented label={field.label} options={options} value={value} onPick={onChange} disabled={disabled} />
    ) : (
      <Chips label={field.label} options={options} value={value} onPick={onChange} disabled={disabled} />
    ),
  );
}

// A small "?" button that (re)starts a tour. Fits the desktop top bar, the phone top bar and the hub:
//   <TourHelpButton onClick={tour.start} label="Take the tour" />            round "?" (44px)
//   <TourHelpButton onClick={...} showLabel />                               "? Tour" pill
import '@/styles/tour.css';

export default function TourHelpButton({ onClick, label = 'Take the tour', showLabel = false, small = false, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`tour-help${showLabel ? ' has-label' : ''}${small ? ' is-small' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-tour-help=""
      {...rest}
    >
      <span className="tour-help__q" aria-hidden="true">?</span>
      {showLabel ? <span className="tour-help__t">Tour</span> : null}
    </button>
  );
}

export { TourHelpButton };

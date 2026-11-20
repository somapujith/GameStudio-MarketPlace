import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { useViewTransitionNavigate } from '../transitions.js';

/**
 * A react-router <Link> whose plain left clicks navigate through a view transition (see transitions.js).
 * Modified clicks (new tab, etc.), `target`, `reloadDocument` and prevented clicks behave exactly like <Link>.
 */
const TransitionLink = forwardRef(function TransitionLink({ to, replace, state, onClick, target, reloadDocument, ...rest }, ref) {
  const go = useViewTransitionNavigate();
  const handle = (e) => {
    onClick?.(e);
    if (e.defaultPrevented || reloadDocument) return;
    if (e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
    if (target && target !== '_self') return;
    e.preventDefault();
    go(to, { replace, state });
  };
  return <Link ref={ref} to={to} replace={replace} state={state} target={target} reloadDocument={reloadDocument} onClick={handle} {...rest} />;
});

export default TransitionLink;

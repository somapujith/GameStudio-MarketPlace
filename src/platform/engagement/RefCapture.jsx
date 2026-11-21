import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { captureRef, hasRefParam, refFromLocation, stripRefParam } from '@/lib/referral.js';

/**
 * Remembers the first referral code a visitor arrives with (`?ref=HYD-XXXX` on any page, or a `/f/HYD-XXXX` friend link)
 * and takes `ref` out of the address bar. Waits for the session check so a signed-in player never stores their own code.
 * Renders nothing; mounted once inside the router.
 *
 * The URL is rewritten with a replacing navigation (history.replaceState through the router), so the router's own
 * location loses `ref` too and a later `setSearchParams` on the page cannot bring it back.
 */
export default function RefCapture() {
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname, search, hash } = location;
  const { user, loading } = useAuth();
  const own = user?.friendCode || '';
  useEffect(() => {
    if (loading) return;
    const code = refFromLocation({ pathname, search });
    if (code) captureRef(code, { ownCode: own });
    if (hasRefParam(search)) navigate({ pathname, search: stripRefParam(search), hash }, { replace: true, state: location.state, preventScrollReset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location.state rides along, it is not a trigger
  }, [pathname, search, hash, loading, own, navigate]);
  return null;
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyReferrals } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import { BRAND } from '@/platform/brand.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Ava from '@/platform/home/Ava.jsx';
import { WhatsAppIcon } from '@/platform/social/SIcon.jsx';
import { useApi, useApiReady } from '@/platform/home/useApi.js';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { useAccount } from '@/components/shell/hooks.js';
import { canShare, shareOrCopy, useCopied } from '@/components/online/clipboard.js';
import { relativeTime } from '@/platform/notifications/notificationsModel.js';
import { REFERRAL_COINS, normalizeReferrals, referralShare, referralUrl, referralWhatsApp } from './engagementModel.js';
import '@/styles/cine/profile.css';

const fmt = (n) => Number(n).toLocaleString('en-IN');
/** 'joined 2 h ago', 'joined yesterday', 'joined 10 Nov'. */
const joinedLabel = (iso) => {
  const rel = relativeTime(iso);
  if (!rel) return 'recently';
  return /^\d+ [A-Z]/.test(rel) ? rel : rel.charAt(0).toLowerCase() + rel.slice(1);
};
const origin = () => (typeof location !== 'undefined' ? location.origin : '');

function Head() {
  return (
    <>
      <span className="cj-pro-ref__stamp" aria-hidden="true">
        <CoinIcon size={20} /> +{REFERRAL_COINS}
      </span>
      <h2 id="jg-ref-h" className="cj-pro-ref__title">
        Invite friends
      </h2>
      <p className="cj-pro-ref__sub">Both of you get {REFERRAL_COINS} coins when they finish their first match.</p>
    </>
  );
}

/** Presentational (renders on the server). `mode`: 'member' | 'gate' (signed out / guest) | 'loading' | 'error'. */
export function ReferralView({ mode = 'member', data, url = '', guest = false, copied = false, shareable = false, live = '', onCopy, onShare, onRetry }) {
  if (mode === 'gate') {
    return (
      <section id="invite" className="cj-pro-sec cj-pro-ref cj-pro-ref--gate" aria-labelledby="jg-ref-h">
        <Head />
        <p className="cj-pro-ref__gatetext">{guest ? 'Guests cannot invite friends. Sign in with Google to get your own invite link and earn coins.' : 'Sign in to get your own invite link and earn coins for every friend who joins.'}</p>
        <Link to={paths.login(paths.profile())} className="cj-btn cj-btn--primary">
          Sign in to earn
        </Link>
      </section>
    );
  }
  const r = normalizeReferrals(data);
  return (
    <section id="invite" className="cj-pro-sec cj-pro-ref" aria-labelledby="jg-ref-h" aria-busy={mode === 'loading'}>
      <Head />
      {mode === 'error' ? (
        <p className="cj-pro-ref__err">
          Could not load your invite link.{' '}
          <button type="button" className="cj-pro-link cj-pro-linkbtn" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : (
        <>
          <div className="cj-pro-ref__linkrow">
            <label className="cj-pro-ref__label" htmlFor="jg-ref-link">
              Your invite link
            </label>
            <input id="jg-ref-link" className="cj-pro-ref__link" type="text" readOnly value={mode === 'loading' ? 'Loading…' : url} onFocus={(e) => e.target.select()} />
            <div className="cj-pro-ref__actions">
              <button type="button" className="cj-btn cj-btn--primary cj-btn--sm" onClick={onCopy} disabled={!url}>
                <HubIcon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
              </button>
              {shareable && (
                <button type="button" className="cj-btn cj-btn--sm" onClick={onShare} disabled={!url}>
                  <HubIcon name="share" size={16} /> Share
                </button>
              )}
              <a
                className={`cj-btn cj-btn--sm cj-pro-ref__wa${url ? '' : ' is-off'}`}
                href={url ? referralWhatsApp(url, BRAND.name) : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!url || undefined}
              >
                <WhatsAppIcon size={16} /> WhatsApp<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
          <dl className="cj-pro-ref__stats">
            <div>
              <dt>Invited</dt>
              <dd>{fmt(r.invited)}</dd>
            </div>
            <div>
              <dt>Played a match</dt>
              <dd>{fmt(r.rewarded)}</dd>
            </div>
            <div className="is-coins">
              <dt>Coins earned</dt>
              <dd>
                <CoinIcon size={18} /> {fmt(r.coinsEarned)}
              </dd>
            </div>
          </dl>
          {r.recent.length > 0 ? (
            <div className="cj-pro-ref__recent">
              <h3 className="cj-pro-ref__rh">Recent invites</h3>
              <ul className="cj-pro-ref__list">
                {r.recent.map((p, i) => (
                  <li key={`${p.name}-${p.joinedAt}-${i}`} className="cj-pro-ref__row">
                    <Ava preset={p.avatar} size={34} />
                    <span className="cj-pro-ref__who">
                      <b title={p.name}>{p.name}</b>
                      <small>Joined {joinedLabel(p.joinedAt)}</small>
                    </span>
                    <span className={`cj-pro-ref__state${p.rewarded ? ' is-paid' : ''}`}>
                      {p.rewarded ? (
                        <>
                          <CoinIcon size={13} /> +{REFERRAL_COINS}
                        </>
                      ) : (
                        'Yet to play'
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : mode === 'member' ? (
            <p className="cj-pro-ref__none">Nobody has joined with your link yet. Share it in your group chat.</p>
          ) : null}
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </section>
  );
}

/** Profile section: the member's invite link with copy / share / WhatsApp and their referral numbers. */
export default function ReferralCard() {
  const ready = useApiReady();
  const { account, guest } = useAccount();
  const res = useApi('/api/me/referrals', { enabled: ready && account, fetcher: getMyReferrals });
  const [copied, copy] = useCopied();
  const [live, setLive] = useState('');
  if (!account) return <ReferralView mode="gate" guest={guest} />;
  const mode = res.status === 'ok' ? 'member' : res.status === 'loading' || res.status === 'idle' ? 'loading' : 'error';
  const url = mode === 'member' ? referralUrl(res.data?.link, origin()) : '';
  const onCopy = async () => setLive((await copy(url)) ? 'Invite link copied.' : 'Could not copy. Select the link and copy it.');
  const onShare = async () => {
    const r = await shareOrCopy(referralShare(url, BRAND.name));
    if (r === 'copied') setLive('Invite link copied.');
  };
  return <ReferralView mode={mode} data={res.data} url={url} copied={copied} shareable={canShare()} live={live} onCopy={onCopy} onShare={onShare} onRetry={res.reload} />;
}

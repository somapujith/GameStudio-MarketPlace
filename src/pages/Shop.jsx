import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { COSMETICS, COSMETIC_KINDS, FREE_COSMETICS, cleanEquipped, cosmeticById } from '@shared/cosmetics.js';
import { buyCosmetic, equipCosmetic, errorMessage, getShop } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured } from '@/platform/home/catalog.js';
import PageHead from '@/platform/home/PageHead.jsx';
import Ava, { Dice, Preview, Title } from '@/platform/home/Ava.jsx';
import { invalidateApi, useApi, useApiGate, useCountUp } from '@/platform/home/useApi.js';
import Modal from '@/components/shell/Modal.jsx';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { fmtNum } from '@/components/shell/ui.jsx';
import { useToast } from '@/components/shell/Toast.jsx';
import { useAccount, useProgress } from '@/components/shell/hooks.js';
import { useProfile } from '@/components/shell/stores.js';
import { celebrate } from '@/components/shell/celebrate.js';
import '@/styles/hubhome.css';
import '@/styles/x-profile.css';

const KIND_LABEL = { frame: 'Frames', dice: 'Dice', title: 'Titles' };
const KIND_ONE = { frame: 'frame', dice: 'dice skin', title: 'title' };
const KIND_ICON = { frame: 'user', dice: 'dice', title: 'star' };
const RARITY = { common: 'Common', rare: 'Rare', epic: 'Epic' };
const PANEL_ID = 'xp-shop-panel';

/** Catalogue merged with the server's view (`owned`, `equipped`, price). Unknown server ids are ignored. */
function mergeItems(serverItems, owned) {
  const byId = new Map((Array.isArray(serverItems) ? serverItems : []).filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x]));
  return COSMETICS.map((c) => {
    const s = byId.get(c.id);
    const price = Number.isFinite(Number(s?.price)) ? Number(s.price) : c.price;
    return { ...c, price, rarity: s?.rarity || c.rarity, owned: owned.has(c.id) || price === 0 };
  });
}

function KindTabs({ value, onChange }) {
  const list = useRef(null);
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    const idx = COSMETIC_KINDS.indexOf(value);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? COSMETIC_KINDS.length - 1 : (idx + step + COSMETIC_KINDS.length) % COSMETIC_KINDS.length;
    e.preventDefault();
    onChange(COSMETIC_KINDS[next]);
    requestAnimationFrame(() => list.current?.querySelector(`[data-kind="${COSMETIC_KINDS[next]}"]`)?.focus());
  };
  return (
    <div className="hub-row hub-row--tight hh2-tabs xp-kindtabs" role="tablist" aria-label="Item type" ref={list} onKeyDown={onKeyDown}>
      {COSMETIC_KINDS.map((k) => {
        const on = k === value;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            id={`xp-tab-${k}`}
            data-kind={k}
            aria-selected={on}
            aria-controls={PANEL_ID}
            tabIndex={on ? 0 : -1}
            className={`hub-chip hh2-tab ${on ? 'is-on' : ''}`}
            onClick={() => onChange(k)}
          >
            <HubIcon name={KIND_ICON[k]} size={18} />
            <span>{KIND_LABEL[k]}</span>
          </button>
        );
      })}
    </div>
  );
}

function ItemCard({ item, i, equipped, selected, coins, canBuy, signedIn, offline, busy, fresh, avatar, onSelect, onBuy, onEquip }) {
  const isEquipped = equipped[item.kind] === item.id;
  const short = canBuy && Number.isFinite(coins) && coins < item.price ? item.price - coins : 0;
  let action;
  if (item.owned) {
    action = (
      <button
        type="button"
        className={`hub-btn hub-btn--sm ${isEquipped ? 'hub-btn--soft' : 'hub-btn--accent'}`}
        onClick={() => onEquip(item, !isEquipped)}
        disabled={!signedIn || offline || busy}
        aria-label={`${isEquipped ? 'Unequip' : 'Equip'} ${item.name}`}
      >
        {busy ? 'Saving…' : isEquipped ? 'Unequip' : 'Equip'}
      </button>
    );
  } else if (!signedIn) {
    action = (
      <Link to={paths.login(paths.shop())} className="hub-btn hub-btn--soft hub-btn--sm">
        Sign in to buy
      </Link>
    );
  } else {
    action = (
      <button type="button" className={`hub-btn hub-btn--sm ${short ? 'hub-btn--soft' : 'hub-btn--primary'}`} onClick={() => onBuy(item)} disabled={offline || busy} aria-label={`Buy ${item.name} for ${fmtNum(item.price)} coins`}>
        {short ? `Need ${fmtNum(short)} more` : 'Buy'}
      </button>
    );
  }
  return (
    <li
      className={`xp-item xp-item--${item.rarity} ${selected ? 'is-sel' : ''} ${isEquipped ? 'is-equipped' : ''} ${fresh ? 'is-fresh' : ''}`.replace(/\s+/g, ' ').trim()}
      style={{ '--i': Math.min(i, 12) }}
    >
      <button type="button" className="xp-item__art" onClick={() => onSelect(item.id)} aria-pressed={selected} aria-label={`Preview ${item.name}`}>
        <Preview item={item} size={76} avatar={avatar} />
      </button>
      <div className="xp-item__body">
        <b className="xp-item__name" title={item.name}>
          {item.name}
        </b>
        <span className="xp-item__tags">
          <span className={`xp-rarity xp-rarity--${item.rarity}`}>{RARITY[item.rarity] || item.rarity}</span>
          {isEquipped ? (
            <span className="xp-state xp-state--on">
              <HubIcon name="check" size={12} strokeWidth={3} /> Equipped
            </span>
          ) : item.owned ? (
            <span className="xp-state">{item.price === 0 ? 'Free' : 'Owned'}</span>
          ) : (
            <span className="xp-price">
              <CoinIcon size={14} /> {fmtNum(item.price)}
            </span>
          )}
        </span>
      </div>
      <div className="xp-item__act">{action}</div>
    </li>
  );
}

/** `/shop` — spend coins on cosmetics (avatar frames, dice skins, titles). Visual only, never a gameplay edge. */
export default function Shop() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { user, signedIn, auth } = useAccount();
  const [profile] = useProfile();
  const progress = useProgress();
  const { booting, ready, retry } = useApiGate();
  const res = useApi('/api/shop', { enabled: ready, fetcher: getShop });

  const kind = COSMETIC_KINDS.includes(params.get('kind')) ? params.get('kind') : 'frame';
  const pickKind = useCallback((k) => setParams(k === 'frame' ? {} : { kind: k }, { replace: true }), [setParams]);

  // Server state, then local updates from buy / equip responses (no refetch flash).
  const [owned, setOwned] = useState(() => new Set(FREE_COSMETICS));
  const [equipped, setEquipped] = useState(() => cleanEquipped(user?.equipped));
  const [coins, setCoins] = useState(null);
  useEffect(() => {
    const d = res.data;
    if (res.status !== 'ok' || !d) return;
    const items = Array.isArray(d.items) ? d.items : [];
    setOwned(new Set([...FREE_COSMETICS, ...items.filter((x) => x?.owned).map((x) => x.id)]));
    const eq = d.equipped && typeof d.equipped === 'object' ? d.equipped : Object.fromEntries(items.filter((x) => x?.equipped).map((x) => [x.kind, x.id]));
    setEquipped(cleanEquipped(eq));
    setCoins(Number.isFinite(Number(d.coins)) ? Number(d.coins) : null);
  }, [res.status, res.data]);
  useEffect(() => {
    if (res.status !== 'ok') setEquipped(cleanEquipped(user?.equipped));
  }, [user?.equipped, res.status]);

  const balance = signedIn ? (coins ?? (Number.isFinite(Number(user?.coins)) ? Number(user.coins) : progress.coins)) : null;
  const shownCoins = useCountUp(balance ?? 0);

  const items = useMemo(() => mergeItems(res.data?.items, owned), [res.data, owned]);
  const ofKind = items.filter((x) => x.kind === kind);
  const offline = !booting && (!ready || res.status === 'offline' || res.status === 'error');
  const loading = booting || (ready && res.status === 'loading');

  const [sel, setSel] = useState(null);
  const selItem = sel ? cosmeticById(sel) : null;
  const look = { ...equipped, ...(selItem ? { [selItem.kind]: selItem.id } : null) };
  const avatar = signedIn && user?.avatar != null ? Number(user.avatar) : profile.avatar;
  const name = (signedIn && user?.name) || profile.name;

  const [busyId, setBusyId] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [dialog, setDialog] = useState(null); // { item, phase: 'confirm'|'busy'|'poor'|'error', msg? }
  const close = () => setDialog((d) => (d?.phase === 'busy' ? d : null));
  const lead = useMemo(featured, []);

  const openBuy = (item) => {
    setSel(item.id);
    const short = Number.isFinite(balance) && balance < item.price;
    setDialog({ item, phase: short ? 'poor' : 'confirm' });
  };

  const doBuy = async () => {
    const item = dialog?.item;
    if (!item) return;
    setDialog({ item, phase: 'busy' });
    try {
      const r = await buyCosmetic(item.id);
      if (Array.isArray(r?.owned)) setOwned(new Set([...FREE_COSMETICS, ...r.owned]));
      else setOwned((o) => new Set([...o, item.id]));
      if (Number.isFinite(Number(r?.coins))) setCoins(Number(r.coins));
      invalidateApi('/api/shop');
      setDialog(null);
      setFresh(item.id);
      celebrate({ kind: 'purchase', title: `${item.name} is yours`, text: `New ${KIND_ONE[item.kind]} unlocked. Equip it to show it off at the table.`, icon: 'gift' });
      Promise.resolve(auth.refresh?.()).catch(() => {});
    } catch (e) {
      if (e?.status === 402) setDialog({ item, phase: 'poor' });
      else if (e?.status === 409) {
        setOwned((o) => new Set([...o, item.id]));
        setDialog(null);
        toast(`You already own ${item.name}.`, { tone: 'info' });
      } else if (e?.status === 401) setDialog({ item, phase: 'error', msg: 'Your session ended. Sign in again to buy.' });
      else setDialog({ item, phase: 'error', msg: errorMessage(e, 'Could not complete the purchase.') });
    }
  };

  const doEquip = async (item, on) => {
    setBusyId(item.id);
    const prev = equipped;
    setEquipped((eq) => {
      const next = { ...eq };
      if (on) next[item.kind] = item.id;
      else delete next[item.kind];
      return next;
    });
    try {
      const r = await equipCosmetic(item.kind, on ? item.id : null);
      if (r?.equipped) setEquipped(cleanEquipped(r.equipped));
      setSel(null);
      invalidateApi('/api/shop');
      Promise.resolve(auth.refresh?.()).catch(() => {});
      toast(on ? `${item.name} equipped` : `${item.name} removed`, { tone: 'good' });
    } catch (e) {
      setEquipped(prev);
      toast(e?.status === 403 ? `You do not own ${item.name} yet.` : errorMessage(e, 'Could not save. Try again.'), { tone: 'bad' });
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (!fresh) return undefined;
    const t = setTimeout(() => setFresh(null), 1400);
    return () => clearTimeout(t);
  }, [fresh]);

  const d = dialog;
  const after = d && Number.isFinite(balance) ? balance - d.item.price : null;

  return (
    <div className="hub-page hh2 xp-page xp-shop">
      <PageHead
        title="Shop"
        sub="Frames, dice and titles. Looks only, never an advantage."
        icon={<HubIcon name="gift" size={26} />}
        actions={
          signedIn ? (
            <span className="xp-balance" aria-label={`Balance: ${fmtNum(balance ?? 0)} coins`}>
              <CoinIcon size={22} />
              <b aria-hidden="true">{fmtNum(shownCoins)}</b>
            </span>
          ) : null
        }
      />

      <section className="hub-panel xp-look" aria-label="Your look">
        <div className="xp-look__stage" key={`${look.frame || ''}|${look.title || ''}|${look.dice || ''}`}>
          <Ava preset={avatar} size={84} frame={look.frame} ring="var(--hub-surface-3)" />
          <div className="xp-look__id">
            <b className="xp-look__name">{name}</b>
            {look.title ? <Title title={look.title} size="md" /> : <span className="hub-muted xp-look__none">No title</span>}
            <span className="xp-look__dice">
              <Dice skin={look.dice || 'dice-ivory'} size={30} />
              <small>{cosmeticById(look.dice || 'dice-ivory')?.name} dice</small>
            </span>
          </div>
        </div>
        <p className="xp-look__note" aria-live="polite">
          {selItem && equipped[selItem.kind] !== selItem.id ? (
            <>
              Previewing <b>{selItem.name}</b>.{' '}
              <button type="button" className="hh2-textlink xp-linkbtn" onClick={() => setSel(null)}>
                Show my current look
              </button>
            </>
          ) : (
            'Tap an item to try it on.'
          )}
        </p>
      </section>

      {!signedIn && !booting && (
        <div className="hh2-banner">
          <HubIcon name="user" size={20} />
          <p>Browse everything now. Sign in to buy with the coins you win.</p>
          <Link to={paths.login(paths.shop())} className="hub-btn hub-btn--primary hub-btn--sm">
            Sign in
          </Link>
        </div>
      )}
      {offline && (
        <div className="hh2-banner xp-banner--warn" role="status">
          <HubIcon name="wifiOff" size={20} />
          <p>You are offline. You can look around; buying and equipping need a connection.</p>
          <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={ready ? res.reload : retry}>
            <HubIcon name="refresh" size={16} /> Try again
          </button>
        </div>
      )}

      <KindTabs value={kind} onChange={pickKind} />
      <section id={PANEL_ID} role="tabpanel" aria-labelledby={`xp-tab-${kind}`} aria-busy={loading} className="xp-shop__panel">
        <ul className={`xp-items ${loading ? 'is-loading' : ''}`} key={kind}>
          {ofKind.map((item, i) => (
            <ItemCard
              key={item.id}
              item={item}
              i={i}
              equipped={equipped}
              selected={sel === item.id}
              coins={balance}
              canBuy={signedIn}
              signedIn={signedIn}
              offline={offline || loading}
              busy={busyId === item.id}
              fresh={fresh === item.id}
              avatar={avatar}
              onSelect={(id) => setSel((s) => (s === id ? null : id))}
              onBuy={openBuy}
              onEquip={doEquip}
            />
          ))}
        </ul>
      </section>

      <Modal
        open={!!d}
        onClose={close}
        dismissible={d?.phase !== 'busy'}
        title={d ? (d.phase === 'poor' ? 'Not enough coins' : d.phase === 'error' ? 'Purchase failed' : `Buy ${d.item.name}?`) : ''}
        actions={
          d?.phase === 'poor' ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={close}>
                Close
              </button>
              <Link to={paths.hub()} className="btn btn--primary" onClick={close} data-autofocus>
                Claim daily reward
              </Link>
            </>
          ) : d?.phase === 'error' ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={close}>
                Close
              </button>
              <button type="button" className="btn btn--primary" onClick={doBuy} data-autofocus>
                Try again
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" onClick={close} disabled={d?.phase === 'busy'}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={doBuy} disabled={d?.phase === 'busy'} data-autofocus>
                {d?.phase === 'busy' ? 'Buying…' : `Buy for ${fmtNum(d?.item.price ?? 0)}`}
              </button>
            </>
          )
        }
      >
        {d && (
          <div className="xp-buy">
            <span className="xp-buy__art">
              <Preview item={d.item} size={88} avatar={avatar} />
            </span>
            {d.phase === 'poor' ? (
              <p>
                Not enough coins — play a match or claim your daily reward.
                {Number.isFinite(balance) && (
                  <>
                    {' '}
                    You have <b>{fmtNum(balance)}</b>, {d.item.name} costs <b>{fmtNum(d.item.price)}</b>.
                  </>
                )}
                {lead && (
                  <>
                    {' '}
                    <Link to={paths.game(lead.id)} className="hh2-textlink" onClick={close}>
                      Play {lead.name}
                    </Link>
                  </>
                )}
              </p>
            ) : d.phase === 'error' ? (
              <p>{d.msg}</p>
            ) : (
              <p>
                <span className={`xp-rarity xp-rarity--${d.item.rarity}`}>{RARITY[d.item.rarity]}</span> {KIND_ONE[d.item.kind]} for{' '}
                <b className="xp-price">
                  <CoinIcon size={14} /> {fmtNum(d.item.price)}
                </b>
                {after !== null && (
                  <>
                    . Balance after: <b>{fmtNum(after)}</b>
                  </>
                )}
                .
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

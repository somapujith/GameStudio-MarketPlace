import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { COSMETICS, COSMETIC_KINDS, EQUIPPABLE_KINDS, FREE_COSMETICS, cleanEquipped, cosmeticById } from '@shared/cosmetics.js';
import { buyCosmetic, equipCosmetic, errorMessage, getShop } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured } from '@/platform/home/catalog.js';
import Ava, { Dice, Preview, Title } from '@/platform/home/Ava.jsx';
import { invalidateApi, useApi, useApiGate, useCountUp } from '@/platform/home/useApi.js';
import Modal from '@/components/shell/Modal.jsx';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { fmtNum } from '@/components/shell/ui.jsx';
import { useToast } from '@/components/shell/Toast.jsx';
import { useAccount, useDaily, useProgress } from '@/components/shell/hooks.js';
import { useProfile } from '@/components/shell/stores.js';
import { celebrate } from '@/components/shell/celebrate.js';
import { VoiceArt, useVoicePreview } from '@/components/voice/VoiceShop.jsx';
import '@/styles/hubhome.css';
import '@/styles/x-profile.css';
import '@/styles/hubMoments.css';
import '@/styles/store-account.css';
import '@/styles/shop-shine.css';
import {
  RARITY_FILTERS,
  RARITY_LABEL,
  SORTS,
  lookSlots,
  parseKind,
  parseRarity,
  parseSort,
  shopList,
  shopQuery,
  vaultCount,
  vaultItems,
  vaultVisible,
} from './shopModel.js';

const KIND_LABEL = { frame: 'Frames', dice: 'Dice', trail: 'Trails', board: 'Boards', title: 'Titles', voice: 'Voice lines' };
const KIND_ONE = { frame: 'frame', dice: 'dice skin', trail: 'pawn trail', board: 'board theme', title: 'title', voice: 'voice line' };
const KIND_ICON = { frame: 'user', dice: 'dice', trail: 'spark', board: 'table', title: 'star', voice: 'bell' };
const RARITY = RARITY_LABEL;
const PANEL_ID = 'xp-shop-panel';
const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'afford', label: 'I can afford' },
];
/** Look-panel copy: the slot label and what an empty slot means. */
const SLOT = {
  frame: { label: 'Avatar and frame', none: 'No frame' },
  title: { label: 'Title', none: 'No title' },
  dice: { label: 'Dice', none: 'Ivory (default)' },
  trail: { label: 'Pawn trail', none: 'No trail' },
  board: { label: 'Board theme', none: 'Classic board' },
};

/** Catalogue merged with the server's view (`owned`, `equipped`, price). Unknown server ids are ignored. */
function mergeItems(serverItems, owned) {
  const byId = new Map((Array.isArray(serverItems) ? serverItems : []).filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x]));
  return COSMETICS.map((c) => {
    const s = byId.get(c.id);
    const price = Number.isFinite(Number(s?.price)) ? Number(s.price) : c.price;
    return { ...c, price, rarity: s?.rarity || c.rarity, owned: owned.has(c.id) || price === 0 };
  });
}

function KindTabs({ value, onChange, counts }) {
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
        const c = counts[k];
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
            {c && (
              <span className="sa-tabcount" aria-label={`${c.owned} of ${c.total} owned`}>
                {c.owned}/{c.total}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ItemCard({ item, i, equipped, selected, coins, signedIn, offline, busy, buying, fresh, avatar, preview, onSelect, onBuy, onEquip }) {
  const isVoice = item.kind === 'voice';
  const isEquipped = !isVoice && equipped[item.kind] === item.id;
  const known = Number.isFinite(coins);
  const short = signedIn && !item.owned && known && coins < item.price ? item.price - coins : 0;
  const affordable = signedIn && !item.owned && !short;
  let action;
  if (item.owned && isVoice) {
    // voice lines are owned-only (no equip): the action is the preview, which only owners get
    const on = preview?.playingId === item.id;
    action = (
      <button
        type="button"
        className="hub-btn hub-btn--sm hub-btn--accent vl-play"
        onClick={() => preview?.toggle(item)}
        aria-pressed={on}
        aria-label={`${on ? 'Stop' : 'Play'} ${item.name}`}
      >
        <HubIcon name={on ? 'close' : 'play'} size={16} /> {on ? 'Stop' : 'Play'}
      </button>
    );
  } else if (item.owned) {
    action = (
      <button
        type="button"
        className={`hub-btn hub-btn--sm ${isEquipped ? 'hub-btn--soft' : 'hub-btn--accent'}`}
        onClick={() => onEquip(item, !isEquipped)}
        disabled={!signedIn || offline || busy || buying}
        aria-label={`${isEquipped ? 'Unequip' : 'Equip'} ${item.name}`}
      >
        {busy ? 'Saving…' : buying ? 'Buying…' : isEquipped ? 'Unequip' : 'Equip'}
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
      <button
        type="button"
        className={`hub-btn hub-btn--sm ${short ? 'hub-btn--soft' : 'hub-btn--primary'}`}
        onClick={() => onBuy(item)}
        disabled={offline}
        aria-label={short ? `${item.name}: need ${fmtNum(short)} more coins` : `Buy ${item.name} for ${fmtNum(item.price)} coins`}
      >
        {short ? `Need ${fmtNum(short)} more` : 'Buy'}
      </button>
    );
  }
  const legendary = item.rarity === 'legendary';
  const stateCls = isEquipped ? 'is-equipped' : item.owned ? 'is-owned' : short ? 'is-locked' : affordable ? 'is-afford' : '';
  return (
    <li
      className={`xp-item xp-item--${item.rarity} ${stateCls} ${selected ? 'is-sel' : ''} ${fresh ? 'is-fresh' : ''}`.replace(/\s+/g, ' ').trim()}
      style={{ '--i': Math.min(i, 12) }}
    >
      {legendary && (
        <span className="xz-glints" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      {isVoice ? (
        <div className="vl-art" style={{ '--rc': 'var(--hub-line-2)' }}>
          <VoiceArt item={item} size={76} locked={!item.owned} playing={preview?.playingId === item.id} />
        </div>
      ) : (
        <button type="button" className="xp-item__art" onClick={() => onSelect(item.id)} aria-pressed={selected} aria-label={`Preview ${item.name}`}>
          <span className="hub-moment-preview">
            <Preview item={item} size={76} avatar={avatar} shine={legendary} />
          </span>
          {short > 0 && (
            <span className="sa-lock" aria-hidden="true">
              <HubIcon name="lock" size={14} strokeWidth={2.4} />
            </span>
          )}
        </button>
      )}
      <div className="xp-item__body">
        <b className="xp-item__name" title={item.name}>
          {item.name}
        </b>
        {isVoice && item.caption ? <p className="vl-cap">{item.caption}</p> : null}
        <span className="xp-item__tags">
          <span className={`xp-rarity xp-rarity--${item.rarity}`}>{RARITY[item.rarity] || item.rarity}</span>
          {isEquipped ? (
            <span className="xp-state xp-state--on">
              <HubIcon name="check" size={12} strokeWidth={3} /> Equipped
            </span>
          ) : item.owned ? (
            <span className="xp-state">{item.price === 0 ? 'Free' : 'Owned'}</span>
          ) : isVoice ? (
            <span className={`xp-price ${affordable ? 'is-afford' : ''}`}>
              <HubIcon name="lock" size={12} strokeWidth={2.6} /> Locked · <CoinIcon size={14} /> {fmtNum(item.price)}
            </span>
          ) : (
            <span className={`xp-price ${affordable ? 'is-afford' : ''}`}>
              <CoinIcon size={14} /> {fmtNum(item.price)}
            </span>
          )}
        </span>
      </div>
      <div className="xp-item__act">{action}</div>
    </li>
  );
}

/** "Your look": the five equippable slots as a loadout, the selected (try-on) item swapped into its own slot. */
export function LookPanel({ equipped, selectedId, avatar, name, onBrowse, onClear }) {
  const slots = lookSlots(equipped, selectedId);
  const trying = slots.filter((x) => x.trying);
  const selItem = selectedId ? cosmeticById(selectedId) : null;
  return (
    <section className="hub-panel xp-look sa-look" aria-label="Your look">
      <h2 className="xp-look__h">Your look</h2>
      <ul className="xp-look__grid">
        {slots.map(({ kind: k, item, trying: swap }) => {
          const shine = item?.rarity === 'legendary';
          const label = SLOT[k].label;
          const what = item ? item.name : SLOT[k].none;
          let art;
          if (k === 'frame') art = <Ava preset={avatar} size={64} frame={item?.id} ring="var(--hub-surface-3)" />;
          else if (k === 'title') art = item ? <Title title={item.id} size="md" /> : <span className="hub-muted xp-look__none">No title</span>;
          else if (k === 'dice') art = <Dice skin={item?.id || 'dice-ivory'} size={46} shine={shine} />;
          else if (item) art = <Preview item={item} size={56} />;
          else art = <span className="xp-slot__empty" aria-hidden="true">{k === 'trail' ? 'None' : 'Classic'}</span>;
          return (
            <li key={k} className={`xp-slot xp-slot--${k} ${swap ? 'is-trying' : ''}`.trim()}>
              <button
                type="button"
                className={`xp-slot__btn ${shine ? 'xz-shiny' : ''}`.trim()}
                onClick={() => onBrowse(k)}
                aria-label={`${label}: ${what}${swap ? ' (trying on)' : ''}. Browse ${KIND_LABEL[k].toLowerCase()}`}
              >
                <span className="xp-slot__label">{label}</span>
                <span className="xp-slot__art" key={item?.id || 'none'}>
                  {art}
                </span>
                <span className="xp-slot__name">
                  {k === 'frame' && <b className="xp-look__name">{name}</b>}
                  <span className={k === 'frame' ? 'xp-slot__sub' : ''}>{what}</span>
                </span>
                {swap && <span className="xp-slot__try">Trying</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="xp-look__note" aria-live="polite">
        {selItem && trying.length ? (
          <>
            Previewing <b>{selItem.name}</b>.{' '}
            <button type="button" className="hh2-textlink xp-linkbtn" onClick={onClear}>
              Show my current look
            </button>
          </>
        ) : (
          'Tap an item to try it on. Tap a slot to browse it.'
        )}
      </p>
    </section>
  );
}

/** Rarity chips (with counts for the tab) and the sort select. */
export function RarityBar({ rarity, sort, counts, onRarity, onSort }) {
  return (
    <div className="xp-filterbar">
      <div className="xp-rarchips" role="group" aria-label="Rarity">
        {RARITY_FILTERS.map((r) => {
          const n = counts[r] ?? 0;
          const on = r === rarity;
          return (
            <button
              key={r}
              type="button"
              className={`xp-rarchip xp-rarchip--${r} ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              disabled={!on && n === 0}
              onClick={() => onRarity(r)}
            >
              {r === 'all' ? 'All' : RARITY[r]}
              <span className="xp-rarchip__n" aria-label={`${n} items`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>
      <label className="xp-sort">
        <span>Sort</span>
        <select value={sort} onChange={(e) => onSort(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ItemSkeletons({ n = 8 }) {
  return (
    <ul className="xp-items" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="xp-item sa-itemskel">
          <span className="st-skel sa-itemskel__art" />
          <span className="st-skel" style={{ height: 16, width: '70%' }} />
          <span className="st-skel" style={{ height: 14, width: '45%' }} />
          <span className="st-skel" style={{ height: 44, borderRadius: 12 }} />
        </li>
      ))}
    </ul>
  );
}

/** `/shop`: spend coins on cosmetics (avatar frames, dice skins, titles). Visual only, never a gameplay edge. */
export default function Shop() {
  const toast = useToast();
  const preview = useVoicePreview();
  const [params, setParams] = useSearchParams();
  const { user, signedIn, guest, auth } = useAccount();
  const [profile] = useProfile();
  const progress = useProgress();
  const daily = useDaily();
  const { booting, ready, retry } = useApiGate();
  const res = useApi('/api/shop', { enabled: ready && signedIn, fetcher: getShop });

  const kind = parseKind(params.get('kind'));
  const rarity = parseRarity(params.get('rarity'));
  const sort = parseSort(params.get('sort'));
  const go = useCallback((patch) => setParams(shopQuery({ kind, rarity, sort, ...patch }), { replace: true }), [setParams, kind, rarity, sort]);
  const pickKind = useCallback((k) => go({ kind: k }), [go]);
  const [view, setView] = useState('all');

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
    setCoins(Number.isFinite(Number(d.coins)) && d.coins !== null ? Number(d.coins) : null);
  }, [res.status, res.data]);
  useEffect(() => {
    if (res.status !== 'ok') setEquipped(cleanEquipped(user?.equipped));
  }, [user?.equipped, res.status]);

  const balance = signedIn ? (coins ?? (Number.isFinite(Number(user?.coins)) ? Number(user.coins) : progress.coins)) : null;
  const shownCoins = useCountUp(balance ?? 0);

  const items = useMemo(() => mergeItems(res.data?.items, owned), [res.data, owned]);
  const counts = useMemo(() => {
    const out = {};
    for (const k of COSMETIC_KINDS) {
      const of = items.filter((x) => x.kind === k);
      out[k] = { total: of.length, owned: of.filter((x) => x.owned).length };
    }
    return out;
  }, [items]);
  const { counts: rarityCounts, shown } = useMemo(() => shopList(items, { kind, view, rarity, sort, balance }), [items, kind, view, rarity, sort, balance]);
  const vault = useMemo(() => vaultItems(items), [items]);
  const vaultTotals = useMemo(() => vaultCount(items), [items]);
  const offline = !booting && (!ready || res.status === 'offline' || res.status === 'error');
  const loading = booting || (ready && signedIn && res.status === 'loading');

  const [sel, setSel] = useState(null);
  const avatar = signedIn && user?.avatar != null ? Number(user.avatar) : profile.avatar;
  const name = (signedIn && user?.name) || profile.name;

  const equipRef = useRef(null); // latest doEquip, for the "Equip now" toast button
  const [busyId, setBusyId] = useState(null);
  const [buyingId, setBuyingId] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [burst, setBurst] = useState(0); // bumps on a legendary purchase: remounts the one-shot gold burst
  const [dialog, setDialog] = useState(null); // { item, phase: 'confirm'|'poor'|'error', msg? }
  const close = () => setDialog(null);
  const lead = useMemo(featured, []);

  const openBuy = (item) => {
    if (item.kind !== 'voice') setSel(item.id);
    const short = Number.isFinite(balance) && balance < item.price;
    setDialog({ item, phase: short ? 'poor' : 'confirm' });
  };

  /** Optimistic: the card flips to "owned" and the balance drops at once; a failure puts both back. */
  const doBuy = async () => {
    const item = dialog?.item;
    if (!item || buyingId) return;
    const before = { owned, coins: balance };
    setBuyingId(item.id);
    setOwned((o) => new Set([...o, item.id]));
    if (Number.isFinite(balance)) setCoins(balance - item.price);
    setDialog(null);
    try {
      const r = await buyCosmetic(item.id);
      if (Array.isArray(r?.owned)) setOwned(new Set([...FREE_COSMETICS, ...r.owned]));
      if (Number.isFinite(Number(r?.coins))) setCoins(Number(r.coins));
      invalidateApi('/api/shop');
      setFresh(item.id);
      const legendary = item.rarity === 'legendary';
      celebrate({
        kind: 'purchase',
        title: legendary ? `Legendary: ${item.name}` : `${item.name} is yours`,
        text: item.kind === 'voice' ? 'Voice line unlocked. Open the soundboard at the table and tap it: everyone hears it.' : `New ${KIND_ONE[item.kind]} unlocked. Equip it to show it off at the table.`,
        icon: legendary ? 'star' : 'gift',
        ...(legendary ? { duration: 4200 } : null),
      });
      if (legendary) setBurst((n) => n + 1);
      if (EQUIPPABLE_KINDS.includes(item.kind)) {
        toast(`${item.name} is yours`, {
          tone: legendary ? 'gold' : 'success',
          icon: legendary ? 'sparkle' : undefined,
          duration: 6000,
          action: { label: 'Equip now', onClick: () => equipRef.current?.(item, true) },
        });
      }
      Promise.resolve(auth.refresh?.()).catch(() => {});
    } catch (e) {
      if (e?.status === 409) {
        setCoins(before.coins);
        toast(`You already own ${item.name}.`, { tone: 'info' });
        invalidateApi('/api/shop');
      } else {
        setOwned(before.owned);
        setCoins(before.coins);
        if (e?.status === 402) setDialog({ item, phase: 'poor' });
        else if (e?.status === 401) setDialog({ item, phase: 'error', msg: 'Your session ended. Sign in again to buy.' });
        else setDialog({ item, phase: 'error', msg: errorMessage(e, 'Could not complete the purchase. You were not charged.') });
      }
    } finally {
      setBuyingId(null);
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

  equipRef.current = doEquip;

  useEffect(() => {
    if (!burst) return undefined;
    const t = setTimeout(() => setBurst(0), 1800);
    return () => clearTimeout(t);
  }, [burst]);

  useEffect(() => {
    if (!fresh) return undefined;
    const t = setTimeout(() => setFresh(null), 1400);
    return () => clearTimeout(t);
  }, [fresh]);

  const cardProps = (item) => ({
    equipped,
    selected: sel === item.id,
    coins: balance,
    signedIn,
    offline,
    busy: busyId === item.id,
    buying: buyingId === item.id,
    fresh: fresh === item.id,
    avatar,
    preview: item.kind === 'voice' ? preview : null,
    onSelect: (id) => setSel((s) => (s === id ? null : id)),
    onBuy: openBuy,
    onEquip: doEquip,
  });

  const d = dialog;
  const after = d && Number.isFinite(balance) ? balance - d.item.price : null;
  const gap = d && Number.isFinite(balance) ? Math.max(0, d.item.price - balance) : null;

  return (
    <div className="hub-page hh2 xp-page xp-shop sa-shop st-scope">
      <header className="sa-shophead st-reveal">
        <p className="st-eyebrow sa-shophead__eyebrow">Cosmetics</p>
        <h1 className="sa-shophead__title">Shop</h1>
        <p className="sa-shophead__sub">Frames, dice, pawn trails, board themes, titles and voice lines to stand out at the table. Looks and sounds only, never an advantage.</p>
        {signedIn && (
          <div className="sa-shophead__bal" aria-label={`Balance: ${fmtNum(balance ?? 0)} coins`}>
            <span className="xp-balance">
              <CoinIcon size={22} />
              <b aria-hidden="true">{fmtNum(shownCoins)}</b>
            </span>
            <Link to={paths.hub()} className="st-link">
              {daily.canClaim ? `Claim +${fmtNum(daily.nextReward)} today` : 'How to earn coins'}
            </Link>
          </div>
        )}
      </header>

      {!signedIn && !booting && (
        <div className="hh2-banner sa-gate" role="note">
          <HubIcon name="lock" size={20} />
          <p>Browse everything now and try items on. Sign in to buy with the coins you win and to keep what you own.</p>
          <Link to={paths.login(paths.shop())} className="hub-btn hub-btn--primary hub-btn--sm">
            Sign in to buy
          </Link>
        </div>
      )}
      {guest && (
        <div className="hh2-banner sa-gate" role="note">
          <HubIcon name="info" size={20} />
          <p>You are a guest: items you buy stay with this browser. Sign in with Google to keep them on every device.</p>
          <Link to={paths.login(paths.shop())} className="hub-btn hub-btn--soft hub-btn--sm">
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

      <div className="sa-shop__layout">
        <LookPanel equipped={equipped} selectedId={sel} avatar={avatar} name={name} onBrowse={pickKind} onClear={() => setSel(null)} />

        <div className="sa-shop__main">
          <div className="sa-shop__bar">
            <KindTabs value={kind} onChange={pickKind} counts={signedIn ? counts : {}} />
            {signedIn && (
              <div className="sa-views" role="group" aria-label="Show">
                {VIEWS.map((v) => (
                  <button key={v.id} type="button" className={`sa-view ${view === v.id ? 'is-on' : ''}`} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <RarityBar rarity={rarity} sort={sort} counts={rarityCounts} onRarity={(r) => go({ rarity: r })} onSort={(v) => go({ sort: v })} />
          <section id={PANEL_ID} role="tabpanel" aria-labelledby={`xp-tab-${kind}`} aria-busy={loading} className="xp-shop__panel">
            {kind === 'voice' && (
              <p className="hub-muted vl-shopnote" role="note">
                {signedIn
                  ? 'Buy a line once with your coins, then tap it on the soundboard at any table: everyone hears it. Only you can play what you own.'
                  : 'Sign in to buy voice lines. Only the player who owns a line can play it at the table.'}
              </p>
            )}
            {!loading && vault.length > 0 && vaultVisible({ kind, view, rarity }) && (
              <section className="xz-vault" aria-labelledby="xz-vault-h">
                <header className="xz-vault__head">
                  <h2 id="xz-vault-h" className="xz-vault__title">
                    <HubIcon name="star" size={18} strokeWidth={2.4} /> Legendary vault
                  </h2>
                  <span className="xz-vault__count">{signedIn ? `${vaultTotals.owned} of ${vaultTotals.total} owned` : `${vaultTotals.total} legendary items`}</span>
                </header>
                <p className="xz-vault__sub">The rarest looks in the shop, across every category. Tap one to try it on.</p>
                <ul className="xp-items xz-vault__rail" tabIndex={0} aria-label="Legendary items, scroll sideways">
                  {vault.map((item, i) => (
                    <ItemCard key={item.id} item={item} i={i} {...cardProps(item)} />
                  ))}
                </ul>
              </section>
            )}
            {loading ? (
              <ItemSkeletons />
            ) : shown.length ? (
              <ul className="xp-items" key={`${kind}-${view}-${rarity}-${sort}`}>
                {shown.map((item, i) => (
                  <ItemCard key={item.id} item={item} i={i} {...cardProps(item)} />
                ))}
              </ul>
            ) : (
              <div className="hub-empty xp-empty">
                <p className="hub-empty__title">
                  {rarity !== 'all'
                    ? `No ${RARITY[rarity].toLowerCase()} ${KIND_LABEL[kind].toLowerCase()}${view === 'all' ? '' : view === 'owned' ? ' owned' : ' within reach'}`
                    : view === 'owned'
                      ? `You do not own any ${KIND_LABEL[kind].toLowerCase()} yet`
                      : `No ${KIND_LABEL[kind].toLowerCase()} within reach right now`}
                </p>
                <p className="hub-empty__text">
                  {rarity !== 'all' ? 'Try another rarity, or show everything.' : view === 'owned' ? 'Buy one and it shows up here, ready to equip.' : 'Earn a few more coins from the daily reward and finished matches.'}
                </p>
                <div className="hub-empty__actions">
                  <button
                    type="button"
                    className="hub-btn hub-btn--soft hub-btn--sm"
                    onClick={() => {
                      setView('all');
                      go({ rarity: 'all' });
                    }}
                  >
                    Show everything
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {burst > 0 && (
        <div className="xz-burst" key={burst} aria-hidden="true">
          <b className="xz-burst__ring" />
          {Array.from({ length: 14 }, (_, n) => (
            <i key={n} style={{ '--a': `${n * (360 / 14)}deg`, '--d': `${120 + (n % 3) * 34}px` }} />
          ))}
        </div>
      )}

      <Modal
        open={!!d}
        onClose={close}
        title={d ? (d.phase === 'poor' ? 'Not enough coins yet' : d.phase === 'error' ? 'Purchase failed' : `Buy ${d.item.name}?`) : ''}
        actions={
          d?.phase === 'poor' ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={close}>
                Close
              </button>
              <Link to={paths.hub()} className="btn btn--primary" onClick={close} data-autofocus>
                {daily.canClaim ? `Claim +${fmtNum(daily.nextReward)} coins` : 'Go to Home'}
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
              <button type="button" className="btn btn--ghost" onClick={close}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={doBuy} data-autofocus>
                {`Buy for ${fmtNum(d?.item.price ?? 0)}`}
              </button>
            </>
          )
        }
      >
        {d && (
          <div className="xp-buy sa-buy">
            <span className={`xp-buy__art ${d.item.rarity === 'legendary' ? 'xz-shiny' : ''}`.trim()}>
              {d.item.kind === 'voice' ? <VoiceArt item={d.item} size={88} /> : <Preview item={d.item} size={88} avatar={avatar} shine={d.item.rarity === 'legendary'} />}
            </span>
            {d.phase === 'poor' ? (
              <div className="sa-buy__body">
                <p>
                  <b>{d.item.name}</b> costs{' '}
                  <b className="xp-price">
                    <CoinIcon size={14} /> {fmtNum(d.item.price)}
                  </b>
                  {gap !== null && (
                    <>
                      . You are <b>{fmtNum(gap)}</b> short.
                    </>
                  )}
                </p>
                <ul className="sa-earn">
                  <li>
                    <HubIcon name="gift" size={16} />
                    <span>{daily.canClaim ? `Your daily reward is waiting: +${fmtNum(daily.nextReward)} coins.` : `Daily reward: +${fmtNum(daily.nextReward)} coins tomorrow, more as your streak grows.`}</span>
                  </li>
                  <li>
                    <HubIcon name="star" size={16} />
                    <span>
                      Finish matches and win for coins.
                      {lead && (
                        <>
                          {' '}
                          <Link to={paths.game(lead.id)} className="hh2-textlink" onClick={close}>
                            Play {lead.name}
                          </Link>
                        </>
                      )}
                    </span>
                  </li>
                </ul>
              </div>
            ) : d.phase === 'error' ? (
              <p>{d.msg}</p>
            ) : (
              <div className="sa-buy__body">
                <p>
                  <span className={`xp-rarity xp-rarity--${d.item.rarity}`}>{RARITY[d.item.rarity] || d.item.rarity}</span> {d.item.kind === 'voice' ? 'voice line. Plays for everyone at the table when you tap it. Sound only.' : `${KIND_ONE[d.item.kind]}. Cosmetic only.`}
                </p>
                <dl className="sa-ledger">
                  <div>
                    <dt>Balance</dt>
                    <dd>
                      <CoinIcon size={14} /> {fmtNum(balance ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>
                      <CoinIcon size={14} /> {'−'}
                      {fmtNum(d.item.price)}
                    </dd>
                  </div>
                  {after !== null && (
                    <div className="is-total">
                      <dt>Balance after</dt>
                      <dd>
                        <CoinIcon size={14} /> {fmtNum(after)}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

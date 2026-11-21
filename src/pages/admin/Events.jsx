import { useState } from 'react';
import { errorMessage } from '@/lib/api.js';
import { EVENT_KINDS, LIMITS, MULTIPLIERS, createEvent, deleteEvent, listEvents, updateEvent } from '@/lib/adminApi.js';
import { Preview } from '@/platform/home/Ava.jsx';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useToasts } from '@/components/online/Toasts.jsx';
import ConfirmAction from '@/components/admin/ConfirmAction.jsx';
import { useAdmin, useLoad, useNow } from '@/components/admin/hooks.js';
import { EVENT_KIND_LABEL, KIND_WORD, fmtDateTime, fmtNum, fromLocalInput, itemName, multiplierText } from '@/components/admin/model.js';
import {
  EVENT_STATUS,
  durationText,
  emptyEventForm,
  eventBody,
  eventEffectShort,
  eventErrors,
  eventItems,
  eventStatus,
  eventToForm,
  serverField,
  windowHint,
} from '@/components/admin/engagementModel.js';
import { cosmeticById } from '@shared/cosmetics.js';
import { AdmIcon, Badge, Card, Empty, ErrorState, Field, Loading, PageHead, ReadOnlyNote, RefreshButton, StatTile } from '@/components/admin/ui.jsx';

const len = (s) => [...String(s ?? '')].length;
const KIND_ICON = { coin_boost: 'bolt', limited_shop: 'gift' };
const KIND_HINT = { coin_boost: 'Multiplies the coins every finished match pays.', limited_shop: 'Puts limited event cosmetics on sale in the shop.' };

/** A limited cosmetic with its shop art. */
function ItemArt({ id, size = 28 }) {
  const item = cosmeticById(id);
  return (
    <span className="adm-itemart" data-rarity={item?.rarity} style={{ width: size + 8, height: size + 8 }} aria-hidden="true">
      {item ? <Preview item={item} size={size} /> : <AdmIcon name="gift" size={Math.round(size * 0.7)} />}
    </span>
  );
}

/** The limited-item picker: toggle cards of `source: 'event'` cosmetics. */
function ItemPicker({ value, onChange, error }) {
  const items = eventItems();
  const on = new Set(value);
  const toggle = (id) => onChange(on.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className={`adm-seg-field${error ? ' is-bad' : ''}`}>
      <legend className="adm-label">Limited items</legend>
      {items.length ? (
        <ul className="adm-itempick">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className={`adm-itempick__btn${on.has(c.id) ? ' is-on' : ''}`} aria-pressed={on.has(c.id)} onClick={() => toggle(c.id)}>
                <ItemArt id={c.id} size={40} />
                <span className="adm-itempick__text">
                  <b>{c.name}</b>
                  <span className="adm-faint">
                    {`${c.rarity} ${KIND_WORD[c.kind] || c.kind} · ${fmtNum(c.price)} coins`}
                  </span>
                </span>
                <span className="adm-itempick__tick" aria-hidden="true">
                  <AdmIcon name={on.has(c.id) ? 'check' : 'plus'} size={14} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="adm-faint adm-form__note">No limited event cosmetics in the catalogue yet.</p>
      )}
      {error ? <span className="adm-error">{error}</span> : <span className="adm-hint">{`${value.length} picked · sold only while the event is live`}</span>}
    </fieldset>
  );
}

/** Create / edit form (admins only). Server 400s land on the field they are about. */
export function EventForm({ editing, onSaved, onCancel, push, now = Date.now() }) {
  const [f, setF] = useState(() => (editing ? eventToForm(editing) : emptyEventForm(now)));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(null); // { field, message }
  const errs = eventErrors(f);
  const put = (patch) => {
    setServer(null);
    setF((x) => ({ ...x, ...patch }));
  };
  const set = (k) => (e) => put({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const show = (k, touched = true) => (tried || touched ? errs[k] : '') || (server?.field === k ? server.message : '');
  const s = fromLocalInput(f.startsAt);
  const en = fromLocalInput(f.endsAt);
  const lasts = s && en && !errs.endsAt ? `Lasts ${durationText(new Date(en) - new Date(s))} (at most ${LIMITS.eventMaxDays} days)` : `At most ${LIMITS.eventMaxDays} days`;

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (editing) await updateEvent(editing.id, eventBody(f, { patch: true }));
      else await createEvent(eventBody(f));
      push(editing ? `${f.name.trim()} saved.` : `${f.name.trim()} created.`, 'good');
      onSaved();
    } catch (err) {
      if (err?.status === 400) setServer({ field: serverField(err.message), message: errorMessage(err) });
      else push(errorMessage(err, 'Could not save the event.'), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={editing ? 'Edit event' : 'New event'}
      className="adm-evtform"
      actions={
        editing ? (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onCancel}>
            Cancel edit
          </button>
        ) : null
      }
    >
      <form className="adm-form adm-form--wide" onSubmit={submit} noValidate>
        <fieldset className="adm-seg-field">
          <legend className="adm-label">Kind</legend>
          <div className="adm-seg">
            {EVENT_KINDS.map((k) => (
              <label key={k} className={`adm-seg__btn${f.kind === k ? ' is-on' : ''}`}>
                <input type="radio" name="event-kind" value={k} checked={f.kind === k} onChange={() => put({ kind: k })} className="adm-sr" />
                <AdmIcon name={KIND_ICON[k]} size={14} /> {EVENT_KIND_LABEL[k]}
              </label>
            ))}
          </div>
          <span className="adm-hint">{KIND_HINT[f.kind]}</span>
          {show('kind') ? <span className="adm-error">{show('kind')}</span> : null}
        </fieldset>
        <Field label="Name" error={show('name', f.name !== '')} count={len(f.name.trim())} max={LIMITS.eventNameMax}>
          <input className="adm-input" value={f.name} onChange={set('name')} placeholder="Double coins weekend" autoComplete="off" />
        </Field>
        <Field label="Description (optional)" hint="Shown on the hub banner and the shop" error={show('description', f.description !== '')} count={len(f.description.trim())} max={LIMITS.eventDescriptionMax}>
          <textarea className="adm-input adm-textarea" rows={2} value={f.description} onChange={set('description')} placeholder="Every finished match pays double till Sunday night." />
        </Field>
        {f.kind === 'coin_boost' ? (
          <fieldset className="adm-seg-field">
            <legend className="adm-label">Multiplier</legend>
            <div className="adm-seg adm-seg--big">
              {MULTIPLIERS.map((m) => (
                <label key={m} className={`adm-seg__btn${Number(f.multiplier) === m ? ' is-on' : ''}`}>
                  <input type="radio" name="event-mult" value={m} checked={Number(f.multiplier) === m} onChange={() => put({ multiplier: m })} className="adm-sr" />
                  {`×${m}`}
                </label>
              ))}
            </div>
            {show('multiplier') ? (
              <span className="adm-error">{show('multiplier')}</span>
            ) : (
              <span className="adm-hint">{`Match coins only (not XP or the daily reward). A 200-coin win pays ${fmtNum(Math.round(200 * Number(f.multiplier)))}. If boosts overlap, the highest wins.`}</span>
            )}
          </fieldset>
        ) : (
          <ItemPicker value={f.itemIds} onChange={(itemIds) => put({ itemIds })} error={show('items', f.itemIds.length > 0)} />
        )}
        <div className="adm-grid2">
          <Field label="Starts" error={show('startsAt')}>
            <input className="adm-input" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />
          </Field>
          <Field label="Ends" hint={lasts} error={show('endsAt')}>
            <input className="adm-input" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
          </Field>
        </div>
        <label className="adm-switch">
          <input type="checkbox" role="switch" checked={f.active} onChange={set('active')} />
          <span className="adm-switch__track" aria-hidden="true" />
          Active
          <span className="adm-faint adm-switch__note">{f.active ? 'runs inside its window' : 'off: never live until switched on'}</span>
        </label>
        {server?.field === 'form' || server?.field === 'tiers' ? (
          <p className="adm-formerror" role="alert">
            <AdmIcon name="info" size={15} /> {server.message}
          </p>
        ) : null}
        <div className="adm-form__row">
          <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/** The events list. Pure. `canEdit` shows the edit / delete buttons. */
export function EventList({ events, now = Date.now(), canEdit = false, onEdit, onDelete, editingId }) {
  return (
    <ul className="adm-evts">
      {events.map((e) => {
        const st = eventStatus(e, now);
        const [tone, label] = EVENT_STATUS[st];
        const ids = e.kind === 'limited_shop' ? e.config?.itemIds || [] : [];
        return (
          <li key={e.id} className={`adm-evt adm-evt--${st}${editingId === e.id ? ' is-editing' : ''}`}>
            <span className={`adm-evt__icon adm-evt__icon--${e.kind}`} aria-hidden="true">
              <AdmIcon name={KIND_ICON[e.kind] || 'sparkle'} size={18} />
            </span>
            <div className="adm-evt__main">
              <div className="adm-evt__line">
                <b className="adm-evt__name">{e.name}</b>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <div className="adm-evt__meta">
                <span className="adm-evt__kind">{EVENT_KIND_LABEL[e.kind] || e.kind}</span>
                <span className={`adm-evt__effect${e.kind === 'coin_boost' ? ' is-boost' : ''}`}>{e.kind === 'coin_boost' ? multiplierText(e.config?.multiplier ?? 1) : eventEffectShort(e)}</span>
                <span className="adm-faint">
                  <time dateTime={e.startsAt}>{fmtDateTime(e.startsAt)}</time> → <time dateTime={e.endsAt}>{fmtDateTime(e.endsAt)}</time>
                </span>
                <span className="adm-faint">{st === 'off' ? 'switched off' : windowHint(e.startsAt, e.endsAt, now)}</span>
              </div>
              {e.description ? <p className="adm-evt__desc">{e.description}</p> : null}
              {ids.length ? (
                <ul className="adm-evt__items" aria-label="Limited items">
                  {ids.map((id) => (
                    <li key={id} className="adm-evt__item">
                      <ItemArt id={id} size={22} />
                      {itemName(id)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {canEdit ? (
              <span className="adm-evt__btns">
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onEdit(e)} aria-label={`Edit ${e.name}`}>
                  <AdmIcon name="pencil" size={14} /> Edit
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--warn" onClick={() => onDelete(e)} aria-label={`Delete ${e.name}`}>
                  <AdmIcon name="trash" size={14} /> Delete
                </button>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** /admin/events (reads: staff; create / edit / delete: admin) */
export default function Events({ initial }) {
  useDocTitle('Events · Admin · Jalebi Games');
  const { adminWrite } = useAdmin();
  const { push, node } = useToasts();
  const now = useNow();
  const { data, error, loading, reload } = useLoad(({ signal }) => listEvents({ signal }), [], { initial });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(0); // bumps to reset the new-event form after a create
  const list = data?.events || [];
  const live = list.filter((e) => eventStatus(e, now) === 'live');
  const scheduled = list.filter((e) => eventStatus(e, now) === 'scheduled').length;
  const boost = Math.max(1, ...live.filter((e) => e.kind === 'coin_boost').map((e) => Number(e.config?.multiplier) || 1));
  const onSale = new Set(live.filter((e) => e.kind === 'limited_shop').flatMap((e) => e.config?.itemIds || [])).size;

  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteEvent(deleting.id);
      push(`${deleting.name} deleted.`, 'good');
      if (editing?.id === deleting.id) setEditing(null);
      setDeleting(null);
      reload();
    } catch (err) {
      push(errorMessage(err, 'Could not delete it.'), 'bad');
      setDeleting(null);
      if (err?.status === 404) reload();
    } finally {
      setBusy(false);
    }
  };

  const listCard = (
    <Card title="All events" meta={data ? `${list.length} · ${live.length} live` : undefined} flush>
      {error && !data ? (
        <ErrorState error={error} onRetry={reload} what="events" />
      ) : !data ? (
        <Loading label="Loading events" rows={4} />
      ) : list.length ? (
        <EventList events={list} now={now} canEdit={adminWrite} onEdit={setEditing} onDelete={setDeleting} editingId={editing?.id} />
      ) : (
        <Empty icon="sparkle" title="No events yet">
          {adminWrite ? 'Create a coin boost or a limited shop with the form.' : 'An admin can create coin boosts and limited shops here.'}
        </Empty>
      )}
    </Card>
  );

  return (
    <div className="adm-page">
      <PageHead title="Events" lead="Time-boxed switches. A coin boost multiplies match coins; a limited shop puts event cosmetics on sale while it is live.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      {data ? (
        <div className="adm-tiles adm-tiles--sm" role="group" aria-label="Events now">
          <StatTile label="Live now" value={fmtNum(live.length)} tone={live.length ? 'orange' : undefined} icon="sparkle" />
          <StatTile label="Coin multiplier" value={`×${boost}`} sub={boost > 1 ? 'on every finished match' : 'no boost running'} tone={boost > 1 ? 'gold' : undefined} />
          <StatTile label="Limited items on sale" value={fmtNum(onSale)} />
          <StatTile label="Scheduled" value={fmtNum(scheduled)} />
        </div>
      ) : null}
      {adminWrite ? (
        <div className="adm-annlayout">
          <EventForm
            key={editing?.id || `new-${fresh}`}
            editing={editing}
            push={push}
            now={now}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setFresh((n) => n + 1);
              reload();
            }}
          />
          {listCard}
        </div>
      ) : (
        <>
          <ReadOnlyNote>Read only. Creating, editing and deleting events is admin only, because a boost changes what every match pays.</ReadOnlyNote>
          {listCard}
        </>
      )}
      <ConfirmAction
        open={!!deleting}
        title={deleting ? `Delete ${deleting.name}?` : ''}
        body={
          deleting
            ? eventStatus(deleting, now) === 'live'
              ? `It is live now: ${deleting.kind === 'coin_boost' ? 'the boost stops' : 'the limited items go off sale'} at once for everyone. To pause it instead, switch it off.`
              : 'It is removed for good. To pause it instead, switch it off.'
            : ''
        }
        confirmLabel="Delete event"
        danger
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
      {node}
    </div>
  );
}

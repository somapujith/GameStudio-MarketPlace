import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/lib/api.js';
import { LIMITS, createSeason, listSeasons, updateSeason } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useToasts } from '@/components/online/Toasts.jsx';
import { useAdmin, useLoad, useNow } from '@/components/admin/hooks.js';
import { fmtDateTime, fmtNum, relTime, tierSummary } from '@/components/admin/model.js';
import {
  SEASON_STATUS,
  emptySeasonForm,
  nextTier,
  payoutState,
  prizeItemGroups,
  rowsToTiers,
  seasonBody,
  seasonErrors,
  seasonStatus,
  seasonToForm,
  serverField,
  tierErrors,
  windowHint,
} from '@/components/admin/engagementModel.js';
import { AdmIcon, Badge, Card, Empty, ErrorState, Field, Loading, PageHead, ReadOnlyNote, RefreshButton } from '@/components/admin/ui.jsx';

const len = (s) => [...String(s ?? '')].length;
const digits = (v) => String(v).replace(/[^\d]/g, '');

/**
 * The prize-tier editor: rows of fromRank–toRank, coins and an item. `check` is `tierErrors(rows)`; `show` turns the
 * row errors on (after a submit try, or once a row was edited). Pure apart from the callbacks.
 */
export function TierEditor({ rows, onChange, check, show = false, serverError = '' }) {
  const groups = prizeItemGroups();
  const setRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const summary = tierSummary(rowsToTiers(rows));
  const listError = (show && check.list) || serverError;
  return (
    <fieldset className="adm-tiers">
      <legend className="adm-label">Prize tiers</legend>
      {rows.length ? (
        <ol className="adm-tiers__list">
          {rows.map((r, i) => {
            const e = check.rows[i] || {};
            const msgs = show ? [...new Set([e.ranks, e.overlap, e.coins, e.item, e.empty].filter(Boolean))] : [];
            const bad = (k) => (show && e[k] ? true : undefined);
            return (
              <li key={i} className={`adm-tier${msgs.length ? ' is-bad' : ''}`}>
                <span className="adm-tier__n" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="adm-tier__fields">
                  <label className="adm-tier__f adm-tier__f--rank">
                    <span className="adm-label">From rank</span>
                    <input className="adm-input" inputMode="numeric" value={r.fromRank} onChange={(ev) => setRow(i, { fromRank: digits(ev.target.value) })} aria-invalid={bad('ranks') || bad('overlap')} placeholder="1" />
                  </label>
                  <label className="adm-tier__f adm-tier__f--rank">
                    <span className="adm-label">To rank</span>
                    <input className="adm-input" inputMode="numeric" value={r.toRank} onChange={(ev) => setRow(i, { toRank: digits(ev.target.value) })} aria-invalid={bad('ranks') || bad('overlap')} placeholder="1" />
                  </label>
                  <label className="adm-tier__f adm-tier__f--coins">
                    <span className="adm-label">Coins each</span>
                    <input className="adm-input" inputMode="numeric" value={r.coins} onChange={(ev) => setRow(i, { coins: digits(ev.target.value) })} aria-invalid={bad('coins') || bad('empty')} placeholder="none" />
                  </label>
                  <label className="adm-tier__f adm-tier__f--item">
                    <span className="adm-label">Item</span>
                    <select className="adm-input adm-select" value={r.itemId} onChange={(ev) => setRow(i, { itemId: ev.target.value })} aria-invalid={bad('item') || bad('empty')}>
                      <option value="">No item</option>
                      {groups.map((g) => (
                        <optgroup key={g.kind} label={g.label}>
                          {g.items.map((c) => (
                            <option key={c.id} value={c.id}>
                              {`${c.name} · ${c.kind}`}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" className="adm-iconbtn adm-tier__x" onClick={() => remove(i)} aria-label={`Remove tier ${i + 1}`}>
                  <AdmIcon name="trash" size={15} />
                </button>
                {msgs.length ? (
                  <span className="adm-error adm-tier__err" role="alert">
                    {msgs.join(' ')}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="adm-faint adm-form__note">No prizes: the season still ranks players, and the payout freezes the table.</p>
      )}
      <div className="adm-tiers__foot">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onChange([...rows, nextTier(rows)])} disabled={rows.length >= LIMITS.tiersMax}>
          <AdmIcon name="plus" size={14} /> Add tier
        </button>
        <span className="adm-hint">{`${rows.length}/${LIMITS.tiersMax} tiers · ranks 1–${fmtNum(LIMITS.rankMax)} · up to ${fmtNum(LIMITS.prizeCoinsMax)} coins each`}</span>
      </div>
      {listError ? (
        <p className="adm-formerror" role="alert">
          <AdmIcon name="info" size={15} /> {listError}
        </p>
      ) : null}
      <div className="adm-tiersum" aria-live="polite">
        <span className="adm-label">Summary</span>
        {summary.length ? (
          <ul className="adm-tiersum__list">
            {summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="adm-faint adm-form__note">No valid tiers yet.</p>
        )}
      </div>
    </fieldset>
  );
}

/** Create / edit a season (admins only; never after the payout). */
export function SeasonForm({ editing, onSaved, onCancel, push, now = Date.now() }) {
  const [f, setF] = useState(() => (editing ? seasonToForm(editing) : emptySeasonForm(now)));
  const [tried, setTried] = useState(false);
  const [touchedTiers, setTouchedTiers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(null);
  const errs = seasonErrors(f);
  const check = tierErrors(f.tiers);
  const put = (patch) => {
    setServer(null);
    setF((x) => ({ ...x, ...patch }));
  };
  const set = (k) => (e) => put({ [k]: e.target.value });
  const show = (k, touched = true) => (tried || touched ? errs[k] : '') || (server?.field === k ? server.message : '');

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errs).length || !check.ok) return;
    setBusy(true);
    try {
      if (editing) await updateSeason(editing.id, seasonBody(f));
      else await createSeason(seasonBody(f));
      push(editing ? `${f.name.trim()} saved.` : `${f.name.trim()} created.`, 'good');
      onSaved();
    } catch (err) {
      if (err?.status === 400) setServer({ field: serverField(err.message), message: errorMessage(err) });
      else {
        push(errorMessage(err, 'Could not save the season.'), 'bad');
        if (err?.status === 409 || err?.status === 404) onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={editing ? `Edit ${editing.name}` : 'New season'}
      className="adm-seasonform"
      actions={
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onCancel}>
          {editing ? 'Cancel edit' : 'Close'}
        </button>
      }
    >
      <form className="adm-form adm-form--wide" onSubmit={submit} noValidate>
        <div className="adm-seasonform__top">
          <Field label="Name" error={show('name', f.name !== '')} count={len(f.name.trim())} max={LIMITS.seasonNameMax}>
            <input className="adm-input" value={f.name} onChange={set('name')} placeholder="Diwali Season 2026" autoComplete="off" />
          </Field>
          <Field label="Starts" error={show('startsAt')}>
            <input className="adm-input" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />
          </Field>
          <Field label="Ends" hint="Matches ended inside the window count" error={show('endsAt')}>
            <input className="adm-input" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
          </Field>
        </div>
        <p className="adm-hint adm-form__note">Points = 3 per win + 1 per finished match. Ties go to more wins, then the earlier last match. Guests and banned players are not ranked.</p>
        <TierEditor
          rows={f.tiers}
          check={check}
          show={tried || touchedTiers}
          serverError={server?.field === 'tiers' ? server.message : ''}
          onChange={(tiers) => {
            setTouchedTiers(true);
            put({ tiers });
          }}
        />
        {server?.field === 'form' ? (
          <p className="adm-formerror" role="alert">
            <AdmIcon name="info" size={15} /> {server.message}
          </p>
        ) : null}
        <div className="adm-form__row">
          <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create season'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/** The seasons table. Pure. */
export function SeasonsTable({ seasons, now = Date.now(), canEdit = false, onEdit }) {
  return (
    <div className="adm-tablewrap">
      <table className="adm-table adm-table--cards adm-table--seasons">
        <caption className="adm-sr">Seasons</caption>
        <thead>
          <tr>
            <th scope="col">Season</th>
            <th scope="col">Window</th>
            <th scope="col">Status</th>
            <th scope="col">Prizes</th>
            <th scope="col">Payout</th>
            <th scope="col">
              <span className="adm-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => {
            const st = seasonStatus(s, now);
            const [tone, label] = SEASON_STATUS[st];
            const pay = payoutState(s, now);
            const lines = tierSummary(s.prizeTiers);
            return (
              <tr key={s.id}>
                <td data-label="Season" className="adm-td-wide">
                  <span className="adm-season__name">
                    <Link to={paths.admin(`seasons/${s.id}`)}>{s.name}</Link>
                    <span className="adm-faint">{`created ${relTime(s.createdAt, now)}`}</span>
                  </span>
                </td>
                <td data-label="Window">
                  <span className="adm-season__window">
                    <span>
                      <time dateTime={s.startsAt}>{fmtDateTime(s.startsAt)}</time> → <time dateTime={s.endsAt}>{fmtDateTime(s.endsAt)}</time>
                    </span>
                    {st !== 'paid' ? <span className="adm-faint">{windowHint(s.startsAt, s.endsAt, now)}</span> : null}
                  </span>
                </td>
                <td data-label="Status">
                  <Badge tone={tone}>{label}</Badge>
                </td>
                <td data-label="Prizes" className="adm-td-prizes">
                  {lines.length ? (
                    <span className="adm-season__prizes" title={lines.join('\n')}>
                      <span>{lines[0]}</span>
                      {lines.length > 1 ? <span className="adm-faint">{`+${lines.length - 1} more ${lines.length === 2 ? 'tier' : 'tiers'}`}</span> : null}
                    </span>
                  ) : (
                    <span className="adm-faint">no prizes</span>
                  )}
                </td>
                <td data-label="Payout">
                  <Badge tone={pay.tone}>{pay.text}</Badge>
                </td>
                <td className="is-act">
                  <span className="adm-season__btns">
                    <Link className="adm-btn adm-btn--ghost adm-btn--sm" to={paths.admin(`seasons/${s.id}`)}>
                      Standings <AdmIcon name="chevR" size={14} />
                    </Link>
                    {canEdit && st !== 'paid' ? (
                      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onEdit(s)} aria-label={`Edit ${s.name}`}>
                        <AdmIcon name="pencil" size={14} /> Edit
                      </button>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** /admin/seasons (reads: staff; create / edit: admin) */
export default function Seasons({ initial }) {
  useDocTitle('Seasons · Admin · Jalebi Games');
  const { adminWrite } = useAdmin();
  const { push, node } = useToasts();
  const now = useNow();
  const { data, error, loading, reload } = useLoad(({ signal }) => listSeasons({ signal }), [], { initial });
  const [form, setForm] = useState(null); // null | { season|null }
  const list = data?.seasons || [];
  const unpaid = list.filter((s) => seasonStatus(s, now) === 'ended').length;
  const current = list.find((s) => seasonStatus(s, now) === 'active');

  const open = (season = null) => {
    setForm({ season });
    if (typeof window !== 'undefined') window.requestAnimationFrame?.(() => document.getElementById('adm-season-form')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  return (
    <div className="adm-page">
      <PageHead title="Seasons" lead="A points race over the matches ended inside each window, with prize tiers an admin pays out once it ends.">
        <RefreshButton onClick={reload} busy={loading} />
        {adminWrite ? (
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => open(null)} disabled={!!form && !form.season}>
            <AdmIcon name="plus" size={16} /> New season
          </button>
        ) : null}
      </PageHead>
      {!adminWrite ? <ReadOnlyNote>Read only. Creating and editing seasons and paying out prizes is admin only.</ReadOnlyNote> : null}
      {unpaid ? (
        <p className="adm-warnline" role="note">
          <AdmIcon name="bolt" size={16} />
          {`${unpaid} ${unpaid === 1 ? 'season has' : 'seasons have'} ended and ${unpaid === 1 ? 'is' : 'are'} waiting for the payout. Open the standings to pay out.`}
        </p>
      ) : null}
      {adminWrite && form ? (
        <div id="adm-season-form">
          <SeasonForm
            key={form.season?.id || 'new'}
            editing={form.season}
            push={push}
            now={now}
            onCancel={() => setForm(null)}
            onSaved={() => {
              setForm(null);
              reload();
            }}
          />
        </div>
      ) : null}
      <Card title="All seasons" meta={data ? `${list.length}${current ? ` · live: ${current.name}` : ''}` : undefined} flush>
        {error && !data ? (
          <ErrorState error={error} onRetry={reload} what="seasons" />
        ) : !data ? (
          <Loading label="Loading seasons" rows={4} />
        ) : list.length ? (
          <div className={loading ? 'adm-stale' : undefined}>
            <SeasonsTable seasons={list} now={now} canEdit={adminWrite} onEdit={(s) => open(s)} />
          </div>
        ) : (
          <Empty icon="trophy" title="No seasons yet">
            {adminWrite ? 'Start one with “New season”. The leaderboard gets a Season tab while it runs.' : 'An admin can start a season here.'}
          </Empty>
        )}
      </Card>
      {node}
    </div>
  );
}

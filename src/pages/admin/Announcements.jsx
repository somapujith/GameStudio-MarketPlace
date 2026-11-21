import { useState } from 'react';
import { errorMessage } from '@/lib/api.js';
import { LIMITS, TONES, createAnnouncement, deleteAnnouncement, linkUrlError, listAnnouncements, maxLenError, updateAnnouncement } from '@/lib/adminApi.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useToasts } from '@/components/online/Toasts.jsx';
import ConfirmAction from '@/components/admin/ConfirmAction.jsx';
import { useLoad, useNow } from '@/components/admin/hooks.js';
import { announcementStatus, fmtDateTime, fromLocalInput, relTime, toLocalInput } from '@/components/admin/model.js';
import { AdmIcon, Badge, Card, Empty, ErrorState, Field, Loading, PageHead, RefreshButton } from '@/components/admin/ui.jsx';

const len = (s) => [...String(s ?? '')].length;
const TONE_LABEL = { info: 'Info', event: 'Event', warning: 'Warning' };
const TONE_ICON = { info: 'info', event: 'sparkle', warning: 'bolt' };
const STATUS = { live: ['good', 'Live'], scheduled: ['info', 'Scheduled'], ended: ['plain', 'Ended'], off: ['plain', 'Off'] };

/** How the hub's announcement bar shows it (an approximation of the player-facing bar). */
export function BannerPreview({ message, tone = 'info', linkUrl, linkLabel }) {
  const t = TONES.includes(tone) ? tone : 'info';
  return (
    <div className={`adm-banner adm-banner--${t}`}>
      <AdmIcon name={TONE_ICON[t]} size={16} />
      <span className="adm-banner__msg">{message || <span className="adm-banner__ph">Your message appears here</span>}</span>
      {linkUrl ? <span className="adm-banner__link">{linkLabel || 'Learn more'} →</span> : null}
    </div>
  );
}

const EMPTY = { message: '', tone: 'info', linkUrl: '', linkLabel: '', startsAt: '', endsAt: '', active: true };

const toForm = (a) => ({
  message: a.message || '',
  tone: a.tone || 'info',
  linkUrl: a.linkUrl || '',
  linkLabel: a.linkLabel || '',
  startsAt: toLocalInput(a.startsAt),
  endsAt: toLocalInput(a.endsAt),
  active: !!a.active,
});

/** Contract checks for the form; returns { field: message }. */
export function announcementErrors(f) {
  const e = {};
  const m = maxLenError(f.message, LIMITS.announceMax, { required: true, label: 'A message' });
  if (m) e.message = m;
  const u = linkUrlError(f.linkUrl);
  if (u) e.linkUrl = u;
  const l = maxLenError(f.linkLabel, LIMITS.linkLabelMax);
  if (l) e.linkLabel = l;
  if (f.linkLabel.trim() && !f.linkUrl.trim()) e.linkUrl = 'Add a link for this label.';
  const s = fromLocalInput(f.startsAt);
  const en = fromLocalInput(f.endsAt);
  if (f.startsAt && !s) e.startsAt = 'Not a valid date.';
  if (f.endsAt && !en) e.endsAt = 'Not a valid date.';
  if (s && en && new Date(en) <= new Date(s)) e.endsAt = 'Must end after it starts.';
  return e;
}

/** Form -> request body. POST omits empty fields; PATCH sends null to clear them. */
export function announcementBody(f, { patch = false } = {}) {
  const body = { message: f.message.trim(), tone: f.tone, active: !!f.active };
  const opt = (k, v) => {
    if (v) body[k] = v;
    else if (patch) body[k] = null;
  };
  opt('linkUrl', f.linkUrl.trim());
  opt('linkLabel', f.linkLabel.trim());
  const s = fromLocalInput(f.startsAt);
  if (s) body.startsAt = s;
  opt('endsAt', fromLocalInput(f.endsAt));
  return body;
}

function AnnouncementForm({ editing, onSaved, onCancel, push }) {
  const [f, setF] = useState(() => (editing ? toForm(editing) : EMPTY));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const errs = announcementErrors(f);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const show = (k) => (tried || f[k] ? errs[k] : '');

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (editing) await updateAnnouncement(editing.id, announcementBody(f, { patch: true }));
      else await createAnnouncement(announcementBody(f));
      push(editing ? 'Announcement updated.' : 'Announcement published.', 'good');
      setF(EMPTY);
      setTried(false);
      onSaved();
    } catch (err) {
      push(errorMessage(err, 'Could not save it.'), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={editing ? 'Edit announcement' : 'New announcement'} className="adm-annform" actions={editing ? <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onCancel}>Cancel edit</button> : null}>
      <form className="adm-form adm-form--wide" onSubmit={submit} noValidate>
        <div className="adm-annform__preview">
          <span className="adm-label">Live preview</span>
          <BannerPreview message={f.message.trim()} tone={f.tone} linkUrl={f.linkUrl.trim()} linkLabel={f.linkLabel.trim()} />
        </div>
        <Field label="Message" error={show('message')} count={len(f.message.trim())} max={LIMITS.announceMax}>
          <textarea className="adm-input adm-textarea" rows={2} value={f.message} onChange={set('message')} placeholder="Diwali week: double coins on every win!" />
        </Field>
        <fieldset className="adm-seg-field">
          <legend className="adm-label">Tone</legend>
          <div className="adm-seg">
            {TONES.map((t) => (
              <label key={t} className={`adm-seg__btn adm-seg__btn--${t}${f.tone === t ? ' is-on' : ''}`}>
                <input type="radio" name="tone" value={t} checked={f.tone === t} onChange={set('tone')} className="adm-sr" />
                {TONE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="adm-grid2">
          <Field label="Link (optional)" hint="A path like /shop, or an https:// link" error={show('linkUrl')}>
            <input className="adm-input" value={f.linkUrl} onChange={set('linkUrl')} placeholder="/shop" autoComplete="off" spellCheck={false} inputMode="url" />
          </Field>
          <Field label="Link label" error={show('linkLabel')} count={len(f.linkLabel.trim())} max={LIMITS.linkLabelMax}>
            <input className="adm-input" value={f.linkLabel} onChange={set('linkLabel')} placeholder="Open the shop" autoComplete="off" />
          </Field>
          <Field label="Starts" hint="Empty = now" error={show('startsAt')}>
            <input className="adm-input" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />
          </Field>
          <Field label="Ends" hint="Empty = until switched off" error={show('endsAt')}>
            <input className="adm-input" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
          </Field>
        </div>
        <label className="adm-switch">
          <input type="checkbox" role="switch" checked={f.active} onChange={set('active')} />
          <span className="adm-switch__track" aria-hidden="true" />
          Active
        </label>
        <div className="adm-form__row">
          <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Publish'}
          </button>
        </div>
      </form>
    </Card>
  );
}

/** The announcements list. Pure. */
export function AnnouncementList({ announcements, now = Date.now(), onEdit, onDelete, editingId }) {
  return (
    <ul className="adm-anns">
      {announcements.map((a) => {
        const st = announcementStatus(a, now);
        const [tone, label] = STATUS[st];
        return (
          <li key={a.id} className={`adm-ann${editingId === a.id ? ' is-editing' : ''}`}>
            <BannerPreview message={a.message} tone={a.tone} linkUrl={a.linkUrl} linkLabel={a.linkLabel} />
            <div className="adm-ann__meta">
              <Badge tone={tone}>{label}</Badge>
              <span className="adm-faint">
                {fmtDateTime(a.startsAt)} → {a.endsAt ? fmtDateTime(a.endsAt) : 'no end'}
              </span>
              {a.linkUrl ? <code className="adm-code adm-code--sm">{a.linkUrl}</code> : null}
              <span className="adm-faint">created {relTime(a.createdAt, now)}</span>
              <span className="adm-ann__btns">
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onEdit(a)}>
                  <AdmIcon name="pencil" size={14} /> Edit
                </button>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--warn" onClick={() => onDelete(a)}>
                  <AdmIcon name="trash" size={14} /> Delete
                </button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** /admin/announcements */
export default function Announcements({ initial }) {
  useDocTitle('Announcements · Admin · Jalebi Games');
  const { push, node } = useToasts();
  const now = useNow();
  const { data, error, loading, reload } = useLoad(({ signal }) => listAnnouncements({ signal }), [], { initial });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = data?.announcements || [];
  const live = list.filter((a) => announcementStatus(a, now) === 'live').length;

  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteAnnouncement(deleting.id);
      push('Announcement deleted.', 'good');
      if (editing?.id === deleting.id) setEditing(null);
      setDeleting(null);
      reload();
    } catch (err) {
      push(errorMessage(err, 'Could not delete it.'), 'bad');
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-page">
      <PageHead title="Announcements" lead="The bar across the top of the site. Players see at most three live ones, newest first.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      <div className="adm-annlayout">
        <AnnouncementForm
          key={editing?.id || 'new'}
          editing={editing}
          push={push}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
        <Card title="All announcements" meta={data ? `${list.length} · ${live} live` : undefined} flush>
          {error && !data ? (
            <ErrorState error={error} onRetry={reload} what="announcements" />
          ) : !data ? (
            <Loading label="Loading announcements" rows={3} />
          ) : list.length ? (
            <AnnouncementList announcements={list} now={now} onEdit={setEditing} onDelete={setDeleting} editingId={editing?.id} />
          ) : (
            <Empty icon="bell" title="No announcements">
              Write one on the left. It shows up for everyone within a minute.
            </Empty>
          )}
        </Card>
      </div>
      <ConfirmAction
        open={!!deleting}
        title="Delete this announcement?"
        body={deleting ? `“${deleting.message}” is removed for everyone. To hide it for now, switch it off instead.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
      {node}
    </div>
  );
}

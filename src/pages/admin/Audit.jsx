import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AUDIT_ACTIONS, LIMITS, isUuid, listActions } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { AuditTable } from '@/components/admin/AuditTable.jsx';
import { useDebounced, useLoad, useNow } from '@/components/admin/hooks.js';
import { ACTION_LABEL } from '@/components/admin/model.js';
import { AdmIcon, Card, Empty, ErrorState, Field, Loading, PageHead, Pager, RefreshButton } from '@/components/admin/ui.jsx';

/** /admin/audit?action=&targetId=&page= */
export default function Audit({ initial }) {
  useDocTitle('Audit log · Admin · Jalebi Games');
  const [params, setParams] = useSearchParams();
  const action = AUDIT_ACTIONS.includes(params.get('action')) ? params.get('action') : '';
  const targetId = params.get('targetId') || '';
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  const [target, setTarget] = useState(targetId);
  const debounced = useDebounced(target, 300);
  const now = useNow();
  const targetErr = target.trim() && !isUuid(target) ? 'Paste a full user id.' : '';

  const write = (patch) => {
    const next = { action, targetId, page: 1, ...patch };
    const out = {};
    if (next.action) out.action = next.action;
    if (next.targetId) out.targetId = next.targetId;
    if (next.page > 1) out.page = String(next.page);
    setParams(out);
  };

  useEffect(() => {
    const t = debounced.trim();
    if (t === targetId || (t && !isUuid(t))) return;
    write({ targetId: t });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setTarget((t) => (t.trim() === targetId ? t : targetId)), [targetId]);

  const pageSize = LIMITS.actionsPageSize;
  const { data, error, loading, reload } = useLoad(({ signal }) => listActions({ page, pageSize, action, targetId }, { signal }), [page, action, targetId], { initial });
  const rows = data?.actions || [];
  const filtered = !!(action || targetId);
  const targetName = targetId && rows.find((r) => r.targetId === targetId)?.targetName;

  return (
    <div className="adm-page">
      <PageHead title="Audit log" lead="Every change made from this console, newest first.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      <Card flush>
        <div className="adm-toolbar adm-toolbar--filters">
          <Field label="Action" inline>
            <select className="adm-input adm-select" value={action} onChange={(e) => write({ action: e.target.value })}>
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a] || a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target user id" inline error={targetErr}>
            <input className="adm-input adm-mono" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Paste a user id" spellCheck={false} autoComplete="off" />
          </Field>
          {filtered ? (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setParams({})}>
              <AdmIcon name="close" size={14} /> Clear filters
            </button>
          ) : null}
          {targetId ? (
            <Link className="adm-textlink" to={paths.admin(`users/${targetId}`)}>
              Open {targetName || 'user'}
            </Link>
          ) : null}
        </div>
        <p className="adm-sr" aria-live="polite">
          {loading ? 'Loading' : data ? `${data.total} actions` : ''}
        </p>
        {error && !data ? (
          <ErrorState error={error} onRetry={reload} what="the audit log" />
        ) : !data ? (
          <Loading label="Loading audit log" rows={10} />
        ) : rows.length ? (
          <div className={loading ? 'adm-stale' : undefined}>
            <AuditTable actions={rows} now={now} />
            <Pager page={page} total={data.total} pageSize={data.pageSize || pageSize} onPage={(p) => write({ page: p })} label="Audit pages" />
          </div>
        ) : (
          <Empty icon="book" title={filtered ? 'No actions match' : 'Nothing logged yet'}>
            {filtered ? 'Try another action or clear the filters.' : 'Actions appear here as soon as staff change something.'}
          </Empty>
        )}
      </Card>
    </div>
  );
}

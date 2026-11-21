import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { ACTION_LABEL, actionTone, detailParts, fmtDateTime, relTime } from './model.js';

export function ActionChip({ action }) {
  return <span className={`adm-act adm-act--${actionTone(action)}`}>{ACTION_LABEL[action] || action}</span>;
}

/** The readable `details` of one audit row: "Amount +500 · Change 1,000 → 1,500 · “reason”". */
export function Details({ entry }) {
  const parts = detailParts(entry);
  if (!parts.length) return <span className="adm-faint">–</span>;
  return (
    <span className="adm-details">
      {parts.map((p, i) =>
        p.reason ? (
          <q key={i} className="adm-details__reason">
            {p.v}
          </q>
        ) : (
          <span key={i} className="adm-details__part">
            <span className="adm-details__k">{p.k}</span> {p.v}
          </span>
        ),
      )}
    </span>
  );
}

/** Audit rows as a real table (cards on phones). */
export function AuditTable({ actions, now = Date.now(), hideTarget = false }) {
  return (
    <div className="adm-tablewrap">
      <table className="adm-table adm-table--cards adm-table--audit">
        <caption className="adm-sr">Admin actions</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Admin</th>
            <th scope="col">Action</th>
            {hideTarget ? null : <th scope="col">Target</th>}
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.id}>
              <td data-label="Time" className="adm-td-time">
                <time dateTime={a.createdAt} title={fmtDateTime(a.createdAt)}>
                  {relTime(a.createdAt, now)}
                </time>
              </td>
              <td data-label="Admin">{a.adminId ? <Link to={paths.admin(`users/${a.adminId}`)}>{a.adminName}</Link> : a.adminName || <span className="adm-faint">deleted</span>}</td>
              <td data-label="Action">
                <ActionChip action={a.action} />
              </td>
              {hideTarget ? null : (
                <td data-label="Target">
                  {a.targetId ? <Link to={paths.admin(`users/${a.targetId}`)}>{a.targetName || a.targetId.slice(0, 8)}</Link> : a.targetName ? a.targetName : <span className="adm-faint">–</span>}
                </td>
              )}
              <td data-label="Details" className="adm-td-details">
                <Details entry={a} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AuditTable;

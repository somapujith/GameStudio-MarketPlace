import { useMemo } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { getAdminMe, isStaff } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import NotFound from '@/pages/NotFound.jsx';
import AdminLayout from '@/components/admin/AdminLayout.jsx';
import { AdminContext, adminValue, useLoad } from '@/components/admin/hooks.js';
import { Empty, Forbidden, Loading } from '@/components/admin/ui.jsx';
import Dashboard from './Dashboard.jsx';
import Users from './Users.jsx';
import UserDetail from './UserDetail.jsx';
import Rooms from './Rooms.jsx';
import Matches from './Matches.jsx';
import Grants from './Grants.jsx';
import Announcements from './Announcements.jsx';
import Audit from './Audit.jsx';
import '@/styles/admin.css';

function ConsoleNotFound() {
  return (
    <div className="adm-page">
      <Empty icon="compass" title="No such admin page">
        <Link to={paths.admin()}>Back to the dashboard</Link>
      </Empty>
    </div>
  );
}

/** Loads GET /api/admin/me (or takes `initialMe`) and provides the permissions to the console. */
export function AdminSession({ initialMe, children }) {
  const { data: me, error, reload } = useLoad(({ signal }) => getAdminMe({ signal }), [], { initial: initialMe });
  const value = useMemo(() => adminValue(me ?? null, { meError: error, reloadMe: reload }), [me, error, reload]);
  if (error && !me && (error.status === 401 || error.status === 403)) {
    return (
      <div className="adm adm--solo">
        <main className="adm-main" id="adm-main">
          <Forbidden status={error.status} />
        </main>
      </div>
    );
  }
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

/** The console's sections, relative to /admin. */
export function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="users" element={<Users />} />
      <Route path="users/:id" element={<UserDetail />} />
      <Route path="rooms" element={<Rooms />} />
      <Route path="matches" element={<Matches />} />
      <Route path="grants" element={<Grants />} />
      <Route path="announcements" element={<Announcements />} />
      <Route path="audit" element={<Audit />} />
      <Route path="*" element={<ConsoleNotFound />} />
    </Routes>
  );
}

/**
 * `/admin/*`. Signed-out and non-staff visitors get the app's normal 404 (`notFound`, default the bare NotFound page),
 * so the console is not advertised. Staff get the full-screen console. `children` replaces the routes (tests).
 */
export default function AdminApp({ notFound, initialMe, children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="adm adm--solo">
        <main className="adm-main">
          <Loading label="Checking your session" rows={4} />
        </main>
      </div>
    );
  }
  if (!isStaff(user)) return notFound ?? <NotFound />;
  return (
    <AdminSession initialMe={initialMe}>
      <AdminLayout>{children ?? <AdminRoutes />}</AdminLayout>
    </AdminSession>
  );
}

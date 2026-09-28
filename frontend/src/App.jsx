import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router';
import { useAuth } from './core/context/AuthContext';
import { useApps } from './core/context/AppsContext';
import AppNavbar from './core/components/AppNavbar';
import Spinner from './core/components/Spinner';
import Login from './core/pages/Login';
import Register from './core/pages/Register';
import { APPS } from './apps';

// Everything behind sign-in is split into its own chunk so the first paint stays
// small. Each app's pages load only when that app is opened.
const Home = lazy(() => import('./core/pages/Home'));
const Account = lazy(() => import('./core/pages/Account'));
const Admin = lazy(() => import('./core/pages/Admin'));

function Protected({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <Spinner fullscreen />;
  if (status !== 'authed') return <Navigate to="/login" replace />;
  return (
    <>
      <AppNavbar />
      <Suspense fallback={<Spinner fullscreen />}>{children}</Suspense>
    </>
  );
}

function PublicOnly({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <Spinner fullscreen />;
  if (status === 'authed') return <Navigate to="/" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

// Shows an app only while the server has it turned on.
function AppGate({ id, children }) {
  const { loading, isEnabled } = useApps();
  if (loading) return <Spinner fullscreen />;
  if (isEnabled(id)) return children;
  return (
    <main className="container py-5 text-center">
      <h1 className="h5 fw-bold">This app is turned off</h1>
      <p className="text-muted">An admin can turn it back on from the Admin page.</p>
      <Link to="/" className="btn btn-primary">Back to home</Link>
    </main>
  );
}

// Board links from before apps had their own paths.
function LegacyBoardRedirect() {
  const { boardId } = useParams();
  return <Navigate to={`/boards/${encodeURIComponent(boardId)}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      {APPS.map(({ id, Routes: AppRoutes }) => (
        <Route key={id} path={`/${id}/*`} element={<Protected><AppGate id={id}><AppRoutes /></AppGate></Protected>} />
      ))}
      <Route path="/b/:boardId" element={<LegacyBoardRedirect />} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/admin" element={<Protected><AdminOnly><Admin /></AdminOnly></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

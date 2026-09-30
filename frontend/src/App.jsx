import { lazy, Suspense, useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { useAuth } from './core/context/AuthContext';
import { useWorkspace } from './core/context/WorkspaceContext';
import AppNavbar from './core/components/AppNavbar';
import Spinner from './core/components/Spinner';
import Login from './core/pages/Login';
import Register from './core/pages/Register';
import { APPS } from './apps';
import { siteUrl } from './core/site';
import {
  WORKSPACE_SLUG, goTo, isInvitePath, isWorkspacePath, lastWorkspace, workspaceUrl,
} from './core/workspaceUrl';

// Everything behind sign-in is split into its own chunk so the first paint stays
// small. Each app's pages load only when that app is opened.
const Home = lazy(() => import('./core/pages/Home'));
const Account = lazy(() => import('./core/pages/Account'));
const Admin = lazy(() => import('./core/pages/Admin'));
const NewWorkspace = lazy(() => import('./core/pages/NewWorkspace'));
const WorkspaceSettings = lazy(() => import('./core/pages/WorkspaceSettings'));
const JoinWorkspace = lazy(() => import('./core/pages/JoinWorkspace'));

// A full page load to a path under /app, outside the current workspace.
function Leave({ to }) {
  useEffect(() => goTo(`/app${to}`), [to]);
  return <Spinner fullscreen />;
}

function Protected({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner fullscreen />;
  if (status !== 'authed') {
    // Come back to this page after signing in.
    const next = `?next=${encodeURIComponent(window.location.pathname + location.search + location.hash)}`;
    if (WORKSPACE_SLUG) return <Leave to={`/login${next}`} />;
    return <Navigate to={`/login${location.pathname === '/' ? '' : next}`} replace />;
  }
  return (
    <>
      <AppNavbar />
      <Suspense fallback={<Spinner fullscreen />}>{children}</Suspense>
    </>
  );
}

function PublicOnly({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner fullscreen />;
  if (status === 'authed') return <Navigate to={`/${location.search}`} replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

// Waits for the workspace, and stops at a clear message if the user isn't in it.
function WorkspaceGate({ children }) {
  const { status } = useWorkspace();
  if (status === 'loading') return <Spinner fullscreen />;
  if (status === 'missing') {
    return (
      <main className="container py-5 text-center">
        <h1 className="h5 fw-bold">Workspace not found</h1>
        <p className="text-muted">It doesn&apos;t exist, or you&apos;re not a member. Ask one of its admins for an invite link.</p>
        <a href="/app/" className="btn btn-primary">Go to your workspaces</a>
      </main>
    );
  }
  return children;
}

// Shows an app only while the workspace's plan includes it and it's turned on.
function AppGate({ id, children }) {
  const { isEnabled, isIncluded } = useWorkspace();
  if (isEnabled(id)) return children;
  const name = APPS.find((a) => a.id === id)?.name ?? 'This app';
  return (
    <main className="container py-5 text-center">
      {isIncluded(id) ? (
        <>
          <h1 className="h5 fw-bold">{name} is turned off</h1>
          <p className="text-muted">A workspace admin can turn it back on in Workspace settings.</p>
        </>
      ) : (
        <>
          <h1 className="h5 fw-bold">{name} isn&apos;t in your plan</h1>
          <p className="text-muted">
            It&apos;s included in the Plus plan.
            {siteUrl('/pricing') && <> See <a href={siteUrl('/pricing')}>pricing</a>.</>}
          </p>
        </>
      )}
      <Link to="/" className="btn btn-primary">Back to home</Link>
    </main>
  );
}

// Board links from before apps had their own paths.
function LegacyBoardRedirect() {
  const { boardId } = useParams();
  return <Navigate to={`/boards/${encodeURIComponent(boardId)}`} replace />;
}

// Outside a workspace: send the user into one. Priority: where they were headed
// before signing in, then the workspace they used last, then their first.
function ChooseWorkspace() {
  const { workspaces } = useWorkspace();
  const location = useLocation();
  const next = new URLSearchParams(location.search).get('next');
  const target = (() => {
    // Signed in (or up) from an invite link: back to it, whether or not they have a workspace yet.
    if (isInvitePath(next)) return next;
    if (!workspaces?.length) return null;
    if (isWorkspacePath(next)) return next;
    const last = workspaces.find((w) => w.slug === lastWorkspace());
    // A path from before workspaces existed (e.g. /app/boards/123) opens in that workspace.
    const legacy = location.pathname !== '/' ? location.pathname : '/';
    return workspaceUrl((last || workspaces[0]).slug, legacy);
  })();

  useEffect(() => {
    if (target) goTo(target);
  }, [target]);

  if (workspaces && !workspaces.length) return <Navigate to="/new" replace />;
  return <Spinner fullscreen />;
}

function WorkspaceRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Leave to={`/login${window.location.search}`} />} />
      <Route path="/register" element={<Leave to="/register" />} />
      <Route path="/new" element={<Leave to="/new" />} />
      <Route path="/" element={<Protected><WorkspaceGate><Home /></WorkspaceGate></Protected>} />
      <Route path="/settings" element={<Protected><WorkspaceGate><WorkspaceSettings /></WorkspaceGate></Protected>} />
      {APPS.map(({ id, Routes: AppRoutes }) => (
        <Route key={id} path={`/${id}/*`} element={<Protected><WorkspaceGate><AppGate id={id}><AppRoutes /></AppGate></WorkspaceGate></Protected>} />
      ))}
      <Route path="/b/:boardId" element={<LegacyBoardRedirect />} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/admin" element={<Protected><AdminOnly><Admin /></AdminOnly></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AccountRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/" element={<Protected><ChooseWorkspace /></Protected>} />
      <Route path="/new" element={<Protected><NewWorkspace /></Protected>} />
      <Route path="/invite" element={<Protected><JoinWorkspace /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/admin" element={<Protected><AdminOnly><Admin /></AdminOnly></Protected>} />
      {[...APPS.map((a) => a.id), 'b'].map((id) => (
        <Route key={id} path={`/${id}/*`} element={<Protected><ChooseWorkspace /></Protected>} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return WORKSPACE_SLUG ? <WorkspaceRoutes /> : <AccountRoutes />;
}

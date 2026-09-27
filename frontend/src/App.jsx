import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './context/AuthContext';
import AppNavbar from './components/AppNavbar';
import Spinner from './components/Spinner';
import Login from './pages/Login';
import Register from './pages/Register';

// The board view (with drag and drop) and the account page are split into
// their own chunks so the first paint stays small.
const Boards = lazy(() => import('./pages/Boards'));
const Board = lazy(() => import('./pages/Board'));
const Account = lazy(() => import('./pages/Account'));

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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/" element={<Protected><Boards /></Protected>} />
      <Route path="/b/:boardId" element={<Protected><Board /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

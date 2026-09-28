import { Link } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useApps } from '../context/AppsContext';
import Spinner from '../components/Spinner';

export default function Home() {
  const { user } = useAuth();
  const { apps, loading } = useApps();
  const isAdmin = user.role === 'admin';

  if (loading) return <Spinner fullscreen />;

  return (
    <main className="container py-4" style={{ maxWidth: 960 }}>
      <h1 className="h4 fw-bold text-primary mb-1">Hi, {user.name}</h1>
      <p className="text-muted mb-4">Pick an app to get started.</p>

      {apps.length === 0 ? (
        <div className="card border-0 shadow-sm">
          <div className="card-body text-center py-5">
            <p className="fw-semibold mb-1">No apps are turned on yet.</p>
            {isAdmin ? (
              <Link to="/admin" className="btn btn-primary mt-2">
                <FontAwesomeIcon icon={faScrewdriverWrench} className="me-2" />Open Admin
              </Link>
            ) : (
              <p className="text-muted small mb-0">Ask an admin to turn one on.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="row g-3">
          {apps.map((app) => (
            <div className="col-6 col-md-4 col-lg-3" key={app.id}>
              <Link to={`/${app.id}`} className="app-tile">
                <span className="app-tile-icon"><FontAwesomeIcon icon={app.icon} /></span>
                <span className="fw-bold">{app.name}</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

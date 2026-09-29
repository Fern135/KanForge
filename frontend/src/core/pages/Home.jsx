import { Link } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { UPCOMING_APPS } from '../../apps';

export default function Home() {
  const { user } = useAuth();
  const { apps, locked, workspace, isAdmin } = useWorkspace();

  return (
    <main className="container py-4" style={{ maxWidth: 960 }}>
      <h1 className="h4 fw-bold text-primary mb-1">Hi, {user.name}</h1>
      <p className="text-muted mb-4">Pick an app to get started in {workspace.name}.</p>

      {apps.length === 0 && (
        <div className="card border-0 shadow-sm mb-3">
          <div className="card-body text-center py-5">
            <p className="fw-semibold mb-1">No apps are turned on yet.</p>
            {isAdmin ? (
              <Link to="/settings" className="btn btn-primary mt-2">
                <FontAwesomeIcon icon={faScrewdriverWrench} className="me-2" />Open Workspace settings
              </Link>
            ) : (
              <p className="text-muted small mb-0">Ask an admin to turn one on.</p>
            )}
          </div>
        </div>
      )}
      <div className="row g-3">
        {apps.map((app) => (
          <div className="col-6 col-md-4 col-lg-3" key={app.id}>
            <Link to={`/${app.id}`} className="app-tile">
              <span className="app-tile-icon"><FontAwesomeIcon icon={app.icon} /></span>
              <span className="fw-bold">{app.name}</span>
            </Link>
          </div>
        ))}
        {locked.map((app) => (
          <div className="col-6 col-md-4 col-lg-3" key={app.id}>
            <a href="/pricing" className="app-tile app-tile-soon text-decoration-none">
              <span className="app-tile-icon"><FontAwesomeIcon icon={app.icon} /></span>
              <span className="fw-bold">{app.name}</span>
              <span className="badge rounded-pill app-tile-badge">In Plus</span>
            </a>
          </div>
        ))}
        {UPCOMING_APPS.map((app) => (
          <div className="col-6 col-md-4 col-lg-3" key={app.id}>
            <div className="app-tile app-tile-soon" aria-disabled="true">
              <span className="app-tile-icon"><FontAwesomeIcon icon={app.icon} /></span>
              <span className="fw-bold">{app.name}</span>
              <span className="badge rounded-pill app-tile-badge">Coming soon</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

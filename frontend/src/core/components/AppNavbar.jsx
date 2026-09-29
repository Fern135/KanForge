import { Link, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faHouse, faTableCellsLarge, faUserGear, faScrewdriverWrench, faRightFromBracket,
  faChevronDown, faCheck, faPlus, faGear,
} from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { WORKSPACE_SLUG, goTo, workspaceUrl } from '../workspaceUrl';
import useDropdown from '../hooks/useDropdown';
import Avatar from './Avatar';
import Logo, { APP_NAME } from './Logo';
import { UPCOMING_APPS } from '../../apps';

const menuStyle = { right: 0, left: 'auto' };

export default function AppNavbar() {
  const { user, logout } = useAuth();
  const { apps, workspace, workspaces } = useWorkspace();
  const navigate = useNavigate();
  const spaces = useDropdown();
  const switcher = useDropdown();
  const account = useDropdown();

  const doLogout = async () => {
    account.setOpen(false);
    await logout().catch(() => {});
    navigate('/login', { replace: true });
  };

  return (
    <nav className="navbar tb-navbar px-3" style={{ height: 56 }}>
      <div className="d-flex align-items-center gap-2 min-w-0">
        <Link to="/" className="navbar-brand d-flex align-items-center gap-2 me-0">
          <Logo size={30} />
          <span className="d-none d-sm-inline">{APP_NAME}</span>
        </Link>
        <div className="dropdown min-w-0" ref={spaces.ref}>
          <button
            type="button"
            className="btn btn-link text-white text-decoration-none fw-semibold px-2 border-0 d-flex align-items-center gap-2 min-w-0"
            aria-haspopup="menu"
            aria-expanded={spaces.open}
            aria-label="Workspaces"
            onClick={() => spaces.setOpen((o) => !o)}
          >
            <span className="text-truncate" style={{ maxWidth: 180 }}>{workspace?.name ?? 'Workspaces'}</span>
            <FontAwesomeIcon icon={faChevronDown} size="xs" />
          </button>
          {spaces.open && (
            <ul className="dropdown-menu show shadow border-0 mt-2" role="menu" style={{ minWidth: 240 }}>
              <li><h6 className="dropdown-header">Workspaces</h6></li>
              {(workspaces || []).map((w) => (
                <li key={w.id}>
                  <button type="button" className="dropdown-item d-flex align-items-center gap-2"
                    onClick={() => w.slug !== WORKSPACE_SLUG && goTo(workspaceUrl(w.slug))}>
                    <span className="text-truncate">{w.name}</span>
                    {w.slug === WORKSPACE_SLUG && <FontAwesomeIcon icon={faCheck} className="ms-auto text-success" />}
                  </button>
                </li>
              ))}
              <li><hr className="dropdown-divider" /></li>
              {workspace && (
                <li>
                  <Link className="dropdown-item" to="/settings" onClick={() => spaces.setOpen(false)}>
                    <FontAwesomeIcon icon={faGear} className="me-2" fixedWidth />Workspace settings
                  </Link>
                </li>
              )}
              <li>
                <button type="button" className="dropdown-item" onClick={() => goTo('/app/new')}>
                  <FontAwesomeIcon icon={faPlus} className="me-2" fixedWidth />Create workspace
                </button>
              </li>
            </ul>
          )}
        </div>
      </div>
      <div className="d-flex align-items-center gap-3">
        {workspace && (
          <div className="dropdown" ref={switcher.ref}>
            <button
              type="button"
              className="btn btn-link text-white p-1 border-0"
              aria-haspopup="menu"
              aria-expanded={switcher.open}
              aria-label="Apps"
              onClick={() => switcher.setOpen((o) => !o)}
            >
              <FontAwesomeIcon icon={faTableCellsLarge} size="lg" />
            </button>
            {switcher.open && (
              <ul className="dropdown-menu dropdown-menu-end show shadow border-0 mt-2" style={menuStyle} role="menu">
                <li>
                  <Link className="dropdown-item" to="/" onClick={() => switcher.setOpen(false)}>
                    <FontAwesomeIcon icon={faHouse} className="me-2" fixedWidth />Home
                  </Link>
                </li>
                {apps.length > 0 && <li><hr className="dropdown-divider" /></li>}
                {apps.map((app) => (
                  <li key={app.id}>
                    <Link className="dropdown-item" to={`/${app.id}`} onClick={() => switcher.setOpen(false)}>
                      <FontAwesomeIcon icon={app.icon} className="me-2" fixedWidth />{app.name}
                    </Link>
                  </li>
                ))}
                <li><hr className="dropdown-divider" /></li>
                {UPCOMING_APPS.map((app) => (
                  <li key={app.id}>
                    <span className="dropdown-item-text d-flex align-items-center text-muted" aria-disabled="true">
                      <FontAwesomeIcon icon={app.icon} className="me-2" fixedWidth />{app.name}
                      <span className="badge rounded-pill text-bg-light ms-auto ps-2">Coming soon</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="dropdown" ref={account.ref}>
          <button
            type="button"
            className="btn p-0 border-0"
            aria-haspopup="menu"
            aria-expanded={account.open}
            onClick={() => account.setOpen((o) => !o)}
          >
            <Avatar name={user?.name} />
          </button>
          {account.open && (
            <ul className="dropdown-menu dropdown-menu-end show shadow border-0 mt-2" style={menuStyle} role="menu">
              <li className="px-3 py-2 small text-muted text-truncate" style={{ maxWidth: 240 }}>
                <div className="fw-semibold text-body">{user?.name}</div>
                {user?.email}
              </li>
              <li><hr className="dropdown-divider" /></li>
              <li>
                <Link className="dropdown-item" to="/account" onClick={() => account.setOpen(false)}>
                  <FontAwesomeIcon icon={faUserGear} className="me-2" fixedWidth />Account &amp; security
                </Link>
              </li>
              {user?.role === 'admin' && (
                <li>
                  <Link className="dropdown-item" to="/admin" onClick={() => account.setOpen(false)}>
                    <FontAwesomeIcon icon={faScrewdriverWrench} className="me-2" fixedWidth />Platform admin
                  </Link>
                </li>
              )}
              <li>
                <button type="button" className="dropdown-item text-danger" onClick={doLogout}>
                  <FontAwesomeIcon icon={faRightFromBracket} className="me-2" fixedWidth />Log out
                </button>
              </li>
            </ul>
          )}
        </div>
      </div>
    </nav>
  );
}

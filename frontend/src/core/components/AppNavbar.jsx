import { Link, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faHouse, faTableCellsLarge, faUserGear, faScrewdriverWrench, faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useApps } from '../context/AppsContext';
import useDropdown from '../hooks/useDropdown';
import Avatar from './Avatar';
import Logo, { APP_NAME } from './Logo';

const menuStyle = { right: 0, left: 'auto' };

export default function AppNavbar() {
  const { user, logout } = useAuth();
  const { apps } = useApps();
  const navigate = useNavigate();
  const switcher = useDropdown();
  const account = useDropdown();

  const doLogout = async () => {
    account.setOpen(false);
    await logout().catch(() => {});
    navigate('/login', { replace: true });
  };

  return (
    <nav className="navbar tb-navbar px-3" style={{ height: 56 }}>
      <Link to="/" className="navbar-brand d-flex align-items-center gap-2">
        <Logo size={30} />
        {APP_NAME}
      </Link>
      <div className="d-flex align-items-center gap-3">
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
            </ul>
          )}
        </div>
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
                    <FontAwesomeIcon icon={faScrewdriverWrench} className="me-2" fixedWidth />Admin
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

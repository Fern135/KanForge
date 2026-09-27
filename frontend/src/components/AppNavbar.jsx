import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTableColumns, faUserGear, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';
import Logo, { APP_NAME } from './Logo';

export default function AppNavbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !menuRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const doLogout = async () => {
    setOpen(false);
    await logout().catch(() => {});
    navigate('/login', { replace: true });
  };

  return (
    <nav className="navbar tb-navbar px-3" style={{ height: 56 }}>
      <Link to="/" className="navbar-brand d-flex align-items-center gap-2">
        <Logo size={30} />
        {APP_NAME}
      </Link>
      <div className="dropdown" ref={menuRef}>
        <button
          type="button"
          className="btn p-0 border-0"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Avatar name={user?.name} />
        </button>
        {open && (
          <ul className="dropdown-menu dropdown-menu-end show shadow border-0 mt-2" style={{ right: 0, left: 'auto' }} role="menu">
            <li className="px-3 py-2 small text-muted text-truncate" style={{ maxWidth: 240 }}>
              <div className="fw-semibold text-body">{user?.name}</div>
              {user?.email}
            </li>
            <li><hr className="dropdown-divider" /></li>
            <li>
              <Link className="dropdown-item" to="/" onClick={() => setOpen(false)}>
                <FontAwesomeIcon icon={faTableColumns} className="me-2" />Boards
              </Link>
            </li>
            <li>
              <Link className="dropdown-item" to="/account" onClick={() => setOpen(false)}>
                <FontAwesomeIcon icon={faUserGear} className="me-2" />Account &amp; security
              </Link>
            </li>
            <li>
              <button type="button" className="dropdown-item text-danger" onClick={doLogout}>
                <FontAwesomeIcon icon={faRightFromBracket} className="me-2" />Log out
              </button>
            </li>
          </ul>
        )}
      </div>
    </nav>
  );
}

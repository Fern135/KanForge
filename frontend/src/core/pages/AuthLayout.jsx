import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import Logo, { APP_NAME } from '../components/Logo';

// Sign-in and sign-up. The landing page lives outside the app (at /), so these
// are plain links rather than router links.
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-shell">
      <div className="auth-column">
        <a href="/" className="auth-back">
          <FontAwesomeIcon icon={faArrowLeft} className="me-2" />Back to home
        </a>
        <div className="card auth-card">
          <div className="card-body p-4 p-sm-5">
            <a href="/" className="d-inline-flex align-items-center gap-2 mb-4 text-primary text-decoration-none" title="Kanforge home">
              <Logo size={40} />
              <span className="fs-4 fw-bolder">{APP_NAME}</span>
            </a>
            <h1 className="h4 fw-bold mb-1">{title}</h1>
            <p className="text-muted mb-4">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

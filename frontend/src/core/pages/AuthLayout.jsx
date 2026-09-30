import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import Logo, { APP_NAME } from '../components/Logo';
import { siteUrl } from '../site';

// Sign-in and sign-up. When the app has a site (a hosted build), they link back
// to its landing page, which lives outside the app, so these are plain links.
export default function AuthLayout({ title, subtitle, children }) {
  const home = siteUrl('/');
  const brand = (
    <>
      <Logo size={40} />
      <span className="fs-4 fw-bolder">{APP_NAME}</span>
    </>
  );
  const brandClass = 'd-inline-flex align-items-center gap-2 mb-4 text-primary text-decoration-none';
  return (
    <div className="auth-shell">
      <div className="auth-column">
        {home && (
          <a href={home} className="auth-back">
            <FontAwesomeIcon icon={faArrowLeft} className="me-2" />Back to home
          </a>
        )}
        <div className="card auth-card">
          <div className="card-body p-4 p-sm-5">
            {home
              ? <a href={home} className={brandClass} title="Kanforge home">{brand}</a>
              : <div className={brandClass}>{brand}</div>}
            <h1 className="h4 fw-bold mb-1">{title}</h1>
            <p className="text-muted mb-4">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

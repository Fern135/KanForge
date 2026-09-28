import Logo, { APP_NAME } from '../components/Logo';

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="card-body p-4 p-sm-5">
          <div className="d-flex align-items-center gap-2 mb-4 text-primary">
            <Logo size={40} />
            <span className="fs-4 fw-bolder">{APP_NAME}</span>
          </div>
          <h1 className="h4 fw-bold mb-1">{title}</h1>
          <p className="text-muted mb-4">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

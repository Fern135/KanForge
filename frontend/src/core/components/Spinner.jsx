export default function Spinner({ fullscreen = false, small = false }) {
  const spinner = (
    <div className={`spinner-border text-primary ${small ? 'spinner-border-sm' : ''}`} role="status">
      <span className="visually-hidden">Loading…</span>
    </div>
  );
  if (!fullscreen) return spinner;
  return <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '60vh' }}>{spinner}</div>;
}

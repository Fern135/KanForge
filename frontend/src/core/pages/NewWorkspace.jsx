import { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { workspacesApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { goTo, rememberWorkspace, workspaceUrl } from '../workspaceUrl';

// "Acme Design Co." -> "acme-design-co"
const slugify = (name) => name
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40)
  .replace(/-+$/, '');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;

export default function NewWorkspace() {
  const { workspaces } = useWorkspace();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = workspaces !== null && workspaces.length === 0;

  const onName = (value) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { workspace } = await workspacesApi.create({ name: name.trim(), slug });
      rememberWorkspace(workspace.slug);
      goTo(workspaceUrl(workspace.slug));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const slugValid = SLUG_RE.test(slug);

  return (
    <main className="container py-5" style={{ maxWidth: 520 }}>
      <h1 className="h4 fw-bold text-primary mb-1">{first ? 'Create your workspace' : 'Create a workspace'}</h1>
      <p className="text-muted mb-4">
        A workspace holds your team&apos;s boards, notes and documents.
        {first && ' If your team already has one, ask one of its admins for an invite link.'}
      </p>
      <form className="card border-0 shadow-sm" onSubmit={submit}>
        <div className="card-body">
          <label className="form-label fw-semibold" htmlFor="ws-name">Name</label>
          <input id="ws-name" className="form-control mb-3" maxLength={60} value={name} autoFocus
            placeholder="Acme Inc." onChange={(e) => onName(e.target.value)} required />

          <label className="form-label fw-semibold" htmlFor="ws-slug">Address</label>
          <div className="input-group mb-1">
            <span className="input-group-text text-muted small">/app/w/</span>
            <input id="ws-slug" className={`form-control ${slug && !slugValid ? 'is-invalid' : ''}`} maxLength={40} value={slug}
              onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugEdited(true); }} required
              aria-describedby="ws-slug-help" />
          </div>
          <div id="ws-slug-help" className="form-text mb-3">
            3 to 40 lowercase letters, numbers and hyphens. It can&apos;t be changed later.
          </div>

          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          <button type="submit" className="btn btn-primary w-100" disabled={busy || !name.trim() || !slugValid}>
            Create workspace
          </button>
        </div>
      </form>
    </main>
  );
}

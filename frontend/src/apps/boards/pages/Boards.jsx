import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus, faUsers, faCrown, faTriangleExclamation, faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { boardsApi } from '../api';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import Spinner from '../../../core/components/Spinner';
import Modal from '../../../core/components/Modal';
import { BACKGROUNDS } from '../utils/constants';

function CreateBoardModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [background, setBackground] = useState('navy');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { board } = await boardsApi.create({ title: title.trim(), background });
      onCreated(board);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Create board" onClose={onClose}>
      <form onSubmit={submit}>
        <div className={`bg-board-${background} rounded-3 mb-3 d-flex align-items-end p-3 text-white fw-bold`} style={{ height: 90 }}>
          {title || 'Board title'}
        </div>
        <label className="form-label fw-semibold" htmlFor="board-title">Title</label>
        <input id="board-title" className="form-control mb-3" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="form-label fw-semibold">Background</div>
        <div className="d-flex flex-wrap gap-2 mb-4">
          {BACKGROUNDS.map((bg) => (
            <button key={bg} type="button" aria-label={bg} aria-pressed={background === bg}
              className={`bg-swatch bg-board-${bg} ${background === bg ? 'active' : ''}`} onClick={() => setBackground(bg)} />
          ))}
        </div>
        <button type="submit" className="btn btn-primary w-100" disabled={busy || !title.trim()}>Create board</button>
      </form>
    </Modal>
  );
}

// Warn once someone is on 80% of the boards they're allowed, so the limit is never a surprise.
const WARN_AT = 0.8;

function BoardLimitNotice({ used, max }) {
  if (used < max * WARN_AT) return null;
  const full = used >= max;
  return (
    <div className={`alert ${full ? 'alert-danger' : 'alert-warning'} d-flex gap-2 align-items-start`} role="status">
      <FontAwesomeIcon icon={full ? faCircleExclamation : faTriangleExclamation} className="mt-1" />
      <div>
        <div className="fw-semibold">
          {full ? `You're on ${max} of ${max} boards` : `You're on ${used} of ${max} boards`}
        </div>
        <div className="small">
          {full
            ? "That's the most you can have, so you can't create a board or be added to one. Delete a board you own, or leave one that was shared with you, to free up space."
            : `You can be on up to ${max} boards, counting the ones shared with you. Delete or leave boards you no longer need to keep room for new ones.`}
        </div>
      </div>
    </div>
  );
}

export default function Boards() {
  const [boards, setBoards] = useState(null);
  const [limit, setLimit] = useState(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    boardsApi.list().then((d) => {
      setBoards(d.boards);
      setLimit(d.limit);
    }).catch((err) => {
      toast.error(errorMessage(err));
      setBoards([]);
    });
  }, [toast]);

  if (!boards) return <Spinner fullscreen />;
  const full = limit ? limit.used >= limit.max : false;

  return (
    <main className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 fw-bold text-primary mb-0">Your boards</h1>
        <button type="button" className="btn btn-accent btn-sm d-sm-none" disabled={full} onClick={() => setCreating(true)}>
          <FontAwesomeIcon icon={faPlus} className="me-1" />New
        </button>
      </div>
      {limit && <BoardLimitNotice used={limit.used} max={limit.max} />}
      <div className="row g-3">
        {boards.map((b) => (
          <div className="col-6 col-md-4 col-lg-3" key={b.id}>
            <Link to={`/boards/${b.id}`} className={`board-tile bg-board-${b.background}`}>
              <span className="text-break">{b.title}</span>
              <span className="small fw-normal opacity-75 d-flex gap-3">
                <span><FontAwesomeIcon icon={faUsers} className="me-1" />{b.memberCount}</span>
                {b.role === 'owner' && <span><FontAwesomeIcon icon={faCrown} className="me-1" />Owner</span>}
              </span>
            </Link>
          </div>
        ))}
        <div className="col-6 col-md-4 col-lg-3">
          <button type="button" className="board-tile tile-new w-100" disabled={full} onClick={() => setCreating(true)}>
            <FontAwesomeIcon icon={faPlus} size="lg" className="mb-1" />
            {full ? 'Board limit reached' : 'Create new board'}
          </button>
        </div>
      </div>
      {boards.length === 0 && (
        <p className="text-muted mt-4">No boards yet. Create your first one to get started.</p>
      )}
      {creating && (
        <CreateBoardModal onClose={() => setCreating(false)} onCreated={(b) => navigate(`/boards/${b.id}`)} />
      )}
    </main>
  );
}

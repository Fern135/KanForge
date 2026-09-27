import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCrown, faTrash, faUserPlus, faPlus, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import Modal from '../Modal';
import Avatar from '../Avatar';
import ConfirmModal from '../ConfirmModal';
import { boardsApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { BACKGROUNDS, LABEL_COLORS } from '../../utils/constants';

export function MembersModal({ board, onClose, onMembersChange, onLeft }) {
  const toast = useToast();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const isOwner = board.role === 'owner';

  const invite = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { member } = await boardsApi.addMember(board.id, email.trim());
      onMembersChange([...board.members, member]);
      setEmail('');
      toast.success(`${member.name} was added to the board`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m) => {
    try {
      await boardsApi.removeMember(board.id, m.id);
      if (m.id === user.id) {
        onLeft();
        return;
      }
      onMembersChange(board.members.filter((x) => x.id !== m.id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal title="Share board" onClose={onClose}>
      {isOwner && (
        <form onSubmit={invite} className="d-flex gap-2 mb-4">
          <input type="email" className="form-control" placeholder="Email address" maxLength={254} value={email}
            onChange={(e) => setEmail(e.target.value)} aria-label="Invite by email" />
          <button type="submit" className="btn btn-primary text-nowrap" disabled={busy || !email.trim()}>
            <FontAwesomeIcon icon={faUserPlus} className="me-1" />Invite
          </button>
        </form>
      )}
      <div className="section-title">Members</div>
      <ul className="list-unstyled mb-0">
        {board.members.map((m) => (
          <li key={m.id} className="d-flex align-items-center gap-2 py-2 border-bottom">
            <Avatar name={m.name} />
            <div className="flex-grow-1 min-w-0">
              <div className="fw-semibold text-truncate">{m.name}{m.id === user.id && ' (you)'}</div>
              <div className="small text-muted text-truncate">{m.email}</div>
            </div>
            {m.role === 'owner' ? (
              <span className="badge text-bg-primary"><FontAwesomeIcon icon={faCrown} className="me-1" />Owner</span>
            ) : (
              (isOwner || m.id === user.id) && (
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => remove(m)}>
                  {m.id === user.id ? <><FontAwesomeIcon icon={faRightFromBracket} className="me-1" />Leave</> : 'Remove'}
                </button>
              )
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function LabelsModal({ board, onClose, onLabelsChange }) {
  const toast = useToast();
  const [draft, setDraft] = useState({ name: '', color: 'green' });

  const handle = async (fn) => {
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const add = (e) => {
    e.preventDefault();
    handle(async () => {
      const { label } = await boardsApi.addLabel(board.id, { name: draft.name.trim(), color: draft.color });
      onLabelsChange([...board.labels, label]);
      setDraft({ name: '', color: draft.color });
    });
  };

  const patch = (label, body) =>
    handle(async () => {
      const { label: updated } = await boardsApi.updateLabel(board.id, label.id, body);
      onLabelsChange(board.labels.map((l) => (l.id === label.id ? updated : l)));
    });

  const remove = (label) =>
    handle(async () => {
      await boardsApi.removeLabel(board.id, label.id);
      onLabelsChange(board.labels.filter((l) => l.id !== label.id), label.id);
    });

  return (
    <Modal title="Labels" onClose={onClose}>
      <ul className="list-unstyled">
        {board.labels.map((l) => (
          <li key={l.id} className="d-flex align-items-center gap-2 mb-2">
            <select className={`form-select form-select-sm label-${l.color}`} style={{ width: 110 }} value={l.color}
              onChange={(e) => patch(l, { color: e.target.value })} aria-label="Label color">
              {LABEL_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="form-control form-control-sm" defaultValue={l.name} maxLength={40} placeholder="Label name"
              onBlur={(e) => e.target.value.trim() !== l.name && patch(l, { name: e.target.value.trim() })} aria-label="Label name" />
            <button type="button" className="icon-btn" aria-label="Delete label" onClick={() => remove(l)}>
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="d-flex gap-2 border-top pt-3">
        <select className={`form-select form-select-sm label-${draft.color}`} style={{ width: 110 }} value={draft.color}
          onChange={(e) => setDraft({ ...draft, color: e.target.value })} aria-label="New label color">
          {LABEL_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="form-control form-control-sm" placeholder="New label name" maxLength={40} value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <button type="submit" className="btn btn-sm btn-primary" aria-label="Add label"><FontAwesomeIcon icon={faPlus} /></button>
      </form>
    </Modal>
  );
}

export function SettingsModal({ board, onClose, onUpdate, onDeleted }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);

  const setBackground = async (background) => {
    try {
      await boardsApi.update(board.id, { background });
      onUpdate({ background });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal title="Board settings" onClose={onClose}>
      <div className="section-title">Background</div>
      <div className="d-flex flex-wrap gap-2 mb-4">
        {BACKGROUNDS.map((bg) => (
          <button key={bg} type="button" aria-label={bg} aria-pressed={board.background === bg}
            className={`bg-swatch bg-board-${bg} ${board.background === bg ? 'active' : ''}`} onClick={() => setBackground(bg)} />
        ))}
      </div>
      {board.role === 'owner' && (
        <div className="border-top pt-3">
          <div className="section-title text-danger">Danger zone</div>
          <button type="button" className="btn btn-outline-danger" onClick={() => setConfirm(true)}>
            <FontAwesomeIcon icon={faTrash} className="me-2" />Delete board
          </button>
        </div>
      )}
      {confirm && (
        <ConfirmModal
          title="Delete this board?"
          message={`"${board.title}" and all its lists, cards and comments will be permanently deleted for every member.`}
          confirmLabel="Delete board"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            try {
              await boardsApi.remove(board.id);
              onDeleted();
            } catch (err) {
              toast.error(errorMessage(err));
              throw err;
            }
          }}
        />
      )}
    </Modal>
  );
}

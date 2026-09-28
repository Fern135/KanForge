import { useCallback, useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTag, faClock, faAlignLeft, faSquareCheck, faComments, faTrash, faXmark, faPlus, faCheck, faFileImport,
} from '@fortawesome/free-solid-svg-icons';
import Modal from '../../../core/components/Modal';
import Avatar from '../../../core/components/Avatar';
import EditableText from '../../../core/components/EditableText';
import ConfirmModal from '../../../core/components/ConfirmModal';
import { cardsApi } from '../api';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { useAuth } from '../../../core/context/AuthContext';
import { MAX_CHECKLIST, parseChecklistImport } from '../utils/checklistImport';
import { dueStatus, fromLocalInput, fullDate, timeAgo, toLocalInput } from '../../../core/utils/dates';

function Section({ icon, title, children, action }) {
  return (
    <section className="mb-4">
      <div className="d-flex align-items-center mb-2">
        <div className="section-title mb-0 flex-grow-1">
          <FontAwesomeIcon icon={icon} className="me-2" />{title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function CardModal({ boardId, card, listTitle, labels, role, onChange, onDelete, onClose }) {
  const toast = useToast();
  const { user } = useAuth();
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(card.description);
  const [pickLabels, setPickLabels] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!editingDesc) setDesc(card.description);
  }, [card.description, editingDesc]);

  useEffect(() => {
    let alive = true;
    cardsApi.comments(boardId, card.id)
      .then((d) => alive && setComments(d.comments))
      .catch(() => alive && setComments([]));
    return () => {
      alive = false;
    };
  }, [boardId, card.id]);

  const run = useCallback(
    async (fn) => {
      try {
        const data = await fn();
        if (data?.card) onChange(data.card);
        return data;
      } catch (err) {
        toast.error(errorMessage(err));
        throw err;
      }
    },
    [onChange, toast],
  );

  const update = (body) => run(() => cardsApi.update(boardId, card.id, body));

  const toggleLabel = (id) => {
    const next = card.labels.includes(id) ? card.labels.filter((l) => l !== id) : [...card.labels, id];
    onChange({ ...card, labels: next });
    update({ labels: next }).catch(() => onChange(card));
  };

  const saveDescription = async () => {
    await update({ description: desc.trim() }).catch(() => {});
    setEditingDesc(false);
  };

  const addItem = async (e) => {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    await run(() => cardsApi.addChecklistItem(boardId, card.id, text)).then(() => setNewItem('')).catch(() => {});
  };

  const parsedImport = useMemo(() => {
    try {
      return { items: parseChecklistImport(importText) };
    } catch (err) {
      return { error: err.message };
    }
  }, [importText]);
  const room = MAX_CHECKLIST - card.checklist.length;
  const importError = parsedImport.error
    || (parsedImport.items.length > room ? `Only ${room} more item${room === 1 ? '' : 's'} fit (limit ${MAX_CHECKLIST})` : null);

  const closeImport = () => {
    setImporting(false);
    setImportText('');
  };

  const importItems = async () => {
    if (importError || !parsedImport.items.length) return;
    setImportBusy(true);
    try {
      await run(() => cardsApi.importChecklist(boardId, card.id, parsedImport.items));
      toast.success(`Imported ${parsedImport.items.length} item${parsedImport.items.length === 1 ? '' : 's'}`);
      closeImport();
    } catch {
      // run() already showed the error.
    } finally {
      setImportBusy(false);
    }
  };

  const setChecklistSetting = (body) => {
    onChange({ ...card, ...body });
    return update(body).catch(() => onChange(card));
  };

  const toggleItem = (item) => {
    onChange({ ...card, checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) });
    run(() => cardsApi.updateChecklistItem(boardId, card.id, item.id, { done: !item.done })).catch(() => onChange(card));
  };

  const addComment = async (e) => {
    e.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    try {
      const { comment } = await cardsApi.addComment(boardId, card.id, text);
      setComments((c) => [comment, ...(c || [])]);
      setCommentText('');
      onChange({ ...card, commentCount: card.commentCount + 1 });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removeComment = async (id) => {
    try {
      await cardsApi.removeComment(boardId, card.id, id);
      setComments((c) => c.filter((x) => x.id !== id));
      onChange({ ...card, commentCount: Math.max(0, card.commentCount - 1) });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const done = card.checklist.filter((i) => i.done).length;
  const pct = card.checklist.length ? Math.round((done / card.checklist.length) * 100) : 0;
  const visibleItems = card.checklistHideDone ? card.checklist.filter((i) => !i.done) : card.checklist;
  const status = dueStatus(card);
  const selected = labels.filter((l) => card.labels.includes(l.id));

  return (
    <Modal
      className="card-modal"
      title={
        <EditableText
          value={card.title}
          maxLength={200}
          ariaLabel="Card title"
          inputClassName="form-control fw-bold"
          onSave={(title) => update({ title })}
        />
      }
      onClose={onClose}
    >
      <p className="text-muted small mt-n2 mb-4">in list <strong>{listTitle}</strong></p>

      <div className="row g-4">
        <div className="col-12 col-md-6">
          <Section
            icon={faTag}
            title="Labels"
            action={<button type="button" className="icon-btn small" onClick={() => setPickLabels((p) => !p)}>{pickLabels ? 'Done' : 'Edit'}</button>}
          >
            <div className="d-flex flex-wrap gap-1">
              {(pickLabels ? labels : selected).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  disabled={!pickLabels}
                  onClick={() => toggleLabel(l.id)}
                  aria-pressed={card.labels.includes(l.id)}
                  className={`label-pill label-${l.color} ${pickLabels ? 'selectable' : ''} ${card.labels.includes(l.id) ? 'selected' : ''}`}
                >
                  {pickLabels && card.labels.includes(l.id) && <FontAwesomeIcon icon={faCheck} />}
                  {l.name || ' '}
                </button>
              ))}
              {!pickLabels && selected.length === 0 && <span className="text-muted small">No labels</span>}
            </div>
          </Section>
        </div>
        <div className="col-12 col-md-6">
          <Section icon={faClock} title="Due date">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <input
                type="datetime-local"
                className="form-control form-control-sm"
                style={{ maxWidth: 220 }}
                value={toLocalInput(card.dueDate)}
                onChange={(e) => update({ dueDate: fromLocalInput(e.target.value) }).catch(() => {})}
                aria-label="Due date"
              />
              {card.dueDate && (
                <>
                  <div className="form-check mb-0">
                    <input className="form-check-input" type="checkbox" id="due-done" checked={card.dueComplete}
                      onChange={(e) => update({ dueComplete: e.target.checked }).catch(() => {})} />
                    <label className="form-check-label small" htmlFor="due-done">Complete</label>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Clear due date" onClick={() => update({ dueDate: null, dueComplete: false }).catch(() => {})}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </>
              )}
            </div>
            {status && status !== 'upcoming' && (
              <span className={`badge-due ${status} small d-inline-block mt-2`}>
                {status === 'overdue' ? 'Overdue' : status === 'soon' ? 'Due soon' : 'Complete'} · {fullDate(card.dueDate)}
              </span>
            )}
          </Section>
        </div>
      </div>

      <Section icon={faAlignLeft} title="Description">
        {editingDesc ? (
          <>
            <textarea
              className="form-control mb-2"
              rows={6}
              maxLength={5000}
              value={desc}
              autoFocus
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Add a more detailed description…"
            />
            <div className="d-flex gap-2 align-items-center">
              <button type="button" className="btn btn-primary btn-sm" onClick={saveDescription}>Save</button>
              <button type="button" className="btn btn-light btn-sm" onClick={() => { setDesc(card.description); setEditingDesc(false); }}>Cancel</button>
              <small className="text-muted ms-auto">{desc.length}/5000</small>
            </div>
          </>
        ) : (
          // Rendered as a text node, never as HTML, so it can't carry XSS.
          <div className="description-view" role="button" tabIndex={0} onClick={() => setEditingDesc(true)}
            onKeyDown={(e) => e.key === 'Enter' && setEditingDesc(true)}>
            {card.description || <span className="text-muted">Add a more detailed description…</span>}
          </div>
        )}
      </Section>

      <Section
        icon={faSquareCheck}
        title={
          <>
            <EditableText
              value={card.checklistTitle}
              maxLength={100}
              ariaLabel="Checklist title"
              inputClassName="form-control form-control-sm d-inline-block w-auto"
              onSave={(checklistTitle) => update({ checklistTitle })}
            />
            {card.checklist.length > 0 && ` · ${pct}%`}
          </>
        }
        action={
          <div className="d-flex align-items-center gap-3">
            {done > 0 && (
              <div className="form-check mb-0 small">
                <input className="form-check-input" type="checkbox" id="checklist-hide-done" checked={card.checklistHideDone}
                  onChange={(e) => setChecklistSetting({ checklistHideDone: e.target.checked })} />
                <label className="form-check-label" htmlFor="checklist-hide-done">Hide when done</label>
              </div>
            )}
            <button type="button" className="icon-btn small" onClick={() => (importing ? closeImport() : setImporting(true))}>
              {importing ? 'Cancel' : <><FontAwesomeIcon icon={faFileImport} className="me-1" />Import</>}
            </button>
          </div>
        }
      >
        {importing && (
          <div className="mb-3">
            <textarea
              className="form-control form-control-sm font-monospace mb-1"
              rows={6}
              autoFocus
              aria-label="Items to import"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'["Buy milk", {"text": "Call Ana", "done": true}]\n\nor one item per line:\n- [ ] Buy milk\n- [x] Call Ana'}
            />
            <div className="d-flex align-items-center gap-2">
              <small className={`flex-grow-1 ${importError ? 'text-danger' : 'text-muted'}`}>
                {importError || (parsedImport.items.length
                  ? `${parsedImport.items.length} item${parsedImport.items.length === 1 ? '' : 's'} ready`
                  : 'Paste a JSON array or one item per line')}
              </small>
              <button type="button" className="btn btn-primary btn-sm" onClick={importItems}
                disabled={importBusy || Boolean(importError) || !parsedImport.items.length}>
                Import
              </button>
            </div>
          </div>
        )}
        {card.checklist.length > 0 && (
          <div className="progress checklist-progress mb-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
        <ul className="list-unstyled mb-2">
          {visibleItems.map((item) => (
            <li key={item.id} className="d-flex align-items-center gap-2 py-1">
              <input className="form-check-input mt-0" type="checkbox" checked={item.done} onChange={() => toggleItem(item)} aria-label={item.text} />
              <span className={`flex-grow-1 text-break ${item.done ? 'text-decoration-line-through text-muted' : ''}`}>{item.text}</span>
              <button type="button" className="icon-btn" aria-label="Delete item"
                onClick={() => run(() => cardsApi.removeChecklistItem(boardId, card.id, item.id)).catch(() => {})}>
                <FontAwesomeIcon icon={faTrash} size="sm" />
              </button>
            </li>
          ))}
        </ul>
        {card.checklistHideDone && done > 0 && (
          <p className="text-muted small mb-2">{done} completed item{done === 1 ? '' : 's'} hidden</p>
        )}
        <form onSubmit={addItem} className="d-flex gap-2">
          <input className="form-control form-control-sm" placeholder="Add an item" maxLength={200} value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!newItem.trim()} aria-label="Add item">
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </form>
      </Section>

      <Section icon={faComments} title="Comments">
        <form onSubmit={addComment} className="d-flex gap-2 mb-3">
          <Avatar name={user?.name} small />
          <div className="flex-grow-1">
            <textarea className="form-control form-control-sm mb-2" rows={2} maxLength={2000} placeholder="Write a comment…"
              value={commentText} onChange={(e) => setCommentText(e.target.value)} />
            {commentText.trim() && <button type="submit" className="btn btn-sm btn-primary">Comment</button>}
          </div>
        </form>
        {comments === null && <div className="text-muted small">Loading comments…</div>}
        {comments?.map((c) => (
          <div key={c.id} className="comment mb-2">
            <Avatar name={c.author.name} small />
            <div className="flex-grow-1">
              <div className="small mb-1">
                <strong>{c.author.name}</strong> <span className="text-muted">{timeAgo(c.createdAt)}</span>
                {(c.author.id === user?.id || role === 'owner') && (
                  <button type="button" className="btn btn-link btn-sm p-0 ms-2 text-muted" onClick={() => removeComment(c.id)}>Delete</button>
                )}
              </div>
              <div className="comment-body small">{c.text}</div>
            </div>
          </div>
        ))}
      </Section>

      <div className="border-top pt-3 d-flex justify-content-end">
        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setConfirmDelete(true)}>
          <FontAwesomeIcon icon={faTrash} className="me-2" />Delete card
        </button>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete card?"
          message="The card, its checklist and comments will be permanently deleted."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await cardsApi.remove(boardId, card.id);
              onDelete(card.id);
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

'use strict';

// Explicit allow-list output shapes: internal fields never leak by accident.
const id = (v) => (v == null ? null : String(v));

const label = (l) => ({ id: id(l._id), name: l.name, color: l.color });

const list = (l) => ({ id: id(l._id), title: l.title, position: l.position });

const card = (c) => ({
  id: id(c._id),
  listId: id(c.list),
  title: c.title,
  description: c.description || '',
  position: c.position,
  labels: (c.labels || []).map(id),
  dueDate: c.dueDate ? new Date(c.dueDate).toISOString() : null,
  dueComplete: Boolean(c.dueComplete),
  checklist: (c.checklist || []).map((i) => ({ id: id(i._id), text: i.text, done: Boolean(i.done) })),
  checklistTitle: c.checklistTitle || 'Checklist',
  checklistHideDone: Boolean(c.checklistHideDone),
  commentCount: c.commentCount || 0,
});

const comment = (c) => ({
  id: id(c._id),
  cardId: id(c.card),
  text: c.text,
  createdAt: new Date(c.createdAt).toISOString(),
  author: c.author && c.author._id
    ? { id: id(c.author._id), name: c.author.name }
    : { id: id(c.author), name: 'Unknown' },
});

const boardSummary = (b, userId) => ({
  id: id(b._id),
  title: b.title,
  background: b.background,
  role: b.members.find((m) => id(m.user) === userId)?.role ?? 'member',
  memberCount: b.members.length,
});

module.exports = { id, label, list, card, comment, boardSummary };

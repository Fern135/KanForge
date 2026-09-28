import api from '../../core/api/client';

const b = (boardId) => `/boards/${encodeURIComponent(boardId)}`;
const c = (boardId, cardId) => `${b(boardId)}/cards/${encodeURIComponent(cardId)}`;
const data = (p) => p.then((r) => r.data);

export const boardsApi = {
  list: () => data(api.get('/boards')),
  create: (body) => data(api.post('/boards', body)),
  get: (id) => data(api.get(b(id))),
  update: (id, body) => data(api.patch(b(id), body)),
  remove: (id) => api.delete(b(id)),
  addMember: (id, email) => data(api.post(`${b(id)}/members`, { email })),
  removeMember: (id, userId) => api.delete(`${b(id)}/members/${encodeURIComponent(userId)}`),
  addLabel: (id, body) => data(api.post(`${b(id)}/labels`, body)),
  updateLabel: (id, labelId, body) => data(api.patch(`${b(id)}/labels/${encodeURIComponent(labelId)}`, body)),
  removeLabel: (id, labelId) => api.delete(`${b(id)}/labels/${encodeURIComponent(labelId)}`),
};

export const listsApi = {
  create: (boardId, title) => data(api.post(`${b(boardId)}/lists`, { title })),
  rename: (boardId, listId, title) => data(api.patch(`${b(boardId)}/lists/${encodeURIComponent(listId)}`, { title })),
  move: (boardId, listId, index) => data(api.put(`${b(boardId)}/lists/${encodeURIComponent(listId)}/move`, { index })),
  remove: (boardId, listId) => api.delete(`${b(boardId)}/lists/${encodeURIComponent(listId)}`),
};

export const cardsApi = {
  create: (boardId, listId, title) => data(api.post(`${b(boardId)}/cards`, { listId, title })),
  importCards: (boardId, listId, cards) => data(api.post(`${b(boardId)}/cards/bulk`, { listId, cards })),
  update: (boardId, cardId, body) => data(api.patch(c(boardId, cardId), body)),
  move: (boardId, cardId, listId, index) => data(api.put(`${c(boardId, cardId)}/move`, { listId, index })),
  remove: (boardId, cardId) => api.delete(c(boardId, cardId)),
  addChecklistItem: (boardId, cardId, text) => data(api.post(`${c(boardId, cardId)}/checklist`, { text })),
  importChecklist: (boardId, cardId, items) => data(api.post(`${c(boardId, cardId)}/checklist/bulk`, { items })),
  updateChecklistItem: (boardId, cardId, itemId, body) =>
    data(api.patch(`${c(boardId, cardId)}/checklist/${encodeURIComponent(itemId)}`, body)),
  removeChecklistItem: (boardId, cardId, itemId) =>
    data(api.delete(`${c(boardId, cardId)}/checklist/${encodeURIComponent(itemId)}`)),
  comments: (boardId, cardId) => data(api.get(`${c(boardId, cardId)}/comments`)),
  addComment: (boardId, cardId, text) => data(api.post(`${c(boardId, cardId)}/comments`, { text })),
  removeComment: (boardId, cardId, commentId) =>
    api.delete(`${c(boardId, cardId)}/comments/${encodeURIComponent(commentId)}`),
};

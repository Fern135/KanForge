import { MAX_CHECKLIST, checklistFromJson, checklistLine } from './checklistImport';

export const MAX_IMPORT_CARDS = 100;
export const MAX_CARDS_PER_LIST = 500;

const FIELDS = new Set([
  'title', 'description', 'labels', 'dueDate', 'dueComplete', 'checklistTitle', 'checklistHideDone', 'checklist',
]);
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// "2026-10-15" means the end of that day in local time; anything else must be a full date-time.
function parseDue(value, where) {
  const m = typeof value === 'string' && value.match(DATE_ONLY);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59) : new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) {
    throw new Error(`${where}: "dueDate" must be a date like "2026-10-15" or "2026-10-15T17:00"`);
  }
  return d.toISOString();
}

function text(value, field, max, where, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new Error(`${where}: "${field}" must be text`);
  const v = value.trim();
  if (required && !v) throw new Error(`${where}: "${field}" can't be empty`);
  if (v.length > max) throw new Error(`${where}: "${field}" is longer than ${max} characters`);
  return v;
}

function bool(value, field, where) {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${where}: "${field}" must be true or false`);
  return value;
}

function cardFromJson(entry, where, labelIds) {
  if (typeof entry === 'string') entry = { title: entry };
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${where} must be a title or an object with a "title" field`);
  }
  const unknown = Object.keys(entry).find((k) => !FIELDS.has(k));
  if (unknown) throw new Error(`${where}: unknown field "${unknown}"`);

  const card = { title: text(entry.title, 'title', 200, where, { required: true }) };
  const description = text(entry.description, 'description', 5000, where);
  if (description) card.description = description;

  if (entry.labels !== undefined) {
    const names = typeof entry.labels === 'string' ? [entry.labels] : entry.labels;
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
      throw new Error(`${where}: "labels" must be a list of label names`);
    }
    card.labels = names.map((n) => {
      const id = labelIds.get(n.trim().toLowerCase());
      if (!id) throw new Error(`${where}: no label named "${n}" (or with that color) on this board`);
      return id;
    });
  }

  if (entry.dueDate != null) card.dueDate = parseDue(entry.dueDate, where);
  const dueComplete = bool(entry.dueComplete, 'dueComplete', where);
  if (dueComplete !== undefined) card.dueComplete = dueComplete;

  const checklistTitle = text(entry.checklistTitle, 'checklistTitle', 100, where);
  if (checklistTitle) card.checklistTitle = checklistTitle;
  const hideDone = bool(entry.checklistHideDone, 'checklistHideDone', where);
  if (hideDone !== undefined) card.checklistHideDone = hideDone;

  if (entry.checklist !== undefined) {
    if (!Array.isArray(entry.checklist)) throw new Error(`${where}: "checklist" must be a list`);
    card.checklist = checklistFromJson(entry.checklist, `${where}, checklist item`);
  }
  return card;
}

// Unindented lines are card titles; indented lines are checklist items of the card above.
function cardsFromLines(input) {
  const cards = [];
  input.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    if (/^\s/.test(line)) {
      const card = cards[cards.length - 1];
      if (!card) throw new Error(`Line ${i + 1}: an indented checklist item needs a card title above it`);
      const item = checklistLine(line);
      if (item.text.trim()) (card.checklist ||= []).push(item);
    } else {
      cards.push({ title: checklistLine(line).text });
    }
  });
  return cards;
}

// Parses pasted JSON (a list of cards, or { "cards": [...] }), or plain text
// with one card per line. `labels` are the board's labels, matched by name,
// then by color (so unnamed labels can be used too).
// Returns cards ready for the API; throws an Error with a user-facing message.
export function parseCardImport(input, labels) {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const labelIds = new Map();
  for (const l of labels) if (!labelIds.has(l.color)) labelIds.set(l.color, l.id);
  for (const l of labels) if (l.name) labelIds.set(l.name.trim().toLowerCase(), l.id);

  let entries;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let value;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid JSON');
    }
    entries = Array.isArray(value) ? value : value?.cards;
    if (!Array.isArray(entries)) throw new Error('JSON must be an array of cards, or an object with a "cards" array');
  } else {
    entries = cardsFromLines(input);
  }

  const cards = entries.map((entry, i) => cardFromJson(entry, `Card ${i + 1}`, labelIds));
  if (cards.length > MAX_IMPORT_CARDS) throw new Error(`You can import at most ${MAX_IMPORT_CARDS} cards at a time`);
  const big = cards.findIndex((c) => (c.checklist?.length || 0) > MAX_CHECKLIST);
  if (big !== -1) throw new Error(`Card ${big + 1}: a checklist can hold at most ${MAX_CHECKLIST} items`);
  return cards;
}

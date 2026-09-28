export const MAX_CHECKLIST = 100;
const MAX_TEXT = 200;

// Leading "- ", "* ", "1. " and an optional "[ ]" / "[x]" box, as in Markdown task lists.
const LINE = /^\s*(?:[-*+]|\d+[.)])?\s*(?:\[([ xX])\]\s*)?(.*)$/;

// Turns a JSON list of strings / { text, done } objects into clean checklist items.
export function checklistFromJson(list, where = 'Item') {
  const items = list.map((entry, i) => {
    if (typeof entry === 'string') return { text: entry, done: false };
    if (entry && typeof entry.text === 'string') return { text: entry.text, done: entry.done === true };
    throw new Error(`${where} ${i + 1} must be a string or an object with a "text" field`);
  });
  return clean(items, where);
}

// Reads one Markdown-ish line ("- [x] text") as a checklist item.
export function checklistLine(line) {
  const [, box, text] = line.match(LINE);
  return { text, done: box === 'x' || box === 'X' };
}

function clean(items, where) {
  const out = items.map((i) => ({ text: i.text.trim(), done: i.done })).filter((i) => i.text);
  const long = out.findIndex((i) => i.text.length > MAX_TEXT);
  if (long !== -1) throw new Error(`${where} ${long + 1} is longer than ${MAX_TEXT} characters`);
  return out;
}

// Parses pasted JSON, or falls back to one item per line. Returns clean
// { text, done } items; throws an Error with a user-facing message.
export function parseChecklistImport(input) {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return clean(trimmed.split(/\r?\n/).map(checklistLine), 'Item');
  }
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error('Invalid JSON');
  }
  const list = Array.isArray(value) ? value : value?.items;
  if (!Array.isArray(list)) throw new Error('JSON must be an array, or an object with an "items" array');
  return checklistFromJson(list);
}

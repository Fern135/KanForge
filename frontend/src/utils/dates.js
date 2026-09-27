const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtFull = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const shortDate = (iso) => fmt.format(new Date(iso));
export const fullDate = (iso) => fmtFull.format(new Date(iso));

export function dueStatus(card) {
  if (!card.dueDate) return null;
  if (card.dueComplete) return 'done';
  const diff = new Date(card.dueDate).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 24 * 3600 * 1000) return 'soon';
  return 'upcoming';
}

// <input type="datetime-local"> speaks local time without a zone.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return shortDate(iso);
}

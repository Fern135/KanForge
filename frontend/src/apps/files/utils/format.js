import {
  faFolder, faFile, faFileImage, faFileVideo, faFileAudio, faFilePdf, faFileWord, faFileExcel, faFilePowerpoint,
  faFileZipper, faFileCode, faFileLines,
} from '@fortawesome/free-solid-svg-icons';

// How sizes, types and icons are shown in the Files app.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

// 1536 → "1.5 KB". Whole numbers for bytes, one decimal above.
export function formatBytes(bytes) {
  if (bytes == null) return '';
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? n : Number(n.toFixed(n < 10 ? 1 : 0))} ${UNITS[unit]}`;
}

const GB = 1024 ** 3;
// For admin forms, where limits are typed in GB.
export const toGb = (bytes) => (bytes == null ? '' : String(Number((bytes / GB).toFixed(2))));
export const fromGb = (text) => (text.trim() === '' ? null : Math.round(Number(text) * GB));

const ext = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

const BY_EXT = {
  doc: faFileWord, docx: faFileWord, odt: faFileWord, rtf: faFileWord,
  xls: faFileExcel, xlsx: faFileExcel, ods: faFileExcel, csv: faFileExcel,
  ppt: faFilePowerpoint, pptx: faFilePowerpoint, odp: faFilePowerpoint,
  zip: faFileZipper, rar: faFileZipper, '7z': faFileZipper, gz: faFileZipper, tar: faFileZipper,
  js: faFileCode, jsx: faFileCode, ts: faFileCode, py: faFileCode, json: faFileCode, html: faFileCode, css: faFileCode, sh: faFileCode,
  md: faFileLines, txt: faFileLines,
};

// The icon for a file or folder, from its type or, failing that, its extension.
export function iconFor(item) {
  if (item.kind === 'folder') return faFolder;
  const mime = item.mime || '';
  if (mime.startsWith('image/')) return faFileImage;
  if (mime.startsWith('video/')) return faFileVideo;
  if (mime.startsWith('audio/')) return faFileAudio;
  if (mime === 'application/pdf') return faFilePdf;
  return BY_EXT[ext(item.name)] || (mime.startsWith('text/') ? faFileLines : faFile);
}

// A colour per kind of file, so a list is easy to scan (like Drive's icons).
export function iconColor(item) {
  if (item.kind === 'folder') return '#d9a441';
  const icon = iconFor(item);
  if (icon === faFileImage) return '#d9534f';
  if (icon === faFileVideo) return '#c0392b';
  if (icon === faFileAudio) return '#8e44ad';
  if (icon === faFilePdf) return '#e74c3c';
  if (icon === faFileWord) return '#2a78d6';
  if (icon === faFileExcel) return '#1e8449';
  if (icon === faFilePowerpoint) return '#eb6834';
  return '#6b7686';
}

// What the preview can show in the page. These match the types the API is
// willing to serve inline (backend files/download.js); anything else downloads.
export function previewKind(item) {
  if (item.kind !== 'file') return null;
  const mime = item.mime || '';
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'].includes(mime)) return 'image';
  if (['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'].includes(mime)) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/plain') return 'text';
  return null;
}

// The browser leaves the type empty for many files (it only knows common
// extensions). A few more are filled in so they preview and get the right icon.
const EXTRA_TYPES = {
  md: 'text/plain', log: 'text/plain', txt: 'text/plain', csv: 'text/csv', mov: 'video/quicktime', mkv: 'video/x-matroska',
};
export const mimeOf = (file) => file.type || EXTRA_TYPES[ext(file.name)] || 'application/octet-stream';

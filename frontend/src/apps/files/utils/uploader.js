import { useSyncExternalStore } from 'react';
import api, { errorMessage } from '../../../core/api/client';
import { mimeOf } from './format';
import { thumbnailAfterUpload } from './thumbnails';

// Uploads, Google Drive style: files (and whole folders) go into a queue, a few
// upload at once, and a panel shows each one's progress. One queue for the page,
// so uploads keep going while the person browses other folders.
//
// Each file goes up the way the API expects (backend files/uploads.js): start it,
// send its parts, then complete it. A part that fails on a flaky connection is
// sent again a few times before the file is marked as failed.

const FILES_AT_ONCE = 3;
const PART_ATTEMPTS = 4;
// Generous: a part is a few MB, which can take a while on a slow connection.
const PART_TIMEOUT_MS = 120_000;

let nextId = 1;
let items = [];
const listeners = new Set();
// Called with the folder id an upload finished in, so the page can refresh it.
const doneListeners = new Set();

const emit = () => {
  items = [...items];
  listeners.forEach((fn) => fn());
};
const update = (item, changes) => {
  Object.assign(item, changes);
  emit();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCancel = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
// Worth another try: the network dropped, the server hiccuped or asked us to slow down.
const retryable = (err) => !err.response || err.response.status >= 500 || err.response.status === 429;

// Sends one part, trying again (with growing pauses) when that might help.
async function sendPart(item, uploadId, n, blob, onProgress) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await api.put(`/files/uploads/${uploadId}/parts/${n}`, blob, {
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: PART_TIMEOUT_MS,
        signal: item.abort.signal,
        onUploadProgress: (e) => onProgress(e.loaded),
      });
      return;
    } catch (err) {
      if (isCancel(err) || attempt >= PART_ATTEMPTS || !retryable(err)) throw err;
      onProgress(0);
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

async function run(item) {
  update(item, { status: 'uploading' });
  const { file } = item;
  try {
    const start = (await api.post('/files/uploads', {
      name: file.name, size: file.size, mime: mimeOf(file), parentId: item.parentId,
    }, { signal: item.abort.signal })).data;
    let uploaded = start.item;
    if (!start.done) {
      const { id, partSize, partCount } = start.upload;
      item.uploadId = id;
      // Bytes sent so far for each part, so overall progress survives retries.
      const sent = new Array(partCount + 1).fill(0);
      const progress = () => update(item, { loaded: sent.reduce((a, b) => a + b, 0) });
      for (let n = 1; n <= partCount; n += 1) {
        const blob = file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
        await sendPart(item, id, n, blob, (loaded) => {
          sent[n] = loaded;
          progress();
        });
        sent[n] = blob.size;
        progress();
      }
      uploaded = (await api.post(`/files/uploads/${id}/complete`, undefined, { signal: item.abort.signal })).data.item;
    }
    update(item, { status: 'done', loaded: file.size });
    doneListeners.forEach((fn) => fn(item.parentId));
    // Its grid-view preview, made from the copy still in the browser.
    thumbnailAfterUpload(file, uploaded);
  } catch (err) {
    if (isCancel(err) || item.status === 'cancelled') return;
    update(item, { status: 'error', error: errorMessage(err, 'Upload failed') });
    // Leave nothing half-uploaded behind (the server would clean it up after a day anyway).
    if (item.uploadId) api.delete(`/files/uploads/${item.uploadId}`).catch(() => {});
  }
}

// Starts queued uploads while fewer than FILES_AT_ONCE are running.
function pump() {
  const running = items.filter((i) => i.status === 'uploading').length;
  const next = items.filter((i) => i.status === 'queued').slice(0, Math.max(0, FILES_AT_ONCE - running));
  for (const item of next) run(item).finally(pump);
}

// Queues files. entries: [{ file, parentId }].
export function enqueue(entries) {
  for (const { file, parentId } of entries) {
    items.push({
      id: nextId++, file, name: file.name, size: file.size, parentId, loaded: 0, status: 'queued', error: null, abort: new AbortController(),
    });
  }
  emit();
  pump();
}

export function cancel(id) {
  const item = items.find((i) => i.id === id);
  if (!item || !['queued', 'uploading'].includes(item.status)) return;
  item.abort.abort();
  if (item.uploadId) api.delete(`/files/uploads/${item.uploadId}`).catch(() => {});
  update(item, { status: 'cancelled' });
  pump();
}

export function cancelAll() {
  items.filter((i) => ['queued', 'uploading'].includes(i.status)).forEach((i) => cancel(i.id));
}

// Tries a failed upload again from the start.
export function retry(id) {
  const item = items.find((i) => i.id === id);
  if (!item || item.status !== 'error') return;
  update(item, { status: 'queued', loaded: 0, error: null, uploadId: null, abort: new AbortController() });
  pump();
}

// Clears finished, failed and cancelled uploads from the panel.
export function clearFinished() {
  items = items.filter((i) => ['queued', 'uploading'].includes(i.status));
  emit();
}

export const onUploaded = (fn) => {
  doneListeners.add(fn);
  return () => doneListeners.delete(fn);
};

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
// The queue, for the upload panel. Re-renders whenever anything in it changes.
export const useUploads = () => useSyncExternalStore(subscribe, () => items);

// Asks before the tab closes while uploads are still running (they'd be lost).
window.addEventListener('beforeunload', (e) => {
  if (items.some((i) => ['queued', 'uploading'].includes(i.status))) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Folders ----------

// Uploads files that came with folder paths (from the folder picker or a dropped
// folder): [{ file, path: ['Photos', '2024'] }], plus empty folders as
// [{ dir: ['Photos', 'Empty'] }]. Folders are created first, under `parentId`,
// then every file is queued into its folder.
export async function enqueueTree(entries, parentId) {
  const ids = new Map([['', parentId]]);
  // Creates each folder on a path once, parents before children.
  async function folderFor(path) {
    let key = '';
    for (const name of path) {
      const parentKey = key;
      key = key ? `${key}/${name}` : name;
      if (!ids.has(key)) {
        const { item } = (await api.post('/files/folders', { name, parentId: ids.get(parentKey) })).data;
        ids.set(key, item.id);
      }
    }
    return ids.get(key);
  }
  const files = [];
  for (const entry of entries) {
    if (entry.dir) await folderFor(entry.dir);
    else files.push({ file: entry.file, parentId: await folderFor(entry.path) });
  }
  enqueue(files);
}

// What the folder picker (<input webkitdirectory>) gave: each file knows its
// path ("Photos/2024/a.jpg") in webkitRelativePath.
export const entriesFromPicker = (fileList) => [...fileList].map((file) => ({
  file,
  path: (file.webkitRelativePath || file.name).split('/').slice(0, -1),
}));

// What was dropped onto the page, folders included. Must be called straight
// from the drop event: the browser only hands out the entries during it.
export function readDrop(dataTransfer) {
  const roots = [...(dataTransfer.items || [])]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean);
  // Browsers without the entries API: plain files only.
  if (!roots.length) return Promise.resolve([...dataTransfer.files].map((file) => ({ file, path: [] })));
  return (async () => {
    const out = [];
    for (const root of roots) await walk(root, [], out);
    return out;
  })();
}

async function walk(entry, path, out) {
  if (entry.isFile) {
    out.push({ file: await new Promise((resolve, reject) => entry.file(resolve, reject)), path });
    return;
  }
  if (!entry.isDirectory) return;
  const here = [...path, entry.name];
  const reader = entry.createReader();
  let empty = true;
  // readEntries returns a folder's contents in batches until it returns none.
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    empty = false;
    for (const child of batch) await walk(child, here, out);
  }
  if (empty) out.push({ dir: here });
}

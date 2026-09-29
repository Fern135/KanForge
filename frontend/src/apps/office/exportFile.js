import { officeApi } from './api';

// Office documents as files: Word (.docx) for documents, Excel (.xlsx) for
// spreadsheets. Several at once come as one .zip. The converters load only when used.

const UNTITLED = { doc: 'Untitled document', sheet: 'Untitled spreadsheet' };
const EXT = { doc: 'docx', sheet: 'xlsx' };

export const safeFileName = (title, kind) => (title || UNTITLED[kind] || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || UNTITLED[kind];

export const canExport = (kind) => Boolean(EXT[kind]);

// A saved document → { blob, name }.
export async function exportDocument(docId) {
  const { document: d } = await officeApi.get(docId);
  let blob;
  if (d.kind === 'doc') {
    const { exportDocx } = await import('./docs/exportDocx');
    blob = await exportDocx({ content: d.content, settings: d.settings, title: d.title });
  } else if (d.kind === 'sheet') {
    const [{ exportXlsx }, { fromContent }, { Engine }] = await Promise.all([
      import('./sheets/xlsx'), import('./sheets/model'), import('./sheets/formula/engine'),
    ]);
    const wb = fromContent(d.content);
    blob = exportXlsx(wb, new Engine(wb), d.title);
  } else {
    throw new Error('This kind of document can\'t be downloaded yet');
  }
  return { blob, name: `${safeFileName(d.title, d.kind)}.${EXT[d.kind]}` };
}

// Several documents → one .zip. Names that repeat get " (2)", " (3)"…
// onProgress(done, total) is called as each one is ready.
export async function exportZip(docIds, onProgress) {
  const { zipSync } = await import('fflate');
  const files = {};
  const used = new Set();
  let done = 0;
  const failed = [];
  for (const id of docIds) {
    try {
      const { blob, name } = await exportDocument(id);
      let unique = name;
      const dot = name.lastIndexOf('.');
      for (let n = 2; used.has(unique.toLowerCase()); n += 1) unique = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
      used.add(unique.toLowerCase());
      files[unique] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    } catch {
      failed.push(id);
    }
    done += 1;
    onProgress?.(done, docIds.length);
  }
  if (!Object.keys(files).length) throw new Error('None of these documents could be downloaded');
  return { blob: new Blob([zipSync(files)], { type: 'application/zip' }), failed: failed.length };
}

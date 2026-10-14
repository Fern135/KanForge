import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
// The worker is bundled as a file of this site, which the Content-Security-Policy allows.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { THUMB_WIDTH, makeCanvas, canvasToThumb } from '../thumbnails';

// A PDF's preview: its first page, drawn by pdf.js (Mozilla's PDF viewer, the
// one inside Firefox). Loaded only when a PDF needs a preview.

GlobalWorkerOptions.workerSrc = workerUrl;

// Pages taller than this (a long receipt, say) are cut off at the bottom.
const MAX_HEIGHT = THUMB_WIDTH * 2;

export async function pdfThumb(file) {
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Fonts the PDF doesn't embed come from the system rather than being
    // downloaded: close enough for a thumbnail.
    useSystemFonts: true,
    // A slightly damaged PDF still gets a preview of whatever can be drawn.
    stopAtErrors: false,
  });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
    // PDFs are drawn onto white, like paper: many have no background of their own.
    const { canvas, ctx } = makeCanvas(viewport.width, Math.min(viewport.height, MAX_HEIGHT));
    await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    return await canvasToThumb(canvas);
  } finally {
    // Frees the worker's copy of the document.
    task.destroy();
  }
}

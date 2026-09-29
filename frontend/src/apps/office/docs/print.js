import { pageBox } from './fonts';

// Prints the document (or saves it as PDF from the print dialog) with the
// document's own paper size and margins. docs.scss hides everything else.
export function printDocument(settings, title) {
  const box = pageBox(settings);
  const m = settings.margins;
  const style = document.createElement('style');
  style.textContent = `@page { size: ${box.width}mm ${box.height}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
  document.head.appendChild(style);
  const previousTitle = document.title;
  // Browsers suggest the page title as the PDF's file name.
  document.title = title || 'Untitled document';
  document.body.classList.add('doc-printing');
  const done = () => {
    document.body.classList.remove('doc-printing');
    style.remove();
    document.title = previousTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

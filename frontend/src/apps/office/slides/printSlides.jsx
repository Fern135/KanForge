import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import SlideView, { loadImage } from './SlideView';
import { deckImageIds, slideSize } from './model';

// Prints the deck, or saves it as PDF from the print dialog: one slide per page,
// with pages exactly the slide's size (13.33" × 7.5" for 16:9). slides.scss
// hides everything else while printing.
export async function printSlides(deck, title) {
  // Load every image first, so they render at once and none prints blank.
  await Promise.all(deckImageIds(deck).map((id) => loadImage(id).catch(() => null)));

  const { w: W, h: H } = slideSize(deck);
  // Slide sizes are in points; the page is in CSS pixels at 96 per inch.
  const width = (W * 96) / 72;

  const host = document.createElement('div');
  host.className = 'slides-print';
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => {
    root.render(deck.slides.map((slide) => (
      <div className="slides-print-page" key={slide.id}>
        <SlideView deck={deck} slide={slide} width={width} />
      </div>
    )));
  });
  // Let images decode after mounting.
  await Promise.all([...host.querySelectorAll('img')].map((img) => img.decode?.().catch(() => {})));

  const style = document.createElement('style');
  style.textContent = `@page { size: ${W / 72}in ${H / 72}in; margin: 0; }`;
  document.head.appendChild(style);
  const previousTitle = document.title;
  document.title = title || 'Untitled presentation';
  document.body.classList.add('slides-printing');
  const done = () => {
    document.body.classList.remove('slides-printing');
    root.unmount();
    host.remove();
    style.remove();
    document.title = previousTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

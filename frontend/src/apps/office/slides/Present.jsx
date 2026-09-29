import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faXmark } from '@fortawesome/free-solid-svg-icons';
import SlideView from './SlideView';
import { slideSize } from './model';

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n']);
const PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p']);

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

// Full-screen slide show, like PowerPoint's. Arrow keys, space or a click move
// through the slides; Esc ends the show.
export default function Present({ deck, start, onClose }) {
  const [index, setIndex] = useState(start);
  const root = useRef(null);
  const view = useViewport();
  const { w: W, h: H } = slideSize(deck);
  const width = Math.min(view.w, (view.h * W) / H);
  const last = deck.slides.length - 1;

  const go = useCallback((i) => setIndex(Math.max(0, Math.min(last, i))), [last]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Full screen for as long as the show runs. Leaving full screen (Esc in the
  // browser's own handling) ends the show too.
  useEffect(() => {
    root.current?.requestFullscreen?.().catch(() => {});
    const onFullscreen = () => {
      if (!document.fullscreenElement) onCloseRef.current();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (NEXT.has(e.key)) go(index + 1);
      else if (PREV.has(e.key)) go(index - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(last);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, go, last, onClose]);

  const slide = deck.slides[index];
  return createPortal(
    <div ref={root} className="slide-show" role="dialog" aria-label="Slide show" onClick={() => go(index + 1)}>
      <SlideView deck={deck} slide={slide} width={width} />
      <div className="slide-show-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide"><FontAwesomeIcon icon={faChevronLeft} /></button>
        <span>{index + 1} / {deck.slides.length}</span>
        <button type="button" onClick={() => go(index + 1)} disabled={index === last} aria-label="Next slide"><FontAwesomeIcon icon={faChevronRight} /></button>
        <button type="button" onClick={onClose} aria-label="End slide show"><FontAwesomeIcon icon={faXmark} /></button>
      </div>
    </div>,
    document.body,
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faXmark, faDisplay } from '@fortawesome/free-solid-svg-icons';
import SlideView from './SlideView';
import { animated, slideSize } from './model';

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n']);
const PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p']);
const TRANSITION_MS = 500;

function useViewport(win = window) {
  const [size, setSize] = useState({ w: win.innerWidth, h: win.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: win.innerWidth, h: win.innerHeight });
    win.addEventListener('resize', onResize);
    return () => win.removeEventListener('resize', onResize);
  }, [win]);
  return size;
}

const openLink = (url) => window.open(url, '_blank', 'noopener,noreferrer');

// Where the show is: which slide, and how many of its animations have played.
// Hidden slides are skipped.
function useShow(deck, start) {
  const visible = useMemo(() => {
    const list = deck.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0);
    return list.length ? list : [0];
  }, [deck.slides]);
  const first = visible.find((i) => i >= start) ?? visible[visible.length - 1];
  const [pos, setPos] = useState({ index: first, step: 0, entering: null, from: null });

  const next = useCallback(() => setPos((p) => {
    const anims = animated(deck.slides[p.index]);
    if (p.step < anims.length) return { ...p, step: p.step + 1, entering: { [anims[p.step].id]: anims[p.step].anim }, from: null };
    const after = visible.find((i) => i > p.index);
    return after === undefined ? p : { index: after, step: 0, entering: null, from: p.index };
  }), [deck.slides, visible]);

  const prev = useCallback(() => setPos((p) => {
    if (p.step > 0) return { ...p, step: p.step - 1, entering: null, from: null };
    const before = [...visible].reverse().find((i) => i < p.index);
    return before === undefined ? p : { index: before, step: animated(deck.slides[before]).length, entering: null, from: null };
  }), [deck.slides, visible]);

  const goTo = useCallback((i) => setPos({ index: i, step: 0, entering: null, from: null }), []);
  const hidden = useMemo(() => new Set(animated(deck.slides[pos.index]).slice(pos.step).map((e) => e.id)), [deck.slides, pos.index, pos.step]);
  const nextIndex = visible.find((i) => i > pos.index);
  return { ...pos, hidden, next, prev, goTo, visible, nextIndex, first: visible[0], last: visible[visible.length - 1] };
}

// The speaker's window: this slide, the next one, notes and a timer.
function PresenterView({ popup, deck, show, onEnd }) {
  const view = useViewport(popup);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((now - started) / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const slide = deck.slides[show.index];
  const nextSlide = show.nextIndex !== undefined ? deck.slides[show.nextIndex] : null;
  const big = Math.min(view.w * 0.58, 900);
  const small = Math.min(view.w * 0.32, 420);
  return (
    <div className="presenter">
      <div className="presenter-top">
        <span className="presenter-clock">{clock}</span>
        <span>Slide {show.index + 1} of {deck.slides.length}</span>
        <span className="ms-auto d-flex gap-2">
          <button type="button" className="btn btn-sm btn-light" onClick={show.prev}><FontAwesomeIcon icon={faChevronLeft} className="me-1" />Back</button>
          <button type="button" className="btn btn-sm btn-light" onClick={show.next}>Next<FontAwesomeIcon icon={faChevronRight} className="ms-1" /></button>
          <button type="button" className="btn btn-sm btn-danger" onClick={onEnd}>End show</button>
        </span>
      </div>
      <div className="presenter-body">
        <div>
          <SlideView deck={deck} slide={slide} index={show.index} width={big} hidden={show.hidden} />
        </div>
        <div className="presenter-side">
          <div className="presenter-label">Next</div>
          {nextSlide
            ? <SlideView deck={deck} slide={nextSlide} index={show.nextIndex} width={small} />
            : <div className="presenter-end" style={{ width: small }}>End of slide show</div>}
          <div className="presenter-label mt-3">Notes</div>
          <div className="presenter-notes">{slide.notes || <span className="text-muted">No notes for this slide.</span>}</div>
        </div>
      </div>
    </div>
  );
}

// Full-screen slide show, like PowerPoint's. Arrow keys, space or a click move
// through animations and slides; Esc ends the show. With `presenter`, a second
// window shows the speaker's view.
export default function Present({ deck, start, presenter = false, onClose, onPopupBlocked }) {
  const root = useRef(null);
  const view = useViewport();
  const show = useShow(deck, start);
  const { w: W, h: H } = slideSize(deck);
  const width = Math.min(view.w, (view.h * W) / H);
  const [popup, setPopup] = useState(null);
  const [outgoing, setOutgoing] = useState(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onBlockedRef = useRef(onPopupBlocked);
  onBlockedRef.current = onPopupBlocked;
  const end = useCallback(() => onCloseRef.current(), []);

  // Full screen for as long as the show runs. Leaving full screen ends the show.
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

  // The presenter window, with this page's styles copied in.
  useEffect(() => {
    if (!presenter) return undefined;
    const win = window.open('', 'kanforge-presenter', 'popup,width=1100,height=720');
    if (!win) {
      onBlockedRef.current?.();
      return undefined;
    }
    win.document.title = 'Presenter view';
    win.document.head.replaceChildren(...[...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.cloneNode(true)));
    win.document.body.replaceChildren();
    win.document.body.className = 'presenter-body-host';
    setPopup(win);
    const watch = setInterval(() => {
      if (win.closed) {
        clearInterval(watch);
        setPopup(null);
      }
    }, 500);
    return () => {
      clearInterval(watch);
      win.close();
    };
  }, [presenter]);

  // Keys work in both windows.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') end();
      else if (NEXT.has(e.key)) show.next();
      else if (PREV.has(e.key)) show.prev();
      else if (e.key === 'Home') show.goTo(show.first);
      else if (e.key === 'End') show.goTo(show.last);
      else return;
      e.preventDefault();
    };
    const wins = [window, popup].filter(Boolean);
    wins.forEach((w) => w.addEventListener('keydown', onKey));
    return () => wins.forEach((w) => w.removeEventListener('keydown', onKey));
  }, [show, popup, end]);

  // Keeps the previous slide on screen while the transition plays.
  const transition = deck.slides[show.index].transition ?? 'none';
  useEffect(() => {
    if (show.from === null || transition === 'none') {
      setOutgoing(null);
      return undefined;
    }
    setOutgoing(show.from);
    const t = setTimeout(() => setOutgoing(null), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [show.index, show.from, transition]);

  const slide = deck.slides[show.index];
  return createPortal(
    <div ref={root} className="slide-show" role="dialog" aria-label="Slide show" onClick={show.next}>
      <div className="slide-show-stage" style={{ width, height: (width * H) / W }}>
        {outgoing !== null && (
          <div className={`slide-show-layer tr-out-${transition}`} key={`out-${outgoing}`}>
            <SlideView deck={deck} slide={deck.slides[outgoing]} index={outgoing} width={width} />
          </div>
        )}
        <div className={`slide-show-layer${outgoing !== null ? ` tr-in-${transition}` : ''}`} key={`in-${show.index}`}>
          <SlideView deck={deck} slide={slide} index={show.index} width={width} hidden={show.hidden} entering={show.entering} onLink={openLink} />
        </div>
      </div>
      <div className="slide-show-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={show.prev} aria-label="Back"><FontAwesomeIcon icon={faChevronLeft} /></button>
        <span>{show.index + 1} / {deck.slides.length}</span>
        <button type="button" onClick={show.next} aria-label="Next"><FontAwesomeIcon icon={faChevronRight} /></button>
        {presenter && !popup && <FontAwesomeIcon icon={faDisplay} title="Presenter view closed" className="opacity-50" />}
        <button type="button" onClick={end} aria-label="End slide show"><FontAwesomeIcon icon={faXmark} /></button>
      </div>
      {popup && createPortal(<PresenterView popup={popup} deck={deck} show={show} onEnd={end} />, popup.document.body)}
    </div>,
    document.body,
  );
}

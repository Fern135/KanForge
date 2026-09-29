import { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronUp, faChevronDown, faXmark } from '@fortawesome/free-solid-svg-icons';
import { TextSelection } from '@tiptap/pm/state';
import { findAll, findKey } from './findReplace';

export default function FindPanel({ editor, onClose, showReplace: initialReplace }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(initialReplace);
  const [state, setState] = useState({ matches: [], current: -1 });
  const inputRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), []);

  const publish = useCallback((matches, current) => {
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { matches, current }));
    setState({ matches, current });
    const m = matches[current];
    if (m) {
      // Select and scroll to the match without taking focus from the panel.
      const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView();
      editor.view.dispatch(tr);
    }
  }, [editor]);

  // Re-run the search as the query or the document changes.
  useEffect(() => {
    const search = () => {
      const matches = findAll(editor.state.doc, query, caseSensitive);
      const { from } = editor.state.selection;
      const next = matches.findIndex((m) => m.from >= from);
      editor.view.dispatch(editor.state.tr.setMeta(findKey, { matches, current: matches.length ? Math.max(0, next) : -1 }));
      setState({ matches, current: matches.length ? Math.max(0, next) : -1 });
    };
    search();
    const onUpdate = ({ transaction }) => transaction.docChanged && search();
    editor.on('update', onUpdate);
    return () => editor.off('update', onUpdate);
  }, [editor, query, caseSensitive]);

  // Clear highlights when the panel closes.
  useEffect(() => () => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(findKey, { matches: [], current: -1 }));
  }, [editor]);

  const go = (dir) => {
    const { matches, current } = state;
    if (!matches.length) return;
    publish(matches, (current + dir + matches.length) % matches.length);
  };

  const replaceOne = () => {
    const m = state.matches[state.current];
    if (!m) return;
    editor.chain().insertContentAt({ from: m.from, to: m.to }, replacement ? { type: 'text', text: replacement } : '').run();
  };

  const replaceAll = () => {
    if (!state.matches.length) return;
    const { tr } = editor.state;
    [...state.matches].reverse().forEach((m) => {
      if (replacement) tr.insertText(replacement, m.from, m.to);
      else tr.delete(m.from, m.to);
    });
    editor.view.dispatch(tr);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    }
  };

  const { matches, current } = state;
  return (
    <div className="doc-find shadow" role="search">
      <div className="d-flex align-items-center gap-1">
        <input ref={inputRef} className="form-control form-control-sm" placeholder="Find in document" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} aria-label="Find" />
        <span className="small text-muted text-nowrap px-1" style={{ minWidth: 56 }}>
          {query ? (matches.length ? `${current + 1} of ${matches.length}` : 'No results') : ''}
        </span>
        <button type="button" className="icon-btn" onClick={() => go(-1)} disabled={!matches.length} aria-label="Previous match"><FontAwesomeIcon icon={faChevronUp} /></button>
        <button type="button" className="icon-btn" onClick={() => go(1)} disabled={!matches.length} aria-label="Next match"><FontAwesomeIcon icon={faChevronDown} /></button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close find"><FontAwesomeIcon icon={faXmark} /></button>
      </div>
      {showReplace && (
        <div className="d-flex align-items-center gap-1 mt-2">
          <input className="form-control form-control-sm" placeholder="Replace with" value={replacement}
            onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} aria-label="Replace with" />
          <button type="button" className="btn btn-sm btn-light text-nowrap" onClick={replaceOne} disabled={!matches.length}>Replace</button>
          <button type="button" className="btn btn-sm btn-light text-nowrap" onClick={replaceAll} disabled={!matches.length}>All</button>
        </div>
      )}
      <div className="d-flex align-items-center justify-content-between mt-2">
        <div className="form-check m-0 small">
          <input className="form-check-input" type="checkbox" id="find-case" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          <label className="form-check-label" htmlFor="find-case">Match case</label>
        </div>
        {!showReplace && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setShowReplace(true)}>Replace…</button>}
      </div>
    </div>
  );
}

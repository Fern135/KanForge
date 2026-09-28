import { useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBold, faItalic, faUnderline, faStrikethrough, faCode, faListUl, faListOl, faListCheck,
  faQuoteLeft, faTerminal, faMinus, faLink, faRotateLeft, faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { isSafeUrl } from '../extensions';

function Btn({ active, disabled, onClick, label, children }) {
  return (
    <button
      type="button"
      className={`note-tool ${active ? 'active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

// Adds https:// when someone types "example.com".
const normalizeUrl = (raw) => {
  const url = raw.trim();
  if (!url) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
};

export default function EditorToolbar({ editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState('');

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const run = (fn) => () => fn(editor.chain().focus()).run();

  const openLink = () => {
    setHref(editor.getAttributes('link').href || '');
    setLinkError('');
    setLinkOpen(true);
  };

  const applyLink = (e) => {
    e.preventDefault();
    const url = normalizeUrl(href);
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!url) {
      chain.unsetLink().run();
    } else if (!isSafeUrl(url)) {
      setLinkError('Links must start with http://, https:// or mailto:');
      return;
    } else {
      chain.setLink({ href: url }).run();
    }
    setLinkOpen(false);
  };

  return (
    <div className="note-toolbar">
      <div className="d-flex flex-wrap align-items-center gap-1">
        <Btn label="Bold" active={s.bold} onClick={run((c) => c.toggleBold())}><FontAwesomeIcon icon={faBold} /></Btn>
        <Btn label="Italic" active={s.italic} onClick={run((c) => c.toggleItalic())}><FontAwesomeIcon icon={faItalic} /></Btn>
        <Btn label="Underline" active={s.underline} onClick={run((c) => c.toggleUnderline())}><FontAwesomeIcon icon={faUnderline} /></Btn>
        <Btn label="Strikethrough" active={s.strike} onClick={run((c) => c.toggleStrike())}><FontAwesomeIcon icon={faStrikethrough} /></Btn>
        <Btn label="Inline code" active={s.code} onClick={run((c) => c.toggleCode())}><FontAwesomeIcon icon={faCode} /></Btn>
        <Btn label="Link" active={s.link || linkOpen} onClick={openLink}><FontAwesomeIcon icon={faLink} /></Btn>
        <span className="note-tool-sep" />
        {[1, 2, 3].map((level) => (
          <Btn key={level} label={`Heading ${level}`} active={s[`h${level}`]} onClick={run((c) => c.toggleHeading({ level }))}>
            <span className="fw-bold small">H{level}</span>
          </Btn>
        ))}
        <span className="note-tool-sep" />
        <Btn label="Bulleted list" active={s.bulletList} onClick={run((c) => c.toggleBulletList())}><FontAwesomeIcon icon={faListUl} /></Btn>
        <Btn label="Numbered list" active={s.orderedList} onClick={run((c) => c.toggleOrderedList())}><FontAwesomeIcon icon={faListOl} /></Btn>
        <Btn label="Checklist" active={s.taskList} onClick={run((c) => c.toggleTaskList())}><FontAwesomeIcon icon={faListCheck} /></Btn>
        <Btn label="Quote" active={s.blockquote} onClick={run((c) => c.toggleBlockquote())}><FontAwesomeIcon icon={faQuoteLeft} /></Btn>
        <Btn label="Code block" active={s.codeBlock} onClick={run((c) => c.toggleCodeBlock())}><FontAwesomeIcon icon={faTerminal} /></Btn>
        <Btn label="Divider" onClick={run((c) => c.setHorizontalRule())}><FontAwesomeIcon icon={faMinus} /></Btn>
        <span className="note-tool-sep" />
        <Btn label="Undo" disabled={!s.canUndo} onClick={run((c) => c.undo())}><FontAwesomeIcon icon={faRotateLeft} /></Btn>
        <Btn label="Redo" disabled={!s.canRedo} onClick={run((c) => c.redo())}><FontAwesomeIcon icon={faRotateRight} /></Btn>
      </div>
      {linkOpen && (
        <form className="d-flex flex-wrap gap-2 mt-2" onSubmit={applyLink}>
          <input
            className={`form-control form-control-sm ${linkError ? 'is-invalid' : ''}`}
            style={{ maxWidth: 360 }}
            placeholder="https://example.com (leave empty to remove)"
            value={href}
            maxLength={2048}
            autoFocus
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setLinkOpen(false)}
            aria-label="Link address"
          />
          <button type="submit" className="btn btn-sm btn-primary">Apply</button>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setLinkOpen(false)}>Cancel</button>
          {linkError && <div className="invalid-feedback d-block w-100 mt-0">{linkError}</div>}
        </form>
      )}
    </div>
  );
}

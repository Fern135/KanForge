import { useId, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faTag } from '@fortawesome/free-solid-svg-icons';

export const MAX_TAGS = 20;
const clean = (t) => t.trim().toLowerCase().replace(/[<>#,]/g, '').slice(0, 30);

// Tag chips with a text box. Enter or comma adds a tag, Backspace in an empty box removes the last one.
export default function TagInput({ tags, suggestions = [], onChange, disabled }) {
  const [draft, setDraft] = useState('');
  const listId = useId();

  const add = (raw) => {
    const tag = clean(raw);
    setDraft('');
    if (!tag || tags.includes(tag) || tags.length >= MAX_TAGS) return;
    onChange([...tags, tag]);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="d-flex flex-wrap align-items-center gap-1">
      <FontAwesomeIcon icon={faTag} className="text-muted small me-1" />
      {tags.map((t) => (
        <span className="note-tag" key={t}>
          {t}
          {!disabled && (
            <button type="button" className="note-tag-x" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </span>
      ))}
      {!disabled && tags.length < MAX_TAGS && (
        <>
          <input
            className="note-tag-input"
            placeholder={tags.length ? 'Add tag' : 'Add tags'}
            value={draft}
            maxLength={30}
            list={listId}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => draft && add(draft)}
            aria-label="Add a tag"
          />
          <datalist id={listId}>
            {suggestions.filter((s) => !tags.includes(s)).map((s) => <option key={s} value={s} />)}
          </datalist>
        </>
      )}
    </div>
  );
}

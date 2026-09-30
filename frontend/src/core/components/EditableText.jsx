import { useEffect, useRef, useState } from 'react';

// Shows text that turns into an input on click. Saves on Enter or blur.
export default function EditableText({
  value, onSave, maxLength, className, inputClassName = 'form-control form-control-sm', as: Tag = 'span', ariaLabel, readOnly = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = async () => {
    setEditing(false);
    const v = draft.trim();
    if (!v || v === value) {
      setDraft(value);
      return;
    }
    try {
      await onSave(v);
    } catch {
      setDraft(value);
    }
  };

  if (readOnly) return <Tag className={className}>{value}</Tag>;
  if (editing) {
    return (
      <input
        ref={ref}
        className={inputClassName}
        value={draft}
        maxLength={maxLength}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <Tag
      className={className}
      role="button"
      tabIndex={0}
      title="Click to edit"
      onClick={() => setEditing(true)}
      onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
    >
      {value}
    </Tag>
  );
}

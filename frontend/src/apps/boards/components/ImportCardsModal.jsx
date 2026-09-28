import { useMemo, useState } from 'react';
import Modal from '../../../core/components/Modal';
import { cardsApi } from '../api';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { MAX_CARDS_PER_LIST, parseCardImport } from '../utils/cardImport';

const JSON_EXAMPLE = `[
  "Just a title",
  {
    "title": "Launch the site",
    "description": "Everything needed to go live",
    "labels": ["red"],
    "dueDate": "2026-10-15",
    "dueComplete": false,
    "checklistTitle": "Steps",
    "checklistHideDone": false,
    "checklist": ["Buy domain", { "text": "Set up DNS", "done": true }]
  }
]`;

const TEXT_EXAMPLE = `Launch the site
  - [ ] Buy domain
  - [x] Set up DNS
Write the docs`;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ImportCardsModal({ boardId, list, cardCount, labels, onImported, onClose }) {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => {
    try {
      return { cards: parseCardImport(input, labels) };
    } catch (err) {
      return { error: err.message };
    }
  }, [input, labels]);

  const room = MAX_CARDS_PER_LIST - cardCount;
  const cards = parsed.cards || [];
  const error = parsed.error
    || (cards.length > room ? `Only ${plural(room, 'more card')} fit in this list (limit ${MAX_CARDS_PER_LIST})` : null);
  const items = cards.reduce((n, c) => n + (c.checklist?.length || 0), 0);

  const submit = async () => {
    if (error || !cards.length) return;
    setBusy(true);
    try {
      const data = await cardsApi.importCards(boardId, list.id, cards);
      onImported(list.id, data.cards);
      toast.success(`Imported ${plural(data.cards.length, 'card')}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Import cards into "${list.title}"`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <small className={`me-auto ${error ? 'text-danger' : 'text-muted'}`}>
            {error || (cards.length
              ? `${plural(cards.length, 'card')}${items ? ` and ${plural(items, 'checklist item')}` : ''} ready`
              : 'Paste JSON, or one card title per line')}
          </small>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || Boolean(error) || !cards.length}>
            Import
          </button>
        </>
      }
    >
      <textarea
        className="form-control font-monospace small mb-3"
        rows={12}
        aria-label="Cards to import"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={TEXT_EXAMPLE}
      />
      <details className="small">
        <summary className="text-muted">Format</summary>
        <p className="mt-2 mb-1">
          <strong>Plain text:</strong> one card title per line. Indented lines become checklist items of the card above
          (<code>- [ ]</code> open, <code>- [x]</code> done).
        </p>
        <pre className="bg-body-tertiary p-2 rounded">{TEXT_EXAMPLE}</pre>
        <p className="mb-1">
          <strong>JSON:</strong> a list of cards, or <code>{'{ "cards": [...] }'}</code>. A card is a title, or an object
          where only <code>title</code> is required. Labels are matched to this board&apos;s labels by name, or by color
          (like <code>&quot;red&quot;</code>). A date without a time means the end of that day.
        </p>
        <pre className="bg-body-tertiary p-2 rounded mb-0">{JSON_EXAMPLE}</pre>
      </details>
    </Modal>
  );
}

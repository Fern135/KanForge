import { memo, useEffect, useRef, useState } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEllipsis, faFileImport, faTrash } from '@fortawesome/free-solid-svg-icons';
import CardItem from './CardItem';
import InlineAdd from '../InlineAdd';
import EditableText from '../EditableText';

function ListColumn({ list, index, cards, labelsById, onOpenCard, onAddCard, onImport, onRename, onDelete }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => !menuRef.current?.contains(e.target) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <Draggable draggableId={`list-${list.id}`} index={index}>
      {(provided, snapshot) => (
        <section
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`list-column ${snapshot.isDragging ? 'is-dragging' : ''}`}
          aria-label={`List: ${list.title}`}
        >
          <header className="list-header" {...provided.dragHandleProps}>
            <EditableText value={list.title} maxLength={100} className="list-title" ariaLabel="List title" onSave={(t) => onRename(list.id, t)} />
            <span className="count">{cards.length}</span>
            <div className="dropdown" ref={menuRef}>
              <button type="button" className="icon-btn" aria-label="List actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <FontAwesomeIcon icon={faEllipsis} />
              </button>
              {menu && (
                <ul className="dropdown-menu dropdown-menu-end show shadow border-0" style={{ right: 0, left: 'auto' }}>
                  <li>
                    <button type="button" className="dropdown-item" onClick={() => { setMenu(false); onImport(list); }}>
                      <FontAwesomeIcon icon={faFileImport} className="me-2" />Import cards
                    </button>
                  </li>
                  <li>
                    <button type="button" className="dropdown-item text-danger" onClick={() => { setMenu(false); onDelete(list); }}>
                      <FontAwesomeIcon icon={faTrash} className="me-2" />Delete list
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </header>
          <Droppable droppableId={list.id} type="CARD">
            {(dropProvided, dropSnapshot) => (
              <div
                ref={dropProvided.innerRef}
                {...dropProvided.droppableProps}
                className={`list-cards ${dropSnapshot.isDraggingOver ? 'is-over' : ''}`}
              >
                {cards.map((card, i) => (
                  <CardItem key={card.id} card={card} index={i} labelsById={labelsById} onOpen={onOpenCard} />
                ))}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
          <div className="px-2 pb-2">
            <InlineAdd
              label="Add a card"
              placeholder="Enter a title for this card…"
              maxLength={200}
              multiline
              buttonClass="btn btn-sm w-100 text-start fw-semibold border-0 btn-add-card"
              onSubmit={(title) => onAddCard(list.id, title)}
            />
          </div>
        </section>
      )}
    </Draggable>
  );
}

export default memo(ListColumn);

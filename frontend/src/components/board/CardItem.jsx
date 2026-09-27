import { memo } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAlignLeft, faSquareCheck, faClock } from '@fortawesome/free-solid-svg-icons';
import { faComment } from '@fortawesome/free-regular-svg-icons';
import { dueStatus, shortDate } from '../../utils/dates';

function CardItem({ card, index, labelsById, onOpen }) {
  const status = dueStatus(card);
  const doneCount = card.checklist.filter((i) => i.done).length;
  const labels = card.labels.map((id) => labelsById[id]).filter(Boolean);

  return (
    <Draggable draggableId={card.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`task-card ${snapshot.isDragging ? 'is-dragging' : ''}`}
          onClick={() => onOpen(card.id)}
          onKeyDown={(e) => e.key === 'Enter' && onOpen(card.id)}
          aria-label={`Card: ${card.title}`}
        >
          {labels.length > 0 && (
            <div className="mb-1">
              {labels.map((l) => (
                <span key={l.id} className={`label-chip label-${l.color}`} title={l.name || l.color} />
              ))}
            </div>
          )}
          <div className="card-title">{card.title}</div>
          {(status || card.description || card.checklist.length > 0 || card.commentCount > 0) && (
            <div className="card-badges">
              {status && (
                <span className={`badge-due ${status}`} title="Due date">
                  <FontAwesomeIcon icon={faClock} className="me-1" />{shortDate(card.dueDate)}
                </span>
              )}
              {card.description && <FontAwesomeIcon icon={faAlignLeft} title="Has description" />}
              {card.checklist.length > 0 && (
                <span className={doneCount === card.checklist.length ? 'text-success fw-semibold' : ''} title="Checklist">
                  <FontAwesomeIcon icon={faSquareCheck} className="me-1" />{doneCount}/{card.checklist.length}
                </span>
              )}
              {card.commentCount > 0 && (
                <span title="Comments"><FontAwesomeIcon icon={faComment} className="me-1" />{card.commentCount}</span>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}

export default memo(CardItem);

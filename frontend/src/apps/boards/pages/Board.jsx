import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faTags, faGear } from '@fortawesome/free-solid-svg-icons';
import { boardsApi, cardsApi, listsApi } from '../api';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import Spinner from '../../../core/components/Spinner';
import Avatar from '../../../core/components/Avatar';
import EditableText from '../../../core/components/EditableText';
import InlineAdd from '../../../core/components/InlineAdd';
import ConfirmModal from '../../../core/components/ConfirmModal';
import ListColumn from '../components/ListColumn';
import CardModal from '../components/CardModal';
import { MembersModal, LabelsModal, SettingsModal } from '../components/BoardModals';
import ImportCardsModal from '../components/ImportCardsModal';

// Order is kept as id arrays (listOrder, cardOrder[listId]). Server positions are
// used only for the initial sort, so optimistic moves never depend on
// server-side renumbering.
function normalize(payload) {
  const lists = [...payload.lists].sort((a, b) => a.position - b.position);
  const cards = [...payload.cards].sort((a, b) => a.position - b.position);
  const cardOrder = Object.fromEntries(lists.map((l) => [l.id, []]));
  const cardsById = {};
  for (const c of cards) {
    cardsById[c.id] = c;
    cardOrder[c.listId]?.push(c.id);
  }
  return {
    meta: { id: payload.id, title: payload.title, background: payload.background, role: payload.role, labels: payload.labels, members: payload.members },
    listsById: Object.fromEntries(lists.map((l) => [l.id, l])),
    listOrder: lists.map((l) => l.id),
    cardsById,
    cardOrder,
  };
}

export default function Board() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState(null);
  const [openCardId, setOpenCardId] = useState(null);
  const [modal, setModal] = useState(null);
  const [deleteList, setDeleteList] = useState(null);
  const [importList, setImportList] = useState(null);
  // Moves are sent one at a time, in order, so rapid drags can't reach the server out of sequence.
  const queue = useRef(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const { board } = await boardsApi.get(boardId);
      setState(normalize(board));
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load board'));
      if (err.response?.status === 404 || err.response?.status === 400) navigate('/boards', { replace: true });
    }
  }, [boardId, navigate, toast]);

  useEffect(() => {
    setState(null);
    load();
  }, [load]);

  const enqueue = useCallback(
    (fn) => {
      queue.current = queue.current.then(fn).catch((err) => {
        toast.error(errorMessage(err, 'Could not save your change'));
        return load(); // resync with the source of truth
      });
    },
    [load, toast],
  );

  const labelsById = useMemo(
    () => Object.fromEntries((state?.meta.labels || []).map((l) => [l.id, l])),
    [state?.meta.labels],
  );

  const onDragEnd = useCallback(
    ({ source, destination, draggableId, type }) => {
      if (!destination) return;
      if (source.droppableId === destination.droppableId && source.index === destination.index) return;

      if (type === 'LIST') {
        const listId = draggableId.replace(/^list-/, '');
        setState((s) => {
          const listOrder = [...s.listOrder];
          listOrder.splice(source.index, 1);
          listOrder.splice(destination.index, 0, listId);
          return { ...s, listOrder };
        });
        enqueue(() => listsApi.move(boardId, listId, destination.index));
        return;
      }

      setState((s) => {
        const from = [...s.cardOrder[source.droppableId]];
        const to = source.droppableId === destination.droppableId ? from : [...s.cardOrder[destination.droppableId]];
        from.splice(source.index, 1);
        to.splice(destination.index, 0, draggableId);
        return {
          ...s,
          cardsById: { ...s.cardsById, [draggableId]: { ...s.cardsById[draggableId], listId: destination.droppableId } },
          cardOrder: { ...s.cardOrder, [source.droppableId]: from, [destination.droppableId]: to },
        };
      });
      enqueue(() => cardsApi.move(boardId, draggableId, destination.droppableId, destination.index));
    },
    [boardId, enqueue],
  );

  const addList = async (title) => {
    try {
      const { list } = await listsApi.create(boardId, title);
      setState((s) => ({
        ...s,
        listsById: { ...s.listsById, [list.id]: list },
        listOrder: [...s.listOrder, list.id],
        cardOrder: { ...s.cardOrder, [list.id]: [] },
      }));
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const addCard = useCallback(
    async (listId, title) => {
      try {
        const { card } = await cardsApi.create(boardId, listId, title);
        setState((s) => ({
          ...s,
          cardsById: { ...s.cardsById, [card.id]: card },
          cardOrder: { ...s.cardOrder, [listId]: [...s.cardOrder[listId], card.id] },
        }));
      } catch (err) {
        toast.error(errorMessage(err));
        throw err;
      }
    },
    [boardId, toast],
  );

  const addImportedCards = useCallback((listId, cards) => {
    setState((s) => ({
      ...s,
      cardsById: { ...s.cardsById, ...Object.fromEntries(cards.map((c) => [c.id, c])) },
      cardOrder: { ...s.cardOrder, [listId]: [...s.cardOrder[listId], ...cards.map((c) => c.id)] },
    }));
  }, []);

  const renameList = useCallback(
    async (listId, title) => {
      try {
        const { list } = await listsApi.rename(boardId, listId, title);
        setState((s) => ({ ...s, listsById: { ...s.listsById, [listId]: list } }));
      } catch (err) {
        toast.error(errorMessage(err));
        throw err;
      }
    },
    [boardId, toast],
  );

  const confirmDeleteList = async () => {
    const listId = deleteList.id;
    try {
      await listsApi.remove(boardId, listId);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    setState((s) => {
      const cardsById = { ...s.cardsById };
      s.cardOrder[listId].forEach((id) => delete cardsById[id]);
      const { [listId]: _gone, ...cardOrder } = s.cardOrder;
      const { [listId]: _l, ...listsById } = s.listsById;
      return { ...s, cardsById, cardOrder, listsById, listOrder: s.listOrder.filter((id) => id !== listId) };
    });
  };

  const updateCard = useCallback((card) => {
    setState((s) => ({ ...s, cardsById: { ...s.cardsById, [card.id]: { ...s.cardsById[card.id], ...card } } }));
  }, []);

  const removeCard = useCallback((cardId) => {
    setOpenCardId(null);
    setState((s) => {
      const card = s.cardsById[cardId];
      const { [cardId]: _gone, ...cardsById } = s.cardsById;
      return { ...s, cardsById, cardOrder: { ...s.cardOrder, [card.listId]: s.cardOrder[card.listId].filter((id) => id !== cardId) } };
    });
  }, []);

  const patchMeta = useCallback((patch) => setState((s) => ({ ...s, meta: { ...s.meta, ...patch } })), []);

  const renameBoard = async (title) => {
    try {
      await boardsApi.update(boardId, { title });
      patchMeta({ title });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const onLabelsChange = (labels, removedId) => {
    setState((s) => {
      let { cardsById } = s;
      if (removedId) {
        cardsById = Object.fromEntries(
          Object.entries(cardsById).map(([id, c]) => [id, c.labels.includes(removedId) ? { ...c, labels: c.labels.filter((l) => l !== removedId) } : c]),
        );
      }
      return { ...s, cardsById, meta: { ...s.meta, labels } };
    });
  };

  if (!state) return <Spinner fullscreen />;

  const { meta } = state;
  const openCard = openCardId ? state.cardsById[openCardId] : null;

  return (
    <div className={`board-page bg-board-${meta.background}`}>
      <div className="board-header">
        <EditableText as="h1" value={meta.title} maxLength={100} className="board-title" ariaLabel="Board title"
          inputClassName="form-control form-control-sm fw-bold" onSave={renameBoard} />
        <div className="ms-auto d-flex align-items-center gap-2">
          <div className="d-none d-sm-flex ps-2">
            {meta.members.slice(0, 5).map((m) => <Avatar key={m.id} name={m.name} small stacked />)}
            {meta.members.length > 5 && <span className="avatar avatar-sm stacked">+{meta.members.length - 5}</span>}
          </div>
          <button type="button" className="btn btn-sm btn-glass" onClick={() => setModal('members')}>
            <FontAwesomeIcon icon={faUserPlus} /><span className="d-none d-md-inline ms-2">Share</span>
          </button>
          <button type="button" className="btn btn-sm btn-glass" onClick={() => setModal('labels')} aria-label="Labels">
            <FontAwesomeIcon icon={faTags} />
          </button>
          <button type="button" className="btn btn-sm btn-glass" onClick={() => setModal('settings')} aria-label="Board settings">
            <FontAwesomeIcon icon={faGear} />
          </button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="board" direction="horizontal" type="LIST">
          {(provided) => (
            <div className="board-canvas" ref={provided.innerRef} {...provided.droppableProps}>
              {state.listOrder.map((listId, index) => (
                <ListColumn
                  key={listId}
                  list={state.listsById[listId]}
                  index={index}
                  cards={state.cardOrder[listId].map((id) => state.cardsById[id])}
                  labelsById={labelsById}
                  onOpenCard={setOpenCardId}
                  onAddCard={addCard}
                  onImport={setImportList}
                  onRename={renameList}
                  onDelete={setDeleteList}
                />
              ))}
              {provided.placeholder}
              <div className="add-list">
                <InlineAdd
                  label={state.listOrder.length ? 'Add another list' : 'Add a list'}
                  placeholder="List title…"
                  maxLength={100}
                  buttonClass="btn-add-list"
                  onSubmit={addList}
                />
              </div>
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {openCard && (
        <CardModal
          boardId={boardId}
          card={openCard}
          listTitle={state.listsById[openCard.listId]?.title}
          labels={meta.labels}
          role={meta.role}
          onChange={updateCard}
          onDelete={removeCard}
          onClose={() => setOpenCardId(null)}
        />
      )}
      {modal === 'members' && (
        <MembersModal
          board={meta}
          onClose={() => setModal(null)}
          onMembersChange={(members) => patchMeta({ members })}
          onLeft={() => navigate('/boards', { replace: true })}
        />
      )}
      {modal === 'labels' && <LabelsModal board={meta} onClose={() => setModal(null)} onLabelsChange={onLabelsChange} />}
      {modal === 'settings' && (
        <SettingsModal board={meta} onClose={() => setModal(null)} onUpdate={patchMeta} onDeleted={() => navigate('/boards', { replace: true })} />
      )}
      {importList && (
        <ImportCardsModal
          boardId={boardId}
          list={importList}
          cardCount={state.cardOrder[importList.id]?.length || 0}
          labels={meta.labels}
          onImported={addImportedCards}
          onClose={() => setImportList(null)}
        />
      )}
      {deleteList && (
        <ConfirmModal
          title="Delete list?"
          message={`"${deleteList.title}" and all of its cards will be permanently deleted.`}
          onClose={() => setDeleteList(null)}
          onConfirm={confirmDeleteList}
        />
      )}
    </div>
  );
}

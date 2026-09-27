'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

async function makeBoard(token, title = 'Board') {
  const { body: b } = await api().post('/api/boards').set(auth(token)).send({ title }).expect(201);
  const { body: l1 } = await api().post(`/api/boards/${b.board.id}/lists`).set(auth(token)).send({ title: 'Todo' }).expect(201);
  const { body: l2 } = await api().post(`/api/boards/${b.board.id}/lists`).set(auth(token)).send({ title: 'Done' }).expect(201);
  return { boardId: b.board.id, list1: l1.list.id, list2: l2.list.id };
}

const addCard = (token, boardId, listId, title) =>
  api().post(`/api/boards/${boardId}/cards`).set(auth(token)).send({ listId, title }).expect(201).then((r) => r.body.card);

const getBoard = (token, boardId) =>
  api().get(`/api/boards/${boardId}`).set(auth(token)).expect(200).then((r) => r.body.board);

describe('boards, lists, cards', () => {
  let alice;
  let bob;
  before(async () => {
    await setup();
    alice = await registerUser({ name: 'Alice' });
    bob = await registerUser({ name: 'Bob' });
  });
  after(teardown);

  it('moves cards within and across lists and keeps order', async () => {
    const { boardId, list1, list2 } = await makeBoard(alice.token);
    const a = await addCard(alice.token, boardId, list1, 'A');
    const b = await addCard(alice.token, boardId, list1, 'B');
    const c = await addCard(alice.token, boardId, list1, 'C');

    await api().put(`/api/boards/${boardId}/cards/${c.id}/move`).set(auth(alice.token)).send({ listId: list1, index: 0 }).expect(200);
    await api().put(`/api/boards/${boardId}/cards/${a.id}/move`).set(auth(alice.token)).send({ listId: list2, index: 0 }).expect(200);

    const board = await getBoard(alice.token, boardId);
    const inList = (id) => board.cards.filter((x) => x.listId === id).sort((x, y) => x.position - y.position).map((x) => x.title);
    assert.deepEqual(inList(list1), ['C', 'B']);
    assert.deepEqual(inList(list2), ['A']);
    assert.ok(b);
  });

  it('keeps a stable order after many moves into the same slot (renormalizes)', async () => {
    const { boardId, list1 } = await makeBoard(alice.token);
    const cards = [];
    for (const t of ['A', 'B', 'C']) cards.push(await addCard(alice.token, boardId, list1, t));
    // Repeatedly insert at index 1, halving the gap each time until it renormalizes.
    for (let i = 0; i < 60; i += 1) {
      const mover = cards[i % 2 === 0 ? 2 : 0];
      await api().put(`/api/boards/${boardId}/cards/${mover.id}/move`).set(auth(alice.token)).send({ listId: list1, index: 1 }).expect(200);
    }
    const board = await getBoard(alice.token, boardId);
    const positions = board.cards.map((x) => x.position);
    assert.equal(new Set(positions).size, 3, 'positions must stay distinct');
  });

  it('shows a member\'s new name on cached boards after a profile rename', async () => {
    const carol = await registerUser({ name: 'Carol Test' });
    const { boardId } = await makeBoard(carol.token);
    await getBoard(carol.token, boardId); // warm the board cache
    await api().patch('/api/auth/me').set(auth(carol.token)).send({ name: 'Fernando Camblor' }).expect(200);
    const board = await getBoard(carol.token, boardId);
    assert.deepEqual(board.members.map((m) => m.name), ['Fernando Camblor']);
  });

  it('hides boards from non-members (404, not 403)', async () => {
    const { boardId } = await makeBoard(alice.token);
    await api().get(`/api/boards/${boardId}`).set(auth(bob.token)).expect(404);
    await api().patch(`/api/boards/${boardId}`).set(auth(bob.token)).send({ title: 'pwned' }).expect(404);
    const { body } = await api().get('/api/boards').set(auth(bob.token)).expect(200);
    assert.ok(!body.boards.some((x) => x.id === boardId));
  });

  it('prevents cross-board IDOR on cards and lists', async () => {
    const victim = await makeBoard(alice.token, 'Victim');
    const victimCard = await addCard(alice.token, victim.boardId, victim.list1, 'secret');
    const own = await makeBoard(bob.token, 'Attacker');
    const ownCard = await addCard(bob.token, own.boardId, own.list1, 'mine');

    // Bob addresses Alice's card through his own board.
    await api().patch(`/api/boards/${own.boardId}/cards/${victimCard.id}`).set(auth(bob.token)).send({ title: 'x' }).expect(404);
    await api().delete(`/api/boards/${own.boardId}/lists/${victim.list1}`).set(auth(bob.token)).expect(404);
    // Bob moves his own card into Alice's list.
    await api().put(`/api/boards/${own.boardId}/cards/${ownCard.id}/move`).set(auth(bob.token)).send({ listId: victim.list1, index: 0 }).expect(400);
    // Bob creates a card in Alice's list via his board.
    await api().post(`/api/boards/${own.boardId}/cards`).set(auth(bob.token)).send({ listId: victim.list1, title: 'x' }).expect(400);

    const board = await getBoard(alice.token, victim.boardId);
    assert.deepEqual(board.cards.map((x) => x.title), ['secret']);
  });

  it('enforces owner-only actions and member sharing', async () => {
    const { boardId } = await makeBoard(alice.token);
    await api().post(`/api/boards/${boardId}/members`).set(auth(alice.token)).send({ email: bob.email }).expect(201);
    await getBoard(bob.token, boardId);
    await api().delete(`/api/boards/${boardId}`).set(auth(bob.token)).expect(403);
    await api().post(`/api/boards/${boardId}/members`).set(auth(bob.token)).send({ email: 'x@y.co' }).expect(403);
    await api().delete(`/api/boards/${boardId}/members/${alice.user.id}`).set(auth(bob.token)).expect(403);
    // Bob leaves; access is gone immediately (cache must not serve him).
    await api().delete(`/api/boards/${boardId}/members/${bob.user.id}`).set(auth(bob.token)).expect(204);
    await api().get(`/api/boards/${boardId}`).set(auth(bob.token)).expect(404);
  });

  it('only accepts labels that belong to the board', async () => {
    const { boardId, list1 } = await makeBoard(alice.token);
    const other = await makeBoard(alice.token);
    const card = await addCard(alice.token, boardId, list1, 'L');
    const own = (await getBoard(alice.token, boardId)).labels[0].id;
    const foreign = (await getBoard(alice.token, other.boardId)).labels[0].id;
    await api().patch(`/api/boards/${boardId}/cards/${card.id}`).set(auth(alice.token)).send({ labels: [foreign] }).expect(400);
    const { body } = await api().patch(`/api/boards/${boardId}/cards/${card.id}`).set(auth(alice.token)).send({ labels: [own] }).expect(200);
    assert.deepEqual(body.card.labels, [own]);
  });

  it('supports checklist, due dates and comments; only authors or owners delete comments', async () => {
    const { boardId, list1 } = await makeBoard(alice.token);
    await api().post(`/api/boards/${boardId}/members`).set(auth(alice.token)).send({ email: bob.email }).expect(201);
    const card = await addCard(alice.token, boardId, list1, 'Work');
    const base = `/api/boards/${boardId}/cards/${card.id}`;

    const { body: ck } = await api().post(`${base}/checklist`).set(auth(alice.token)).send({ text: 'step' }).expect(201);
    const itemId = ck.card.checklist[0].id;
    const { body: ck2 } = await api().patch(`${base}/checklist/${itemId}`).set(auth(bob.token)).send({ done: true }).expect(200);
    assert.equal(ck2.card.checklist[0].done, true);

    const { body: bulk } = await api().post(`${base}/checklist/bulk`).set(auth(alice.token))
      .send({ items: [{ text: ' a ' }, { text: 'b', done: true }] }).expect(201);
    assert.deepEqual(bulk.card.checklist.map((i) => [i.text, i.done]), [['step', true], ['a', false], ['b', true]]);
    await api().post(`${base}/checklist/bulk`).set(auth(alice.token)).send({ items: [{ text: '' }] }).expect(400);
    await api().post(`${base}/checklist/bulk`).set(auth(alice.token)).send({ items: [{ text: 'x', extra: 1 }] }).expect(400);
    const tooMany = Array.from({ length: 98 }, (_, i) => ({ text: `t${i}` }));
    await api().post(`${base}/checklist/bulk`).set(auth(alice.token)).send({ items: tooMany }).expect(400);
    const { body: after } = await api().get(base).set(auth(alice.token)).expect(200);
    assert.equal(after.card.checklist.length, 3);
    assert.equal(after.card.checklistTitle, 'Checklist');
    assert.equal(after.card.checklistHideDone, false);
    const { body: renamed } = await api().patch(base).set(auth(bob.token))
      .send({ checklistTitle: ' Launch steps ', checklistHideDone: true }).expect(200);
    assert.equal(renamed.card.checklistTitle, 'Launch steps');
    assert.equal(renamed.card.checklistHideDone, true);
    await api().patch(base).set(auth(alice.token)).send({ checklistTitle: '  ' }).expect(400);

    const due = new Date(Date.now() + 86400000).toISOString();
    const { body: d } = await api().patch(base).set(auth(alice.token)).send({ dueDate: due, description: '<script>x</script>' }).expect(200);
    assert.equal(d.card.dueDate, due);

    const { body: c } = await api().post(`${base}/comments`).set(auth(alice.token)).send({ text: 'hi' }).expect(201);
    await api().delete(`${base}/comments/${c.comment.id}`).set(auth(bob.token)).expect(403);
    const { body: list } = await api().get(`${base}/comments`).set(auth(bob.token)).expect(200);
    assert.equal(list.comments[0].author.name, 'Alice');
    await api().delete(`${base}/comments/${c.comment.id}`).set(auth(alice.token)).expect(204);
  });

  it('bulk imports cards with their details, all-or-nothing', async () => {
    const { boardId, list1 } = await makeBoard(alice.token);
    const other = await makeBoard(alice.token);
    const label = (await getBoard(alice.token, boardId)).labels[0].id;
    const foreign = (await getBoard(alice.token, other.boardId)).labels[0].id;
    await addCard(alice.token, boardId, list1, 'Existing');
    const url = `/api/boards/${boardId}/cards/bulk`;
    const due = new Date(Date.now() + 86400000).toISOString();

    const { body } = await api().post(url).set(auth(alice.token)).send({
      listId: list1,
      cards: [
        { title: 'Plain' },
        {
          title: 'Full', description: 'd', labels: [label, label], dueDate: due, dueComplete: true,
          checklistTitle: 'Steps', checklistHideDone: true, checklist: [{ text: 'a' }, { text: 'b', done: true }],
        },
      ],
    }).expect(201);
    assert.equal(body.cards.length, 2);
    const full = body.cards[1];
    assert.deepEqual(full.labels, [label]);
    assert.equal(full.dueDate, due);
    assert.equal(full.checklistTitle, 'Steps');
    assert.deepEqual(full.checklist.map((i) => [i.text, i.done]), [['a', false], ['b', true]]);
    const board = await getBoard(alice.token, boardId);
    const titles = board.cards.filter((c) => c.listId === list1).sort((a, b) => a.position - b.position).map((c) => c.title);
    assert.deepEqual(titles, ['Existing', 'Plain', 'Full']);

    // Bad input anywhere rejects the whole import.
    await api().post(url).set(auth(alice.token)).send({ listId: list1, cards: [{ title: 'ok' }, { title: 'x', labels: [foreign] }] }).expect(400);
    await api().post(url).set(auth(alice.token)).send({ listId: list1, cards: [{ title: 'x', createdBy: alice.user.id }] }).expect(400);
    await api().post(url).set(auth(alice.token)).send({ listId: other.list1, cards: [{ title: 'x' }] }).expect(400);
    assert.equal((await getBoard(alice.token, boardId)).cards.length, 3);

    // Bulk routes accept bodies over the normal 32 KB cap.
    const big = Array.from({ length: 60 }, (_, i) => ({ title: `Card ${i}`, description: 'x'.repeat(1000) }));
    await api().post(url).set(auth(alice.token)).send({ listId: list1, cards: big }).expect(201);
  });

  it('rate limits every route, with a per-user budget for bulk imports', async () => {
    // Unknown paths and health checks still carry rate-limit headers.
    const missing = await api().get('/nope').expect(404);
    assert.ok(missing.headers.ratelimit);
    const health = await api().get('/api/health').expect(200);
    assert.ok(health.headers.ratelimit);

    const carol = await registerUser();
    const { boardId, list1 } = await makeBoard(carol.token);
    const card = await addCard(carol.token, boardId, list1, 'Bulk');
    const url = `/api/boards/${boardId}/cards/${card.id}/checklist/bulk`;
    for (let i = 0; i < 30; i += 1) {
      await api().post(url).set(auth(carol.token)).send({ items: [{ text: `i${i}` }] }).expect(201);
    }
    const limited = await api().post(url).set(auth(carol.token)).send({ items: [{ text: 'over' }] }).expect(429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    // The budget is per user: someone else on the same IP can still import.
    const dave = await registerUser();
    const other = await makeBoard(dave.token);
    const theirs = await addCard(dave.token, other.boardId, other.list1, 'Mine');
    await api().post(`/api/boards/${other.boardId}/cards/${theirs.id}/checklist/bulk`).set(auth(dave.token))
      .send({ items: [{ text: 'ok' }] }).expect(201);
    // Reads don't count against the write budget.
    const read = await api().get(`/api/boards/${boardId}`).set(auth(carol.token)).expect(200);
    assert.ok(read.headers.ratelimit);
  });

  it('rejects malformed ids and oversized payloads', async () => {
    await api().get('/api/boards/not-an-id').set(auth(alice.token)).expect(400);
    const { boardId } = await makeBoard(alice.token);
    await api().patch(`/api/boards/${boardId}`).set(auth(alice.token)).send({ title: 'x'.repeat(101) }).expect(400);
    const huge = await api().patch(`/api/boards/${boardId}`).set(auth(alice.token)).send({ title: 'x'.repeat(40_000) });
    assert.equal(huge.status, 413);
  });
});

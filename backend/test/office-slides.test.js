'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

const D = '/api/office/documents';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const deck = (slides, extra = {}) => ({ size: '16:9', theme: 'light', slides, ...extra });

describe('office presentations', () => {
  let alice;
  let bob;
  const post = (u, body) => api().post(D).set(auth(u.token)).send(body);

  before(async () => {
    await setup();
    alice = await registerUser();
    bob = await registerUser();
  });
  after(teardown);

  it('creates a presentation with a title slide, printed one slide per landscape page', async () => {
    const { document } = (await post(alice, { kind: 'slides' }).expect(201)).body;
    assert.equal(document.kind, 'slides');
    assert.equal(document.title, '');
    assert.equal(document.content.size, '16:9');
    assert.equal(document.content.slides.length, 1);
    assert.equal(document.content.slides[0].elements.length, 2);
    assert.equal(document.settings.orientation, 'landscape');
    assert.deepEqual(document.settings.margins, { top: 0, right: 0, bottom: 0, left: 0 });
    await api().get(`${D}/${document.id}`).set(auth(bob.token)).expect(404);
  });

  it('keeps text, shapes, images and notes, and drops anything else', async () => {
    const { image } = (await api().post('/api/office/images').set(auth(alice.token)).send({ data: PNG }).expect(201)).body;
    const content = deck([
      {
        id: 's1',
        background: '#FFEEDD',
        notes: 'Say hello\u0007',
        evil: true,
        elements: [
          { id: 'a', type: 'text', x: 10.04, y: 20, w: 300, h: 80, text: 'Quarterly <b>review</b>\r\nLine two', style: { size: 40, b: true, color: '#FF0000', font: 'x;evil', align: 'middle', list: 'bullet', onclick: 'x' } },
          { id: 'b', type: 'shape', shape: 'star', x: 1e9, y: -1e9, w: 50, h: 50, fill: 'red', stroke: '#000000', strokeWidth: 99, text: 'Box' },
          { id: 'c', type: 'image', imageId: image.id, x: 0, y: 0, w: 100, h: 100 },
          { id: 'd', type: 'image', imageId: 'not-an-id' },
          { id: 'a', type: 'video', src: 'https://evil' },
          'nope',
        ],
      },
      { id: 's1', elements: [{ id: 'a', type: 'text', text: 'Dup ids' }] },
    ], { theme: 'neon', size: '21:9', script: 'alert(1)' });

    const { document } = (await post(alice, { kind: 'slides', content }).expect(201)).body;
    const c = document.content;
    assert.equal(c.theme, 'light');
    assert.equal(c.size, '16:9');
    assert.equal(c.script, undefined);
    const [s1, s2] = c.slides;
    assert.equal(s1.background, '#ffeedd');
    assert.equal(s1.notes, 'Say hello');
    assert.equal(s1.evil, undefined);
    assert.equal(s1.elements.length, 3);
    const [text, shape, img] = s1.elements;
    assert.deepEqual(text, {
      id: 'a', type: 'text', x: 10, y: 20, w: 300, h: 80,
      text: 'Quarterly <b>review</b>\nLine two',
      style: { size: 40, color: '#ff0000', b: true, list: 'bullet' },
    });
    assert.deepEqual(shape, {
      id: 'b', type: 'shape', x: 1920, y: -540, w: 50, h: 50, shape: 'rect', fill: null, stroke: '#000000', strokeWidth: 20, text: 'Box', style: {},
    });
    assert.equal(img.imageId, image.id);
    assert.notEqual(s2.id, 's1', 'slide ids are unique');
    assert.notEqual(s2.elements[0].id, 'a', 'element ids are unique across the deck');

    // Text and notes are searchable.
    const found = (await api().get(`${D}?q=quarterly`).set(auth(alice.token)).expect(200)).body.documents;
    assert.deepEqual(found.map((d) => d.id), [document.id]);
    assert.equal((await api().get(`${D}?q=say%20hello`).set(auth(alice.token))).body.documents.length, 1);
  });

  it('keeps tables, charts, icons, effects, animations, transitions and the footer, and drops anything unsafe', async () => {
    const content = deck([
      {
        id: 's1',
        background: '#112233',
        background2: '#445566',
        bgAngle: 90,
        transition: 'push',
        hidden: true,
        elements: [
          {
            id: 't1', type: 'table', x: 0, y: 0, w: 400, h: 120, rows: 2, cols: 2, header: true, headerFill: 'none', border: '#ABCDEF',
            cells: [['Name', 'Score'], ['Ann', 42, 'extra']], style: { size: 14, onclick: 'x' },
          },
          {
            id: 'c1', type: 'chart', x: 0, y: 200, w: 400, h: 240, chart: 'donut', title: 'Mix', legend: false,
            labels: ['A', 'B', 'C'], series: [{ name: 'S', values: [1, 'two', Infinity, 4] }],
          },
          { id: 'i1', type: 'icon', x: 500, y: 0, w: 96, h: 96, icon: 'rocket', color: '#FF0000' },
          { id: 'i2', type: 'icon', x: 600, y: 0, w: 96, h: 96, icon: 'not-an-icon' },
          {
            id: 'x1', type: 'shape', shape: 'heart', x: 0, y: 0, w: 50, h: 50, rotation: -90, flipH: true, flipV: 'yes', opacity: 0.02,
            shadow: true, locked: true, group: 'g1', link: 'https://example.com/a', anim: 'fly', animOrder: 3,
            style: { s: true, highlight: '#FFFF00', spacing: 1.5 },
          },
          { id: 'x2', type: 'text', x: 0, y: 0, w: 50, h: 50, text: 'bad link', link: 'javascript:alert(1)', anim: 'explode', group: 'Bad Group!' },
          { id: 'x3', type: 'text', ph: 'picture', x: 0, y: 0, w: 50, h: 50, text: '' },
        ],
      },
    ], { footer: { number: true, text: 'Kanforge\u0000 deck', skipFirst: false, evil: 1 } });

    const c = (await post(alice, { kind: 'slides', content }).expect(201)).body.document.content;
    const s = c.slides[0];
    assert.deepEqual(
      { background: s.background, background2: s.background2, bgAngle: s.bgAngle, transition: s.transition, hidden: s.hidden },
      { background: '#112233', background2: '#445566', bgAngle: 90, transition: 'push', hidden: true },
    );
    assert.deepEqual(c.footer, { number: true, text: 'Kanforge deck', skipFirst: false });
    const [table, chart, icon, fallbackIcon, shape, badText, picture] = s.elements;
    assert.deepEqual(table.cells, [['Name', 'Score'], ['Ann', '']]);
    assert.equal(table.headerFill, 'none');
    assert.equal(table.border, '#abcdef');
    assert.deepEqual(table.style, { size: 14 });
    assert.equal(chart.chart, 'donut');
    assert.deepEqual(chart.series, [{ name: 'S', values: [1, 0, 0] }], 'values match the labels, non-numbers become 0');
    assert.equal(chart.legend, false);
    assert.deepEqual([icon.icon, icon.color, fallbackIcon.icon], ['rocket', '#ff0000', 'star']);
    assert.deepEqual(
      { rotation: shape.rotation, flipH: shape.flipH, flipV: shape.flipV, opacity: shape.opacity, shadow: shape.shadow, locked: shape.locked, group: shape.group, link: shape.link, anim: shape.anim, animOrder: shape.animOrder },
      { rotation: 270, flipH: true, flipV: undefined, opacity: 0.1, shadow: true, locked: true, group: 'g1', link: 'https://example.com/a', anim: 'fly', animOrder: 3 },
    );
    assert.deepEqual(shape.style, { highlight: '#ffff00', s: true, spacing: 1.5 });
    assert.equal(badText.link, undefined, 'script links are dropped');
    assert.equal(badText.anim, undefined);
    assert.equal(badText.group, undefined);
    assert.equal(picture.ph, 'picture');
  });

  it('refuses decks that are empty or too big', async () => {
    await post(alice, { kind: 'slides', content: deck([]) }).expect(400);
    await post(alice, { kind: 'slides', content: { slides: 'x' } }).expect(400);
    await post(alice, { kind: 'slides', content: deck(Array.from({ length: 301 }, () => ({ elements: [] }))) }).expect(400);
    await post(alice, { kind: 'slides', content: deck([{ elements: Array.from({ length: 151 }, () => ({ type: 'text' })) }]) }).expect(400);
    await post(alice, { kind: 'slides', content: deck([{ elements: [{ type: 'text', text: 'x'.repeat(5001) }] }]) }).expect(400);
    await post(alice, { kind: 'slides', content: deck([{ notes: 'x'.repeat(10_001), elements: [] }]) }).expect(400);
    await post(alice, { kind: 'slides', content: deck([{ elements: [{ type: 'table', rows: 1, cols: 1, cells: [['x'.repeat(1001)]] }] }]) }).expect(400);
  });

  it('saves edits with versioning, like the other kinds', async () => {
    const { document } = (await post(alice, { kind: 'slides' }).expect(201)).body;
    const next = deck([{ id: 's1', elements: [{ id: 't', type: 'text', x: 0, y: 0, w: 100, h: 50, text: 'Updated' }] }, { id: 's2', elements: [] }], { active: 1 });
    const saved = (await api().patch(`${D}/${document.id}`).set(auth(alice.token)).send({ content: next, version: document.version }).expect(200)).body.document;
    assert.equal(saved.content.slides.length, 2);
    assert.equal(saved.content.active, 1);
    const stale = await api().patch(`${D}/${document.id}`).set(auth(alice.token)).send({ content: next, version: document.version });
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  });
});

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

const D = '/api/office/documents';
const sheet = (cells, extra = {}) => ({ id: 's1', name: 'Budget', rows: 100, cols: 10, cells, ...extra });

describe('office spreadsheets', () => {
  let alice;
  const post = (body) => api().post(D).set(auth(alice.token)).send(body);

  before(async () => {
    await setup();
    alice = await registerUser();
  });
  after(teardown);

  it('creates a spreadsheet with one empty sheet and Excel-like print margins', async () => {
    const { document } = (await post({ kind: 'sheet' }).expect(201)).body;
    assert.equal(document.kind, 'sheet');
    assert.equal(document.content.sheets.length, 1);
    assert.equal(document.content.sheets[0].name, 'Sheet1');
    assert.deepEqual(document.content.sheets[0].cells, {});
    assert.equal(document.settings.margins.top, 19.1);
  });

  it('keeps values, formulas and formats, and drops anything else', async () => {
    const content = {
      styles: [{ b: true, fill: '#FFFF00', fmt: 'currency', dp: 2, font: 'x;evil', color: 'red', h: 'middle' }, {}],
      sheets: [
        sheet({
          A1: { v: 'Rent', s: 0, extra: 1 },
          B1: { v: 1200.5 },
          B2: { f: 'SUM(B1:B1)*2', v: 'ignored' },
          C1: { v: true },
          D1: { v: '' },
          E1: { s: 1 },
          K1: { v: 'outside the 10 columns' },
          A101: { v: 'outside the 100 rows' },
          'A1;x': { v: 'bad key' },
          F1: { v: Infinity },
          G1: { s: 99 },
        }, { widths: { 0: 150, 99: 20, 1: 'wide' }, freeze: { rows: 1, cols: 99 }, evil: true }),
        { id: 's1', name: 'budget', cells: {} },
        { name: 'bad/name', cells: {} },
      ],
      active: 7,
    };
    const { document } = (await post({ kind: 'sheet', content }).expect(201)).body;
    const [first, second, third] = document.content.sheets;
    assert.deepEqual(document.content.styles[0], { b: true, fill: '#ffff00', fmt: 'currency', dp: 2 });
    assert.deepEqual(first.cells, { A1: { v: 'Rent', s: 0 }, B1: { v: 1200.5 }, B2: { f: 'SUM(B1:B1)*2' }, C1: { v: true } });
    assert.deepEqual(first.widths, { 0: 150 });
    assert.deepEqual(first.freeze, { rows: 1, cols: 0 });
    assert.equal(first.evil, undefined);
    assert.notEqual(second.id, 's1', 'sheet ids are unique');
    assert.equal(second.name, 'budget (2)', 'sheet names are unique, ignoring case');
    assert.equal(third.name, 'Sheet3');
    assert.equal(document.content.active, 0);

    const found = (await api().get(D).set(auth(alice.token)).query({ q: 'rent', kind: 'sheet' })).body.documents;
    assert.equal(found.length, 1);
  });

  it('refuses content that is not a workbook or is too large', async () => {
    for (const content of [{ type: 'doc' }, { sheets: [] }, { sheets: Array.from({ length: 51 }, () => ({})) }]) {
      await post({ kind: 'sheet', content }).expect(400);
    }
    await post({ kind: 'sheet', content: { sheets: [sheet({ A1: { f: 'x'.repeat(4001) } })] } }).expect(400);
    await post({ kind: 'sheet', content: { sheets: [sheet({ A1: { v: 'x'.repeat(10_001) } })] } }).expect(400);
  });
});

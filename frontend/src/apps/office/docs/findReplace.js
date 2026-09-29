import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Highlights search matches, and the current one more strongly. The Find
// panel sets { matches, current } through a transaction meta.
export const findKey = new PluginKey('docFind');

export const FindHighlight = Extension.create({
  name: 'findHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => ({ matches: [], current: -1 }),
          apply(tr, value) {
            const meta = tr.getMeta(findKey);
            if (meta) return meta;
            if (!tr.docChanged || !value.matches.length) return value;
            // Keep positions valid while the document changes under the panel.
            return {
              ...value,
              matches: value.matches.map((m) => ({ from: tr.mapping.map(m.from), to: tr.mapping.map(m.to) })).filter((m) => m.to > m.from),
            };
          },
        },
        props: {
          decorations(state) {
            const { matches, current } = findKey.getState(state);
            if (!matches.length) return null;
            return DecorationSet.create(state.doc, matches.map((m, i) =>
              Decoration.inline(m.from, m.to, { class: i === current ? 'find-match current' : 'find-match' })));
          },
        },
      }),
    ];
  },
});

// Every match of `query` in the document, as { from, to } positions. Matches
// stay within one paragraph (or heading, or cell), as in Word.
export function findAll(doc, query, caseSensitive) {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const results = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const positions = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i += 1) positions.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        positions.push(pos + 1 + offset);
        text += '￼';
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      results.push({ from: positions[i], to: positions[i + needle.length - 1] + 1 });
    }
    return false;
  });
  return results;
}

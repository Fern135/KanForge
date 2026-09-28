import { marked } from 'marked';
import { generateJSON } from '@tiptap/core';
import { noteExtensions } from '../extensions';

// Markdown in and out of notes. Import goes Markdown → HTML → the editor's
// schema, which keeps only the elements notes support (raw HTML in a file can't
// add anything else). Export walks the editor's JSON document.

// ---------- Import ----------

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Reads `tags:` from YAML front matter (Obsidian and others), as `[a, b]` or a `- a` list.
function frontMatterTags(yaml) {
  const inline = yaml.match(/^tags:\s*\[(.*)\]\s*$/m);
  if (inline) return inline[1].split(',');
  const block = yaml.match(/^tags:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/m);
  if (block) return block[1].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, ''));
  const single = yaml.match(/^tags:\s*(\S.*)$/m);
  return single ? single[1].split(/[,\s]+/) : [];
}

const cleanTag = (t) => t.trim().replace(/^["'#]+|["']+$/g, '').toLowerCase().replace(/[<>#,]/g, '').slice(0, 30);

// marked renders "- [ ] x" as a list item with a checkbox. The editor reads
// task lists from data-type attributes, so rewrite them.
function markTaskLists(html) {
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const input of dom.querySelectorAll('li > input[type="checkbox"]:first-child, li > p:first-child > input[type="checkbox"]:first-child')) {
    const li = input.closest('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', input.checked ? 'true' : 'false');
    input.remove();
    const list = li.parentElement;
    if (list && [...list.children].every((c) => c.getAttribute('data-type') === 'taskItem' || c.querySelector(':scope > input[type="checkbox"], :scope > p:first-child > input[type="checkbox"]'))) {
      list.setAttribute('data-type', 'taskList');
    }
  }
  return dom.body.innerHTML;
}

// marked leaves a trailing newline inside code blocks.
function trimCodeBlocks(node) {
  if (node.type === 'codeBlock') {
    const last = node.content?.[node.content.length - 1];
    if (last?.text) last.text = last.text.replace(/\n+$/, '');
    if (last && !last.text) node.content.pop();
  }
  node.content?.forEach(trimCodeBlocks);
}

export function fromMarkdown(markdown, fallbackTitle = '') {
  let body = markdown.replace(/^﻿/, '');
  let tags = [];
  const fm = body.match(FRONT_MATTER);
  if (fm) {
    tags = frontMatterTags(fm[1]).map(cleanTag).filter(Boolean);
    body = body.slice(fm[0].length);
  }
  const doc = generateJSON(markTaskLists(marked.parse(body, { gfm: true, async: false })), noteExtensions);
  trimCodeBlocks(doc);

  // A leading "# Heading" becomes the note's title.
  let title = fallbackTitle;
  const first = doc.content?.[0];
  if (first?.type === 'heading' && first.attrs?.level === 1) {
    title = (first.content || []).map((c) => c.text || '').join('').trim() || fallbackTitle;
    doc.content = doc.content.slice(1);
  }
  if (!doc.content?.length) doc.content = [{ type: 'paragraph' }];
  return { title: title.slice(0, 200), content: doc, tags: [...new Set(tags)].slice(0, 20) };
}

// ---------- Export ----------

const escapeText = (s) => s.replace(/([\\`*_[\]])/g, '\\$1');

function inline(nodes = []) {
  return nodes.map((node) => {
    if (node.type === 'hardBreak') return '  \n';
    if (node.type !== 'text') return '';
    const marks = node.marks || [];
    const has = (t) => marks.some((m) => m.type === t);
    let out = has('code') ? `\`${node.text}\`` : escapeText(node.text);
    if (has('bold')) out = `**${out}**`;
    if (has('italic')) out = `*${out}*`;
    if (has('strike')) out = `~~${out}~~`;
    if (has('underline')) out = `<u>${out}</u>`;
    const link = marks.find((m) => m.type === 'link');
    if (link) out = `[${out}](${link.attrs.href})`;
    return out;
  }).join('');
}

const indent = (text, prefix, rest = ' '.repeat(prefix.length)) =>
  text.split('\n').map((line, i) => (i === 0 ? prefix : line ? rest : '') + line).join('\n');

function block(node) {
  const children = node.content || [];
  switch (node.type) {
    case 'paragraph': return inline(children);
    case 'heading': return `${'#'.repeat(node.attrs?.level || 1)} ${inline(children)}`;
    case 'blockquote': return blocks(children).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'codeBlock': return `\`\`\`${node.attrs?.language || ''}\n${children.map((c) => c.text || '').join('').replace(/\n+$/, '')}\n\`\`\``;
    case 'horizontalRule': return '---';
    case 'bulletList': return children.map((item) => indent(listItem(item), '- ')).join('\n');
    case 'orderedList': {
      const start = node.attrs?.start ?? 1;
      return children.map((item, i) => indent(listItem(item), `${start + i}. `)).join('\n');
    }
    case 'taskList': return children.map((item) => indent(listItem(item), `- [${item.attrs?.checked ? 'x' : ' '}] `, '  ')).join('\n');
    default: return blocks(children);
  }
}

const listItem = (item) => (item.content || []).map(block).join('\n');
const blocks = (nodes) => nodes.map(block).join('\n\n');

export function toMarkdown(note) {
  const parts = [];
  if (note.tags?.length) parts.push(`---\ntags: [${note.tags.join(', ')}]\n---`);
  if (note.title) parts.push(`# ${note.title}`);
  const body = blocks(note.content?.content || []).trim();
  if (body) parts.push(body);
  return `${parts.join('\n\n')}\n`;
}

const safeSegment = (name, fallback) =>
  name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80) || fallback;

// A safe, unique path for each note in an export, inside its folders
// (e.g. "Work/Clients/Kickoff.md").
export function fileNames(notes) {
  const used = new Set();
  return notes.map((note) => {
    const dir = (note.folderPath || []).map((f) => safeSegment(f, 'Folder')).join('/');
    const base = safeSegment(note.title || '', 'Untitled');
    const at = (name) => (dir ? `${dir}/${name}` : name);
    let path = at(`${base}.md`);
    for (let i = 2; used.has(path.toLowerCase()); i += 1) path = at(`${base} (${i}).md`);
    used.add(path.toLowerCase());
    return path;
  });
}

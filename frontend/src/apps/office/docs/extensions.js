import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import DocImageView from './DocImageView';

// The Docs editor schema. The server's allow-list (backend
// apps/office/docContent.js) matches it exactly, so change both together.
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
export const isSafeUrl = (url) => SAFE_URL.test(url);

// A hard page break, like Ctrl+Enter in Word.
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }, { tag: 'br[style*="page-break-before"]' }],
  renderHTML: () => ['div', { 'data-page-break': '', class: 'page-break' }],
  addCommands() {
    return {
      setPageBreak: () => ({ chain }) => chain().insertContent({ type: this.name }).createParagraphNear().run(),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

// An image stored on the server (office_images) and shown only to its owner.
// Imported documents mark images as src="kf-image:<id>".
export const DocImage = Node.create({
  name: 'docImage',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      imageId: { default: null },
      width: { default: null },
      alt: { default: '' },
      align: { default: 'center' },
    };
  },
  parseHTML() {
    return [
      { tag: 'img[data-image-id]', getAttrs: (el) => ({ imageId: el.getAttribute('data-image-id'), alt: el.getAttribute('alt') || '' }) },
      {
        tag: 'img[src^="kf-image:"]',
        getAttrs: (el) => ({
          imageId: el.getAttribute('src').slice('kf-image:'.length),
          alt: el.getAttribute('alt') || '',
          width: Number(el.getAttribute('width')) || null,
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes({ 'data-image-id': HTMLAttributes.imageId, alt: HTMLAttributes.alt })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DocImageView);
  },
});

export const docExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
    code: false,
    codeBlock: false,
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      isAllowedUri: (url) => SAFE_URL.test(url),
    },
  }),
  TextStyleKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  TableKit.configure({ table: { resizable: true } }),
  PageBreak,
  DocImage,
];

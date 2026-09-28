import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';

// The one editor schema for notes. The server's allow-list (backend
// apps/notes/content.js) matches it exactly, so change both together.
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export const noteExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      isAllowedUri: (url) => SAFE_URL.test(url),
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
];

export const isSafeUrl = (url) => SAFE_URL.test(url);

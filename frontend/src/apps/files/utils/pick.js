import { useWorkspace } from '../../../core/context/WorkspaceContext';

// Small helpers for other apps that pick files from Files (components/FilePicker.jsx),
// kept apart from the picker so using them doesn't load it.

// Whether the person can use Files in this workspace: the app is on and they
// have access to it. Callers show their "from Files" option only then.
export function useFilesAvailable() {
  const { isEnabled, accessOf } = useWorkspace();
  return isEnabled('files') && accessOf('files') !== 'none';
}

// Filters for the picker's `accept`: pictures Office can insert, or files by extension.
export const acceptImages = (item) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(item.mime);
export const acceptExtensions = (...exts) => (item) => exts.some((e) => item.name.toLowerCase().endsWith(`.${e}`));

import { lazy, Suspense, useState } from 'react';
import { faLaptop, faHardDrive } from '@fortawesome/free-solid-svg-icons';
import { useFilesAvailable } from '../files/utils/pick';

// Lets the Office editors take files from the Files app as well as from the
// computer: pictures to insert, and Word, Excel or PowerPoint files to open.
// The picker loads only when it's first opened.
const FilePicker = lazy(() => import('../files/components/FilePicker'));

// [open, picker]: open(options) shows the Files picker (see FilePicker for the
// options), and `picker` is the element to render. open is null when Files
// isn't available to this person, so callers can leave the option out.
export function useFilesPicker() {
  const available = useFilesAvailable();
  const [options, setOptions] = useState(null);
  const picker = options && (
    <Suspense fallback={null}>
      <FilePicker {...options} onClose={() => setOptions(null)} />
    </Suspense>
  );
  return [available ? setOptions : null, picker];
}

// A menu entry that takes a file from the computer or from Files. With Files
// available it opens a submenu with both; otherwise it's the usual single entry.
export function sourceItem({ label, icon, computer, files, disabled }) {
  if (!files) return { label: `${label}…`, icon, onClick: computer, disabled };
  return {
    label,
    icon,
    disabled,
    items: [
      { label: 'From this computer…', icon: faLaptop, onClick: computer },
      { label: 'From Files…', icon: faHardDrive, onClick: files },
    ],
  };
}

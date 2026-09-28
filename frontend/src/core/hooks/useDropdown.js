import { useEffect, useRef, useState } from 'react';

// Open/close state for a dropdown that closes on any click outside it.
// Put `ref` on the element that wraps both the toggle and the menu.
export default function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return { open, setOpen, ref };
}

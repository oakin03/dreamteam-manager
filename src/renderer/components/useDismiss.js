import { useEffect, useRef } from 'react';

// A dropdown closes on a click outside it (an empty spot or another button) and on Escape
// (user 2026-11-21). Put the returned ref on the element that holds both the button and the menu.
export default function useDismiss(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return ref;
}

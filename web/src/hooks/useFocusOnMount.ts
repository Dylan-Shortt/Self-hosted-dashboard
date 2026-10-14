import { useEffect, useRef } from 'react';

/**
 * Moves keyboard focus to an element when it mounts. The page swaps whole screens
 * (login, dashboard), and without this focus would fall back to the top of the document.
 * The element needs tabIndex={-1} to be focusable.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return ref;
}

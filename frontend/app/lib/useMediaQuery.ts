'use client';

import { useSyncExternalStore } from 'react';

// Subscribe to matchMedia without copying browser state into an effect.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // the server has no viewport, so it renders the wide layout and the client
    // corrects on hydration
    () => false,
  );
}

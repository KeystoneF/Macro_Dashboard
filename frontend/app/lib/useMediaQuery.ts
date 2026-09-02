'use client';

import { useSyncExternalStore } from 'react';

// Inline styles cannot express a media query, and the sidebar already knows how
// to draw itself narrow. So rather than have CSS fight the inline width with
// !important, the component asks the browser directly and collapses itself.
//
// useSyncExternalStore rather than an effect: matchMedia is external state, and
// reading it into useState from an effect is the cascading-render pattern React
// now warns about.
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

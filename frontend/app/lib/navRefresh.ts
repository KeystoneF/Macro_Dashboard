'use client';

import { useEffect } from 'react';

// Clicking a nav item is a request for current figures, and on the module
// already on screen Next does not remount the route, so nothing refetches and
// the board sits on whatever the last poll left. The click says so out loud
// instead, and the page it names reloads.
const EVENT = 'desk:reload';

export const announceNav = (slug: string) => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: slug }));
};

export function useNavRefresh(slug: string, reload: () => void) {
  useEffect(() => {
    const onNav = (e: Event) => {
      if ((e as CustomEvent<string>).detail === slug) reload();
    };
    window.addEventListener(EVENT, onNav);
    return () => window.removeEventListener(EVENT, onNav);
  }, [slug, reload]);
}

// A desk left open in a background tab has its timers throttled, so coming
// back to it is the other moment the figures on screen are older than they
// look.
export function useFocusRefresh(reload: () => void) {
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [reload]);
}

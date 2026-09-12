'use client';

import { useEffect } from 'react';

// Refresh when clicking the current route, which Next does not remount.
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

// Refresh on return from a background tab, where timers may be throttled.
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

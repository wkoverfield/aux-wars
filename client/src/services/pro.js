import { useEffect, useState } from 'react';

/**
 * Pro-pack token storage. After a verified Stripe purchase we store a proToken
 * on the device; passing it to hostGame flags the room as Pro (ad-free + bigger).
 * No accounts — the token IS the entitlement, scoped to this browser.
 */

const PRO_TOKEN_KEY = 'aux-wars-pro-token';
const PRO_EVENT = 'aux-wars-pro-changed';

export function getProToken() {
  try {
    return localStorage.getItem(PRO_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setProToken(token) {
  try {
    localStorage.setItem(PRO_TOKEN_KEY, token);
  } catch {
    /* ignore storage errors */
  }
  window.dispatchEvent(new Event(PRO_EVENT));
}

/** Reactive "is this device Pro?" — re-renders consumers when the token changes. */
export function useIsPro() {
  const [isPro, setIsPro] = useState(() => Boolean(getProToken()));
  useEffect(() => {
    const handler = () => setIsPro(Boolean(getProToken()));
    window.addEventListener(PRO_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(PRO_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return isPro;
}

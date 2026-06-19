import { useEffect, useState } from 'react';

/**
 * Ads + cookie-consent plumbing.
 *
 * Everything here is DARK until VITE_ADSENSE_CLIENT is set (post-AdSense
 * approval). With it unset, `adsConfigured()` is false, so AdSlot renders
 * nothing and the cookie banner never shows — zero visible change to the game.
 */

export const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT || '';
const ADSENSE_SCRIPT_ID = 'aux-wars-adsense-script';

const AD_SLOTS = {
  home: import.meta.env.VITE_ADSENSE_SLOT_HOME || '',
  lobby: import.meta.env.VITE_ADSENSE_SLOT_LOBBY || '',
  wait: import.meta.env.VITE_ADSENSE_SLOT_WAIT || '',
  results: import.meta.env.VITE_ADSENSE_SLOT_RESULTS || '',
  gameover: import.meta.env.VITE_ADSENSE_SLOT_GAMEOVER || '',
};

const CONSENT_KEY = 'aux-wars-cookie-consent'; // 'accepted' | 'rejected' | null
const CONSENT_EVENT = 'aux-wars-consent-changed';

/** True only when an AdSense client id is configured. */
export function adsConfigured() {
  return Boolean(ADSENSE_CLIENT);
}

export function getAdSlotId(placement) {
  return AD_SLOTS[placement] || '';
}

export function getConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

export function setConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* ignore storage errors */
  }
  // Notify same-tab listeners (storage event only fires cross-tab).
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Reactive consent value: re-renders consumers when consent changes. */
export function useConsent() {
  const [consent, setConsentState] = useState(getConsent);
  useEffect(() => {
    const handler = () => setConsentState(getConsent());
    window.addEventListener(CONSENT_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(CONSENT_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return consent;
}

/** Whether we're allowed to serve ads right now. */
export function adsAllowed(consent) {
  return adsConfigured() && consent === 'accepted';
}

export function loadAdSenseScript() {
  if (!ADSENSE_CLIENT || typeof document === 'undefined') return;
  if (document.getElementById(ADSENSE_SCRIPT_ID)) return;

  const script = document.createElement('script');
  script.id = ADSENSE_SCRIPT_ID;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
  document.head.appendChild(script);
}

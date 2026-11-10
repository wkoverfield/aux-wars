/**
 * AdSense plumbing.
 *
 * Everything here is DARK until VITE_ADSENSE_CLIENT is set (post-AdSense
 * approval). With it unset, `adsConfigured()` is false and AdSlot renders
 * nothing, so there is zero visible change to the game.
 *
 * Consent is handled by Google's certified CMP (AdSense > Privacy & messaging),
 * which the AdSense script shows to visitors in regions that require it. The
 * app has no cookie banner of its own.
 *
 * Where ads may appear (YouTube API Developer Policies III.G.1.d): never on a
 * screen that shows YouTube API data (the player, thumbnails, video or song
 * titles from YouTube). The placements below are the screens without it:
 * home, lobby (private and public), the waiting screen, /faq and /aux-battle.
 * Round results, game over, song selection and rating show YouTube data and
 * have no slot. /screen (the shared TV display) never gets one either: an ad
 * there is rebroadcast to a room, which AdSense counts as invalid traffic.
 * Keep AdSense Auto ads OFF for the site, since they would place ads on any
 * screen, including the ones above.
 */

export const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT || '';
const ADSENSE_SCRIPT_ID = 'aux-wars-adsense-script';

const AD_SLOTS = {
  home: import.meta.env.VITE_ADSENSE_SLOT_HOME || '',
  lobby: import.meta.env.VITE_ADSENSE_SLOT_LOBBY || '',
  wait: import.meta.env.VITE_ADSENSE_SLOT_WAIT || '',
  faq: import.meta.env.VITE_ADSENSE_SLOT_FAQ || '',
  auxBattle: import.meta.env.VITE_ADSENSE_SLOT_AUX_BATTLE || '',
};

/** The ad-safe placements AdSlot accepts. */
export const AD_PLACEMENTS = Object.keys(AD_SLOTS);

// A choice stored by the cookie banner earlier builds showed. PostHog still
// honors a stored "rejected" (see services/posthog.js); nothing writes it now.
export const CONSENT_KEY = 'aux-wars-cookie-consent'; // 'accepted' | 'rejected' | null
export const CONSENT_EVENT = 'aux-wars-consent-changed';

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

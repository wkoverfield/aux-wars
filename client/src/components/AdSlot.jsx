import { useEffect, useRef } from 'react';
import { ADSENSE_CLIENT, adsAllowed, getAdSlotId, loadAdSenseScript, useConsent } from '../services/ads';
import { useRoomOptional } from '../services/RoomProvider';

/**
 * AdSlot — renders a single AdSense unit, but ONLY on ad-safe screens and ONLY when:
 *   1. VITE_ADSENSE_CLIENT is configured (otherwise dark — renders nothing), AND
 *   2. the user has accepted cookies, AND
 *   3. the current room is NOT a pro (ad-free) room.
 *
 * Never place this on the song-selection or rating screens (audio playback) — both
 * for UX and to stay clear of any music-source ToS concerns.
 *
 * @param {string} props.slot   - AdSense ad slot id (data-ad-slot)
 * @param {string} props.format - AdSense format (default "auto")
 * @param {string} props.className
 */
export default function AdSlot({ slot, format = 'auto', className = '' }) {
  const consent = useConsent();
  const roomCtx = useRoomOptional();
  const isProRoom = Boolean(roomCtx?.room?.settings?.hostPro);
  const insRef = useRef(null);
  const adSlotId = getAdSlotId(slot);

  const enabled = adsAllowed(consent) && !isProRoom && Boolean(adSlotId);

  useEffect(() => {
    if (!enabled) return;
    loadAdSenseScript();
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* adsbygoogle not ready yet; it will fill on next push */
    }
  }, [enabled, slot]);

  if (!enabled) return null;

  return (
    <div className={`ad-slot w-full flex justify-center my-4 ${className}`}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block', width: '100%' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={adSlotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}

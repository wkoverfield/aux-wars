import { useEffect } from 'react';
import { ADSENSE_CLIENT, adsConfigured, getAdSlotId, loadAdSenseScript } from '../services/ads';
import { useRoomOptional } from '../services/RoomProvider';

/**
 * AdSlot renders a single AdSense unit, and ONLY when:
 *   1. VITE_ADSENSE_CLIENT is configured (otherwise dark, renders nothing), AND
 *   2. the placement has a slot id configured, AND
 *   3. the current room is NOT a pro (ad-free) room.
 * Consent is collected by Google's CMP, which the AdSense script loads.
 *
 * Only place this on screens with no YouTube API data (player, thumbnails,
 * titles) and never on /screen. The allowed placements and the reasons are in
 * services/ads.js.
 *
 * @param {string} props.slot   - placement name from services/ads.js (home, lobby, wait, faq, auxBattle)
 * @param {string} props.format - AdSense format (default "auto")
 * @param {string} props.className
 */
export default function AdSlot({ slot, format = 'auto', className = '' }) {
  const roomCtx = useRoomOptional();
  const isProRoom = Boolean(roomCtx?.room?.settings?.hostPro);
  const adSlotId = getAdSlotId(slot);

  const enabled = adsConfigured() && !isProRoom && Boolean(adSlotId);

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

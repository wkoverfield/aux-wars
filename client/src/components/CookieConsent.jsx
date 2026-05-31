import { Link } from 'react-router-dom';
import { adsConfigured, getConsent, setConsent, useConsent } from '../services/ads';

/**
 * CookieConsent — minimal GDPR/CCPA banner shown once, the first time a user
 * visits while ads are configured. Choice is stored in localStorage and gates
 * whether AdSlot serves personalized ads.
 *
 * Renders nothing when ads aren't configured (VITE_ADSENSE_CLIENT unset) or once
 * the user has made a choice.
 */
export default function CookieConsent() {
  const consent = useConsent();

  // Only show when ads are live and the user hasn't chosen yet.
  if (!adsConfigured() || consent || getConsent()) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] p-4 flex justify-center">
      <div className="max-w-2xl w-full bg-[#181818] border border-gray-700 rounded-lg shadow-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
        <p className="text-sm text-gray-300 flex-1">
          We use cookies for ads to keep Aux Wars free. See our{' '}
          <Link to="/privacy" className="text-[#68d570] underline">privacy policy</Link>.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setConsent('rejected')}
            className="px-4 py-2 rounded-md text-sm text-white bg-[#242424] hover:bg-[#333] transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => setConsent('accepted')}
            className="px-4 py-2 rounded-md text-sm font-semibold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

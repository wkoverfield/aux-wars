import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { setProToken } from '../../services/pro';

/**
 * /pro/restore — re-attach Pro on a new device/browser using the Pro code shown
 * after purchase. Email restore needs a proper magic-link flow before launch.
 */
export default function ProRestore() {
  const validateProToken = useAction(api.stripe.validateProToken);
  const navigate = useNavigate();

  const [codeInput, setCodeInput] = useState('');
  const [status, setStatus] = useState(null); // null | working | notfound | done | error

  const restoreCode = async () => {
    if (!codeInput.trim() || status === 'working') return;
    setStatus('working');
    try {
      const res = await validateProToken({ proToken: codeInput.trim() });
      if (res?.valid) {
        setProToken(codeInput.trim());
        setStatus('done');
      } else {
        setStatus('notfound');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="min-h-svh w-full text-white px-6 py-16 flex flex-col items-center text-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-2">Restore Pro</h1>
        <p className="text-gray-400 text-sm mb-8">
          Bought Pro on another device? Restore it here with the Pro code shown after purchase.
        </p>

        {status === 'done' ? (
          <div className="bg-[#181818] border border-[#68d570] rounded-lg p-6">
            <p className="text-[#68d570] font-semibold mb-4">★ Pro restored on this device!</p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors"
            >
              Host a game
            </button>
          </div>
        ) : (
          <div className="space-y-6 text-left">
            <div>
              <label className="block text-sm text-gray-300 mb-2">Pro code</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="paste your Pro code"
                  className="flex-1 bg-[#181818] border border-gray-700 rounded-md px-3 py-2 text-white"
                />
                <button
                  onClick={restoreCode}
                  disabled={status === 'working'}
                  className="px-4 py-2 rounded-md font-semibold text-black bg-[#68d570] hover:bg-[#7de884] disabled:opacity-60"
                >
                  Restore
                </button>
              </div>
            </div>

            {status === 'notfound' && (
              <p className="text-amber-400 text-sm text-center">
                No active Pro found for that code. Double-check it, or reach out via Feedback.
              </p>
            )}
            {status === 'error' && (
              <p className="text-red-400 text-sm text-center">Something went wrong — please try again.</p>
            )}
          </div>
        )}

        <div className="mt-8">
          <Link to="/" className="text-gray-400 underline text-sm">← Back to Aux Wars</Link>
        </div>
      </div>
    </div>
  );
}

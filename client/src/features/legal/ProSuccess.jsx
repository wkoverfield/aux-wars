import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { setProToken } from '../../services/pro';

/**
 * /pro/success — Stripe redirects here after checkout with ?session_id=...
 * We verify the session server-side, store the issued proToken, and confirm.
 */
export default function ProSuccess() {
  const verifyCheckout = useAction(api.stripe.verifyCheckout);
  const [status, setStatus] = useState('verifying'); // verifying | success | pending | error
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // guard against double-run in StrictMode
    ranRef.current = true;

    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (!sessionId) {
      setStatus('error');
      return;
    }
    verifyCheckout({ sessionId })
      .then((res) => {
        if (res?.proToken) {
          setProToken(res.proToken);
          setStatus('success');
        } else {
          setStatus('pending'); // payment not completed/confirmed yet
        }
      })
      .catch(() => setStatus('error'));
  }, [verifyCheckout]);

  return (
    <div className="min-h-svh w-full text-white px-6 py-16 flex flex-col items-center justify-center text-center">
      {status === 'verifying' && (
        <>
          <div className="h-12 w-12 rounded-full border-4 border-[#242424] border-t-[#68d570] animate-spin mb-6" />
          <p className="text-lg">Confirming your purchase…</p>
        </>
      )}

      {status === 'success' && (
        <>
          <h1 className="text-3xl font-bold mb-3">You're Pro! 🎉</h1>
          <p className="text-gray-300 max-w-md mb-8">
            Thanks for supporting Aux Wars. Games you host are now <strong>ad-free</strong> for
            everyone in the room and support <strong>bigger lobbies</strong>.
          </p>
          <Link
            to="/"
            className="px-6 py-3 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors"
          >
            Host a game
          </Link>
        </>
      )}

      {status === 'pending' && (
        <>
          <h1 className="text-2xl font-bold mb-3">Payment not confirmed</h1>
          <p className="text-gray-300 max-w-md mb-8">
            We couldn't confirm a completed payment for this session yet. If you were charged,
            give it a moment and refresh — otherwise you can try again.
          </p>
          <Link to="/" className="text-[#68d570] underline">Back to Aux Wars</Link>
        </>
      )}

      {status === 'error' && (
        <>
          <h1 className="text-2xl font-bold mb-3">Something went wrong</h1>
          <p className="text-gray-300 max-w-md mb-8">
            We couldn't verify your purchase. If you were charged, reach out via the Feedback
            button and we'll sort it out.
          </p>
          <Link to="/" className="text-[#68d570] underline">Back to Aux Wars</Link>
        </>
      )}
    </div>
  );
}

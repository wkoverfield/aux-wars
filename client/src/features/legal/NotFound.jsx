import { Link } from 'react-router-dom';
import { useNoIndex } from '../../hooks/useNoIndex';

/**
 * Any URL the app has no route for. The host serves the app for every path
 * with a 200, so this page marks itself noindex to keep stray URLs out of
 * search results.
 */
export default function NotFound() {
  useNoIndex('Page not found | Aux Wars');
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-sm text-gray-400">There&apos;s nothing at this address.</p>
      <Link to="/" className="mt-2 text-[#68d570] underline text-sm">Go to Aux Wars</Link>
    </div>
  );
}

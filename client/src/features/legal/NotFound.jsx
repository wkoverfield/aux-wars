import { Link } from 'react-router-dom';
import { useNoIndex } from '../../hooks/useNoIndex';

/**
 * Any URL the app has no route for. The build also renders it into 404.html,
 * which the host serves with a 404 status for unknown paths. It marks itself
 * noindex for client-side navigation to an unknown path.
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

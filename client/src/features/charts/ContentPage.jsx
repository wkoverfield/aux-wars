import { useLocation } from 'react-router-dom';
import { usePageData } from '../../data/pageData';
import NotFound from '../legal/NotFound';
import ArtistPage from './ArtistPage';
import ChartsPage from './ChartsPage';
import SongPage from './SongPage';

const PAGES = { charts: ChartsPage, song: SongPage, artist: ArtistPage };

const trimmed = (path) => path.replace(/\/+$/, '') || '/';

/**
 * Route element for /charts, /charts/:week, /song/:slug and /artist/:slug.
 *
 * A content page exists only as a prerendered document that carries its own
 * model (see data/pageData.js). This renders that model when it belongs to
 * the current path, and the 404 page otherwise: a client-side navigation to a
 * content path has no model, and neither does the dev server.
 */
export default function ContentPage() {
  const page = usePageData()?.page;
  const { pathname } = useLocation();
  const Page = page && trimmed(page.path) === trimmed(pathname) ? PAGES[page.kind] : null;
  return Page ? <Page data={page} /> : <NotFound />;
}

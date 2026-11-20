import { usePageData } from '../../data/pageData';

/**
 * Homepage line linking to /charts: the most picked song of the week, or of
 * all time before a second chart week exists. The song comes from the build
 * data in the document (data/pageData.js); with none, this renders nothing.
 * A plain <a href>, because /charts is a separate static document.
 */
export default function MostPickedLine() {
  const line = usePageData()?.home;
  if (!line?.title || !line?.artist) return null;
  const label = line.weekly ? 'Most picked this week' : 'Most picked';
  return (
    <a
      href="/charts"
      className="px-4 text-center text-xs text-gray-400 hover:text-white underline underline-offset-2"
    >
      {`${label}: ${line.title} by ${line.artist}`}
    </a>
  );
}

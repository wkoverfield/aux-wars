import { Link } from 'react-router-dom';
import AdSlot from '../../components/AdSlot';
import { FAQ } from '../../data/faq';
import { usePageTitle } from '../../hooks/usePageTitle';

/**
 * Answers to what newcomers ask before playing. The build renders this
 * component into faq.html (see src/prerender/), so it must render without
 * browser APIs or Convex data.
 */
export default function Faq() {
  usePageTitle('/faq');

  return (
    <div className="h-full w-full overflow-y-auto text-white px-6 py-12 flex justify-center">
      <div className="max-w-2xl w-full pb-16">
        <Link to="/" className="text-[#68d570] underline text-sm">← Back to Aux Wars</Link>
        <h1 className="text-3xl font-bold mt-6 mb-8">Questions</h1>
        <dl className="space-y-6">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt className="text-lg font-semibold text-white">{q}</dt>
              <dd className="text-sm text-gray-300 leading-relaxed mt-1">{a}</dd>
            </div>
          ))}
        </dl>
        <Link to="/" className="inline-block mt-10 py-3 px-6 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors">
          Play Aux Wars
        </Link>
        <AdSlot slot="faq" className="mt-10" />
      </div>
    </div>
  );
}

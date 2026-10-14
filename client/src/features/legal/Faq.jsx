import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FAQ, FAQ_PAGE } from '../../data/faq';

/**
 * Answers to what newcomers ask before playing. The build also writes this
 * page as static HTML (faq.html, see vite.config.js) with the same markup,
 * so keep the two in step when changing the layout.
 */
export default function Faq() {
  useEffect(() => {
    const previous = document.title;
    document.title = FAQ_PAGE.title;
    return () => {
      document.title = previous;
    };
  }, []);

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
      </div>
    </div>
  );
}

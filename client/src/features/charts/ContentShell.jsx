import { plural } from '../../data/contentFormat';

const LINK = 'underline decoration-white/30 underline-offset-2 hover:decoration-white';

/**
 * Page frame for the content pages (charts, song, artist): the same column as
 * /faq, a path line at the top and the site links at the bottom.
 *
 * The column is sized by its content (self-start), not stretched to the
 * scroller's height, so its bottom padding stays below the last link when the
 * page scrolls. Titles and names come from outside and can hold one very long
 * word: wrap-anywhere lets them break inside the word instead of widening
 * the page.
 *
 * Content pages are static documents. Every link on them is a plain <a href>,
 * so each one loads its own HTML file and that file's build data.
 */
export default function ContentShell({ trail = [], children }) {
  return (
    <div className="h-full w-full overflow-y-auto text-white px-6 py-12 flex justify-center">
      <div className="max-w-2xl w-full min-w-0 self-start pb-16 wrap-anywhere">
        <nav aria-label="Breadcrumb" className="text-sm text-gray-400">
          <a href="/" className="hover:text-white underline underline-offset-2">Aux Wars</a>
          {trail.map(({ label, href }) => (
            <span key={href}>
              <span aria-hidden="true" className="mx-2">/</span>
              <a href={href} className="hover:text-white underline underline-offset-2">{label}</a>
            </span>
          ))}
        </nav>
        {children}
        <footer className="mt-12 pt-6 border-t border-white/10 text-xs text-gray-400">
          <p>These numbers come from real games played on Aux Wars. Picks and ratings are anonymous.</p>
          <nav aria-label="Site" className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <a href="/" className="hover:text-white underline underline-offset-2">Aux Wars</a>
            <a href="/charts" className="hover:text-white underline underline-offset-2">Charts</a>
            <a href="/aux-battle" className="hover:text-white underline underline-offset-2">What is an aux battle?</a>
            <a href="/faq" className="hover:text-white underline underline-offset-2">FAQ</a>
            <a href="/privacy" className="hover:text-white underline underline-offset-2">Privacy</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}

/** A link when the target page exists in this build, plain text otherwise. */
export function PageLink({ href, className = '', children }) {
  return href ? (
    <a href={href} className={`${LINK} ${className}`}>{children}</a>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** One figure in a stat row: the number above its label. */
export function Stat({ label, value }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-gray-400 mt-1">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** "Picked most for": the prompts a song or artist is picked for, with counts. */
export function PromptList({ prompts }) {
  if (!prompts.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold mb-3">Picked most for</h2>
      <ul className="divide-y divide-white/10">
        {prompts.map(({ prompt, picks }) => (
          <li key={prompt} className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-sm text-gray-300">{prompt}</span>
            <span className="shrink-0 text-sm text-gray-400 tabular-nums">{plural(picks, 'pick')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A song row with its pick count and average rating, for the song lists on song and artist pages. */
export function SongRow({ rank, title, href, picks, average }) {
  return (
    <li className="flex items-baseline gap-3 py-2">
      {rank != null && (
        <span className="w-6 shrink-0 text-right text-sm text-gray-400 tabular-nums">{rank}</span>
      )}
      <PageLink href={href} className="min-w-0 flex-1 text-sm font-semibold text-white">{title}</PageLink>
      <span className="shrink-0 text-sm text-gray-400 tabular-nums">
        {average ? `${plural(picks, 'pick')}, ${average} avg` : plural(picks, 'pick')}
      </span>
    </li>
  );
}

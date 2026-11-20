import AdSlot from '../../components/AdSlot';
import { formatAverage, formatCount, plural } from '../../data/contentFormat';
import ContentShell, { PageHeader, PageLink, PromptList, SongRow, Stat } from './ContentShell';

const RATINGS = [5, 4, 3, 2, 1];

/**
 * How many times players gave each rating, as five bars sized against the
 * largest. A count of zero draws no bar. Any other count draws at least a
 * full dot (min-w-2.5, the bar's height), so a share of a percent or two does
 * not render as a clipped sliver of the rounded end.
 */
function RatingSpread({ hist, ratingCount }) {
  const largest = Math.max(...hist, 0);
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold">Rating spread</h2>
      <p className="text-xs text-gray-400 mt-1 mb-3">
        {`${plural(ratingCount, 'rating')}, from 5 down to 1.`}
      </p>
      <ol className="space-y-2">
        {RATINGS.map((rating) => {
          const count = hist[rating - 1] ?? 0;
          const width = largest > 0 ? Math.round((count / largest) * 1000) / 10 : 0;
          return (
            <li key={rating} className="flex items-center gap-3 text-sm">
              <span className="w-4 shrink-0 text-right text-gray-400 tabular-nums">
                <span className="sr-only">Rated </span>
                {rating}
              </span>
              <span className="h-2.5 flex-1 rounded-full bg-white/10 overflow-hidden">
                {count > 0 && (
                  <span className="block h-full min-w-2.5 rounded-full bg-white/70" style={{ width: `${width}%` }} />
                )}
              </span>
              <span className="w-12 shrink-0 text-right text-gray-300 tabular-nums">{formatCount(count)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * One published song: its pick and rating numbers from Aux Wars games.
 * Renders only from `data`, the model built by data/contentPages.js, so the
 * static HTML and the mounted app match. Text and numbers, plus the song's
 * cover from the Cover Art Archive when it has one.
 */
export default function SongPage({ data }) {
  const average = formatAverage(data.average);
  return (
    <ContentShell trail={[{ label: 'Charts', href: '/charts' }]}>
      <PageHeader image={data.image}>
        <h1 className={data.image ? 'text-3xl font-bold' : 'text-3xl font-bold mt-6'}>{data.title}</h1>
        <p className="mt-2 text-gray-300">
          <PageLink href={data.artist.href}>{data.artist.name}</PageLink>
          {data.year != null && <span className="text-gray-400">{`, ${data.year}`}</span>}
        </p>
      </PageHeader>

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Stat label="Times picked" value={formatCount(data.picks)} />
        {average && <Stat label="Average rating out of 5" value={average} />}
        {data.winRate != null && <Stat label="Round win rate" value={`${data.winRate}%`} />}
        <Stat label="Rank by picks" value={`#${formatCount(data.rank)}`} />
      </dl>

      <RatingSpread hist={data.ratingHist} ratingCount={data.ratingCount} />
      <AdSlot slot="song" className="mt-10" />
      <PromptList prompts={data.topPrompts} />

      {data.moreByArtist.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold mb-3">{`More by ${data.artist.name}`}</h2>
          <ul className="divide-y divide-white/10">
            {data.moreByArtist.map((song) => (
              <SongRow
                key={song.href}
                title={song.title}
                href={song.href}
                picks={song.picks}
                average={formatAverage(song.average)}
              />
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-sm text-gray-300">
        <PageLink href="/">Start a game on Aux Wars</PageLink>
      </p>
    </ContentShell>
  );
}

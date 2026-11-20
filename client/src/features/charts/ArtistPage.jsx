import AdSlot from '../../components/AdSlot';
import { formatAverage, formatCount } from '../../data/contentFormat';
import ContentShell, { PageHeader, PromptList, SongRow, Stat } from './ContentShell';

/**
 * One published artist: total picks, average rating and their published
 * songs ranked by picks. Renders only from `data`, the model built by
 * data/contentPages.js, so the static HTML and the mounted app match. Text
 * and numbers, plus one image when there is one: a Wikimedia Commons photo
 * of the artist, credited in the footer, or the cover of their most picked
 * song.
 */
export default function ArtistPage({ data }) {
  const average = formatAverage(data.average);
  return (
    <ContentShell
      trail={[{ label: 'Charts', href: '/charts' }]}
      footerNote={
        data.credit && (
          <a href={data.credit.pageUrl} rel="noopener" className="hover:text-white underline underline-offset-2">
            {`Photo: ${data.credit.author}, ${data.credit.license}, via Wikimedia Commons`}
          </a>
        )
      }
    >
      <PageHeader image={data.image}>
        <h1 className={data.image ? 'text-3xl font-bold' : 'text-3xl font-bold mt-6'}>{data.name}</h1>
      </PageHeader>

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Stat label="Total picks" value={formatCount(data.picks)} />
        {average && <Stat label="Average rating out of 5" value={average} />}
      </dl>

      {data.songs.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold mb-3">Songs</h2>
          <ol className="divide-y divide-white/10">
            {data.songs.map((song) => (
              <SongRow
                key={song.rank}
                rank={song.rank}
                title={song.title}
                href={song.href}
                picks={song.picks}
                average={formatAverage(song.average)}
              />
            ))}
          </ol>
        </section>
      )}

      <AdSlot slot="artist" className="mt-10" />
      <PromptList prompts={data.topPrompts} />
    </ContentShell>
  );
}

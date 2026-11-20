import AdSlot from '../../components/AdSlot';
import { formatAverage, formatCount } from '../../data/contentFormat';
import ContentShell, { PageLink } from './ContentShell';

// What a list ranks by, and how its number reads.
const LISTS = {
  movers: { caption: 'Picks during the week.', value: (n) => `+${formatCount(n)}` },
  mostPickedSongs: { caption: 'Total picks.', value: formatCount },
  mostPickedArtists: { caption: 'Total picks across all of their songs.', value: formatCount },
  highestRated: { caption: 'Average rating out of 5.', value: formatAverage },
  mostDivisive: {
    caption: 'Spread of the ratings. A higher number means players disagreed more.',
    value: formatAverage,
  },
};

function ChartList({ list }) {
  const { caption, value } = LISTS[list.key];
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold">{list.title}</h2>
      <p className="text-xs text-gray-400 mt-1 mb-2">{caption}</p>
      <ol className="divide-y divide-white/10">
        {list.rows.map((row) => (
          <li key={row.rank} className="flex items-baseline gap-3 py-2">
            <span className="w-6 shrink-0 text-right text-sm text-gray-400 tabular-nums">{row.rank}</span>
            <span className="min-w-0 flex-1">
              <PageLink href={row.href} className="text-sm font-semibold text-white">{row.title}</PageLink>
              {row.artist && (
                <span className="block text-xs text-gray-400">
                  <PageLink href={row.artist.href}>{row.artist.name}</PageLink>
                </span>
              )}
            </span>
            <span className="shrink-0 text-sm text-gray-300 tabular-nums">{value(row.value)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A week of charts: /charts for the latest week and /charts/<week> for a
 * week whose note is approved. Renders only from `data`, the model built by
 * data/contentPages.js, so the static HTML and the mounted app match.
 */
export default function ChartsPage({ data }) {
  const [first, ...rest] = data.lists;
  return (
    <ContentShell trail={data.path === '/charts' ? [] : [{ label: 'Charts', href: '/charts' }]}>
      <h1 className="text-3xl font-bold mt-6 mb-2">Aux Wars Charts</h1>
      <p className="text-gray-400 text-sm">{data.range}</p>

      {data.note && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{data.noteLabel}</h2>
          <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
            {data.note.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}

      {first && <ChartList list={first} />}
      <AdSlot slot="charts" className="mt-10" />
      {rest.map((list) => (
        <ChartList key={list.key} list={list} />
      ))}

      {data.weeks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold mb-3">{data.weeksTitle}</h2>
          <ul className="space-y-2 text-sm text-gray-300">
            {data.weeks.map((week) => (
              <li key={week.href}>
                <PageLink href={week.href}>{week.label}</PageLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ContentShell>
  );
}

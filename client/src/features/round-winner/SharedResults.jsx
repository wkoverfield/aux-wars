import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { AnimatePresence } from 'framer-motion';
import { api } from '../../../../convex/_generated/api';
import ScrollFade from '../../components/ScrollFade';
import { useNoIndex } from '../../hooks/useNoIndex';
import logo from '../../assets/aux-wars-logo.svg';
import { computeAwards } from './computeAwards';
import { pickReel, recapSummary, standingsFrom, withCovers, withNonSubmitters } from './resultsModel';
import SetlistModal from './SetlistModal';
import Standings from './Standings';

function Shell({ children, footer = null }) {
  return (
    <div data-vital="shared-results" className="h-[100svh] w-full flex flex-col text-white">
      <ScrollFade className="flex-1 min-h-0 w-full" contentClassName="min-h-full flex flex-col items-center w-full max-w-2xl mx-auto px-2 py-6">
        <div className="flex items-center gap-2">
          <img src={logo} alt="" className="w-8" />
          <p className="text-xl">Aux Wars</p>
        </div>
        {children}
      </ScrollFade>
      {footer}
    </div>
  );
}

/** What the game is, for a visitor who has never played. Ends the scrolling content. */
function Pitch() {
  return (
    <p className="w-full max-w-md mt-auto pt-8 px-3 text-sm text-white/50 text-center">
      Aux Wars is a free music party game. Get a prompt, pick a song, rate each other&apos;s picks.
    </p>
  );
}

/** The page's one primary action: start a game of your own. Sits below the scrolling content, always in view. */
function HostAction({ onHost }) {
  return (
    <div className="shrink-0 w-full max-w-md mx-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        data-vital="host"
        onClick={onHost}
        className="w-full py-3 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors"
      >
        Host your own game
      </button>
    </div>
  );
}

/**
 * A finished game's results, opened from a shared link: the standings, the
 * awards and everyone's setlist, read from a saved snapshot (the room itself
 * may be long gone). Not indexed by search engines.
 */
export default function SharedResults() {
  const { shareId } = useParams();
  const navigate = useNavigate();
  const data = useQuery(api.results.get, shareId ? { shareId } : 'skip');
  const logEvent = useMutation(api.analytics.logEvent);
  const [setlistPlayer, setSetlistPlayer] = useState(null);
  useNoIndex('Aux Wars results');

  // A cover the snapshot rejected (not from a music catalog) shows as a plain square.
  const rounds = useMemo(() => (data ? withCovers(data.rounds) : []), [data]);
  // Awards are worked out from the players who submitted songs; the page lists everyone.
  const ranked = useMemo(() => standingsFrom(rounds), [rounds]);
  const players = useMemo(() => (data ? withNonSubmitters(ranked, data.voterAwards, data.players) : ranked), [data, ranked]);
  const awards = useMemo(
    () =>
      data
        ? pickReel(
            computeAwards({ playerStats: ranked, allRounds: rounds, voterAwards: data.voterAwards, players: data.players, seed: data.seed }),
            data.seed
          )
        : [],
    [data, ranked, rounds]
  );

  // Count one view per page load, once the results are known to exist.
  const found = Boolean(data);
  useEffect(() => {
    if (found) logEvent({ eventType: 'result_viewed' }).catch(() => {});
  }, [found, logEvent]);

  const goHome = () => navigate('/');

  if (data === undefined) {
    return (
      <Shell>
        <div role="status" className="flex-1 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-[#1db954] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading results...</span>
        </div>
      </Shell>
    );
  }

  const hostAction = <HostAction onHost={goHome} />;

  if (data === null || ranked.length === 0) {
    return (
      <Shell footer={hostAction}>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-4">
          <h1 className="text-2xl">These results aren&apos;t available</h1>
          <p className="text-sm text-white/60">Shared results expire after 30 days, or the link may be wrong.</p>
        </div>
        <Pitch />
      </Shell>
    );
  }

  const winner = players[0];
  return (
    <Shell footer={hostAction}>
      <div className="text-center mt-5">
        <h1 className="text-2xl md:text-3xl">{winner.playerName} had the best taste</h1>
        <p className="text-sm text-white/50 mt-1">{recapSummary(players.length, rounds.length)}</p>
      </div>

      <Standings players={players} awards={awards} onPickPlayer={setSetlistPlayer} />
      <p className="text-xs text-white/40 mt-3">tap anyone to see their setlist</p>

      <Pitch />

      <AnimatePresence>
        {setlistPlayer && <SetlistModal player={setlistPlayer} onClose={() => setSetlistPlayer(null)} />}
      </AnimatePresence>
    </Shell>
  );
}

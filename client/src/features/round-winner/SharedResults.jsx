import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { AnimatePresence } from 'framer-motion';
import { api } from '../../../../convex/_generated/api';
import ScrollFade from '../../components/ScrollFade';
import { useNoIndex } from '../../hooks/useNoIndex';
import logo from '../../assets/aux-wars-logo.svg';
import { computeAwards } from './computeAwards';
import { pickReel, recapSummary, standingsFrom } from './resultsModel';
import SetlistModal from './SetlistModal';
import Standings from './Standings';

function Shell({ children }) {
  return (
    <div data-vital="shared-results" className="h-[100svh] w-full text-white">
      <ScrollFade className="h-full w-full" contentClassName="min-h-full flex flex-col items-center w-full max-w-2xl mx-auto px-2 py-6">
        <div className="flex items-center gap-2">
          <img src={logo} alt="" className="w-8" />
          <p className="text-xl">Aux Wars</p>
        </div>
        {children}
      </ScrollFade>
    </div>
  );
}

/** The page's one primary action: start a game of your own. */
function HostAction({ onHost }) {
  return (
    <div className="w-full max-w-md mt-auto pt-8 flex flex-col items-center gap-3">
      <p className="text-sm text-white/50 text-center">
        Aux Wars is a free music party game. Get a prompt, pick a song, rate each other&apos;s picks.
      </p>
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

  const players = useMemo(() => (data ? standingsFrom(data.rounds) : []), [data]);
  const awards = useMemo(
    () =>
      data
        ? pickReel(
            computeAwards({ playerStats: players, allRounds: data.rounds, voterAwards: data.voterAwards, players: data.players, seed: data.seed }),
            data.seed
          )
        : [],
    [data, players]
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

  if (data === null || players.length === 0) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-4">
          <h1 className="text-2xl">These results aren&apos;t available</h1>
          <p className="text-sm text-white/60">Shared results expire after 30 days, or the link may be wrong.</p>
        </div>
        <HostAction onHost={goHome} />
      </Shell>
    );
  }

  const winner = players[0];
  return (
    <Shell>
      <div className="text-center mt-5">
        <h1 className="text-2xl md:text-3xl">{winner.playerName} had the best taste</h1>
        <p className="text-sm text-white/50 mt-1">{recapSummary(players.length, data.rounds.length)}</p>
      </div>

      <Standings players={players} awards={awards} onPickPlayer={setSetlistPlayer} />
      <p className="text-xs text-white/40 mt-3">tap anyone to see their setlist</p>

      <HostAction onHost={goHome} />

      <AnimatePresence>
        {setlistPlayer && <SetlistModal player={setlistPlayer} onClose={() => setSetlistPlayer(null)} />}
      </AnimatePresence>
    </Shell>
  );
}

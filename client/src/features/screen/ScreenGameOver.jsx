import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../../../convex/_generated/api";
import PlayerResultWithHover from "../../components/PlayerResultWithHover";
import { computeAwards } from "../round-winner/computeAwards";
import { pickReel, reelSeedFor, standingsFrom, withNonSubmitters } from "../round-winner/resultsModel";
import { useSecondsUntil } from "../quickplay/useQuickPlay";

const SUSPENSE_MS = 1800;
const WINNER_MS = 4000;
const SUPERLATIVE_MS = 4500;

function RematchBanner({ rematchAt }) {
  const left = useSecondsUntil(rematchAt) ?? 0;
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 text-center">
      <p className="text-white/70 text-3xl mb-3">Running it back in…</p>
      <p className="text-[120px] leading-none font-bold text-[#68d570] tabular-nums">{left || "Go!"}</p>
    </div>
  );
}

/**
 * Game over on the big screen: the same reveal the phones play (suspense,
 * winner, awards one by one), on a timer since nobody taps a TV, then the
 * final standings with the awards.
 */
export default function ScreenGameOver({ code, room }) {
  const rounds = useQuery(api.game.flow.getAllRoundResults, code ? { code } : "skip");
  const players = useQuery(api.game.rooms.getPlayers, code ? { code } : "skip");
  const voterAwards = useQuery(api.game.flow.getVoterAwards, code ? { code } : "skip");

  const sorted = useMemo(() => (rounds ? standingsFrom(rounds) : []), [rounds]);
  const everyone = useMemo(() => withNonSubmitters(sorted, voterAwards || [], players || []), [sorted, voterAwards, players]);
  const seed = useMemo(() => reelSeedFor(code, rounds), [code, rounds]);
  const awards = useMemo(
    () => (rounds && players
      ? computeAwards({ playerStats: sorted, allRounds: rounds, voterAwards: voterAwards || [], players, seed })
      : []),
    [rounds, players, voterAwards, sorted, seed]
  );
  const reel = useMemo(() => pickReel(awards, seed), [awards, seed]);

  const [stage, setStage] = useState("suspense");
  const [supIdx, setSupIdx] = useState(0);
  useEffect(() => {
    if (!sorted.length) return undefined;
    let t;
    if (stage === "suspense") t = setTimeout(() => setStage("winner"), SUSPENSE_MS);
    else if (stage === "winner") t = setTimeout(() => setStage(reel.length ? "superlatives" : "final"), WINNER_MS);
    else if (stage === "superlatives") {
      t = setTimeout(() => {
        if (supIdx < reel.length - 1) setSupIdx((i) => i + 1);
        else setStage("final");
      }, SUPERLATIVE_MS);
    }
    return () => clearTimeout(t);
  }, [stage, supIdx, sorted.length, reel.length]);

  const rematchAt = typeof room?.rematchStartingAt === "number" ? room.rematchStartingAt : null;

  if (!rounds || !players) {
    return (
      <div className="h-full w-full flex items-center justify-center text-white text-3xl">
        Loading final results…
      </div>
    );
  }

  const [winner, ...rest] = everyone;

  return (
    <div data-vital="screen-game-over" className="relative h-full w-full text-white">
      {stage !== "final" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-16 text-center">
          <AnimatePresence mode="wait">
            {stage === "suspense" && (
              <motion.p
                key="suspense" className="text-white/70 text-5xl"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
              >
                Tonight’s best taste is…
              </motion.p>
            )}
            {stage === "winner" && winner && (
              <motion.div
                key="winner" className="flex flex-col items-center"
                initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1.6, opacity: 1 }} exit={{ opacity: 0, scale: 1.7 }}
                transition={{ type: "spring", stiffness: 220, damping: 16 }}
              >
                <div className="text-5xl mb-1">👑</div>
                <PlayerResultWithHover
                  playerName={winner.playerName} songs={winner.songs}
                  wins={winner.wins} totalRecords={winner.totalRecords} isWinner
                />
              </motion.div>
            )}
            {stage === "superlatives" && reel[supIdx] && (
              <motion.div
                key={`sup-${supIdx}`} className="flex flex-col items-center"
                initial={{ opacity: 0, scale: 0.8, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 1.1, y: -24 }}
                transition={{ type: "spring", stiffness: 200, damping: 18 }}
              >
                <div className="text-[110px] leading-none mb-6">{reel[supIdx].emoji}</div>
                <p className="text-white/55 text-2xl uppercase tracking-[0.2em] mb-3">{reel[supIdx].title}</p>
                <p className="text-7xl font-bold text-[#68d570] mb-4">{reel[supIdx].playerName}</p>
                <p className="text-white/70 text-3xl max-w-3xl">{reel[supIdx].detail}</p>
              </motion.div>
            )}
          </AnimatePresence>
          {stage === "superlatives" && reel.length > 1 && (
            <div className="absolute bottom-16 flex gap-3">
              {reel.map((_, i) => (
                <span key={i} className={`h-3 w-3 rounded-full ${i === supIdx ? "bg-[#68d570]" : "bg-white/25"}`} />
              ))}
            </div>
          )}
        </div>
      )}

      {stage === "final" && (
        <motion.div
          className="h-full w-full flex gap-12 px-16 pt-16 pb-10"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        >
          <div className="w-[440px] shrink-0 flex flex-col items-center justify-center">
            <p className="text-2xl text-gray-400 mb-2">Final standings</p>
            {winner && (
              <>
                <div className="text-5xl mb-1">👑</div>
                <div className="scale-125 origin-top">
                  <PlayerResultWithHover
                    playerName={winner.playerName} songs={winner.songs}
                    wins={winner.wins} totalRecords={winner.totalRecords} isWinner
                  />
                </div>
              </>
            )}
            {reel.length > 0 && (
              <ul aria-label="Awards" className="w-full mt-8 space-y-3">
                {reel.map((award) => (
                  <li key={award.id} className="flex items-baseline justify-between gap-4 text-2xl">
                    <span className="flex items-baseline gap-3 min-w-0 text-white/50">
                      <span aria-hidden="true" className="shrink-0">{award.emoji}</span>
                      <span className="truncate">{award.title}</span>
                    </span>
                    <span className="text-white/80 truncate">{award.playerName}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={`flex-1 min-w-0 grid content-center gap-x-6 ${rest.length > 4 ? "grid-cols-2" : "grid-cols-1"}`}>
            {rest.map((p) => (
              <PlayerResultWithHover
                key={p.playerId}
                playerName={p.playerName} songs={p.songs}
                wins={p.wins} totalRecords={p.totalRecords} isWinner={false}
              />
            ))}
          </div>
        </motion.div>
      )}

      <AnimatePresence>{rematchAt && <RematchBanner rematchAt={rematchAt} />}</AnimatePresence>
    </div>
  );
}

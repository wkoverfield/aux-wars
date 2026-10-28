import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../../../convex/_generated/api";
import PlayerResultWithHover from "../../components/PlayerResultWithHover";
import { computeAwards } from "../round-winner/computeAwards";
import { pickReel, reelSeedFor, standingsFrom, withNonSubmitters } from "../round-winner/resultsModel";
import { useSecondsUntil } from "../quickplay/useQuickPlay";
import recordLogo from "../../components/record-logo.svg";
import { fallBackToOriginal, largeCoverArt } from "../../utils/coverArt";
import { usePortrait } from "./stage";

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
/**
 * The game's winner, sized in stage units. The phones' winner card sizes
 * itself by viewport breakpoints, which read wrong on a scaled stage (an
 * upright phone gets its smallest sizes), so the screen draws its own.
 */
function WinnerBlock({ player, size = 150 }) {
  const covers = (player.songs || []).map((song) => song.albumCover).filter(Boolean).slice(0, 3);
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex justify-center">
        {covers.map((cover, i) => (
          <img
            key={i}
            src={largeCoverArt(cover)}
            onError={fallBackToOriginal(cover)}
            alt=""
            className="rounded-lg object-cover shadow-lg ring-2 ring-[#121212]"
            style={{ width: size, height: size, marginLeft: i ? -size * 0.35 : 0, zIndex: covers.length - i }}
          />
        ))}
      </div>
      <p className="text-5xl font-bold text-[#68d570] mt-5 max-w-[620px] truncate">{player.playerName}</p>
      <p className="mt-2 flex items-center gap-4 text-3xl font-semibold">
        <span>{player.wins} Win{player.wins !== 1 ? "s" : ""}</span>
        <span className="flex items-center gap-1 text-gray-300 tabular-nums">
          <img src={recordLogo} alt="Records" className="w-9 h-9" />
          {player.totalRecords}
        </span>
      </p>
    </div>
  );
}

/** One finisher on an upright screen: large enough to read off a phone across the table. */
function PortraitStandingRow({ player, place }) {
  const cover = player.songs?.[0]?.albumCover;
  return (
    <div className="flex items-center gap-4 rounded-lg bg-[#242424]/85 px-4 py-2">
      <span className="w-8 shrink-0 text-2xl text-white/50 tabular-nums">{place}</span>
      {cover ? (
        <img src={largeCoverArt(cover)} onError={fallBackToOriginal(cover)} alt="" className="w-14 h-14 rounded-md object-cover shrink-0" />
      ) : (
        <span className="w-14 h-14 rounded-md bg-[#333] shrink-0" />
      )}
      <p className="flex-1 min-w-0 text-3xl font-bold truncate">{player.playerName}</p>
      <span className="shrink-0 text-2xl text-white tabular-nums">{player.wins} Win{player.wins !== 1 ? "s" : ""}</span>
      <span className="shrink-0 flex items-center gap-1 text-2xl text-gray-300 tabular-nums">
        <img src={recordLogo} alt="Records" className="w-8 h-8" />
        {player.totalRecords}
      </span>
    </div>
  );
}

export default function ScreenGameOver({ code, room }) {
  const portrait = usePortrait();
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

  // Display only: a mouse left resting on the TV must not open the album hover cards.
  return (
    <div data-vital="screen-game-over" className="relative h-full w-full text-white pointer-events-none">
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
                initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0, scale: 1.05 }}
                transition={{ type: "spring", stiffness: 220, damping: 16 }}
              >
                <div className="text-7xl mb-3">👑</div>
                <WinnerBlock player={winner} size={220} />
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

      {stage === "final" && portrait && (
        <motion.div
          className="h-full w-full flex flex-col px-12 pt-20 pb-12"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        >
          <p className="text-3xl text-gray-400 text-center">Final standings</p>
          {winner && (
            <div className="flex flex-col items-center mt-2">
              <div className="text-5xl mb-2">👑</div>
              <WinnerBlock player={winner} size={170} />
            </div>
          )}
          <div className="flex flex-col gap-2 mt-6">
            {rest.map((p, i) => <PortraitStandingRow key={p.playerId} player={p} place={i + 2} />)}
          </div>
          {reel.length > 0 && (
            <ul aria-label="Awards" className="w-full mt-8 space-y-2">
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
        </motion.div>
      )}

      {stage === "final" && !portrait && (
        <motion.div
          className="h-full w-full flex gap-12 px-16 pt-16 pb-10"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        >
          <div className="w-[440px] shrink-0 flex flex-col items-center justify-center">
            <p className="text-2xl text-gray-400 mb-2">Final standings</p>
            {winner && (
              <>
                <div className="text-5xl mb-2">👑</div>
                <WinnerBlock player={winner} size={150} />
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

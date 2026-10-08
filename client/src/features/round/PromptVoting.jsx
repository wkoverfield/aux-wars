import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "../../hooks/useSession";
import { usePendingAction } from "../../hooks/usePendingAction";
import { useSecondsUntil } from "../quickplay/useQuickPlay";

/**
 * The voting countdown. The query reports whole seconds left; this turns that
 * into a local deadline and ticks on its own, so only this leaf re-renders
 * each second.
 */
function VoteTimer({ seconds }) {
  const [deadline, setDeadline] = useState(null);
  useEffect(() => {
    setDeadline(Date.now() + seconds * 1000);
  }, [seconds]);
  const left = useSecondsUntil(deadline) ?? seconds;
  const isLowTime = left <= 5;
  return (
    <motion.div
      className={`px-6 py-3 rounded-full font-bold text-2xl ${
        isLowTime ? "bg-red-600 text-white" : "bg-[#242424] text-white"
      }`}
      animate={isLowTime ? { scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 0.5, repeat: isLowTime ? Infinity : 0 }}
    >
      {left}s
    </motion.div>
  );
}

/**
 * PromptVoting component displays the current prompt and allows players to vote to skip it.
 * Shows a 15-second countdown and vote progress.
 *
 * @param {Object} props - Component props
 * @param {string} props.gameCode - Current game code
 * @returns {JSX.Element} Rendered component
 */
export default function PromptVoting({ gameCode }) {
  const { session } = useSession();
  const votingStatus = useQuery(
    api.game.flow.getPromptVotingStatus,
    gameCode ? { code: gameCode } : "skip"
  );
  const voteSkipMutation = useMutation(api.game.flow.voteSkipPrompt);
  const [hasVoted, setHasVoted] = useState(false);
  const { pending: isVoting, run } = usePendingAction();
  const [promptAnimation, setPromptAnimation] = useState(false);
  const [displayedPrompt, setDisplayedPrompt] = useState("");

  // Track if current user has voted
  useEffect(() => {
    if (votingStatus?.voters && session?.playerId) {
      setHasVoted(votingStatus.voters.includes(session.playerId));
    }
  }, [votingStatus?.voters, session?.playerId]);

  // Animate prompt changes
  useEffect(() => {
    if (votingStatus?.currentPrompt && votingStatus.currentPrompt !== displayedPrompt) {
      setPromptAnimation(true);
      setTimeout(() => {
        setDisplayedPrompt(votingStatus.currentPrompt);
        setPromptAnimation(false);
        setHasVoted(false); // Reset vote state on new prompt
      }, 300);
    }
  }, [votingStatus?.currentPrompt, displayedPrompt]);

  // Initialize displayed prompt
  useEffect(() => {
    if (votingStatus?.currentPrompt && !displayedPrompt) {
      setDisplayedPrompt(votingStatus.currentPrompt);
    }
  }, [votingStatus?.currentPrompt, displayedPrompt]);

  const handleVoteSkip = () => {
    if (!session?.playerId || !session?.connectionId || hasVoted) return;
    run(async () => {
      try {
        await voteSkipMutation({
          code: gameCode,
          playerId: session.playerId,
          connectionId: session.connectionId,
        });
        setHasVoted(true);
      } catch (error) {
        console.error("Failed to vote:", error);
      }
    });
  };

  if (!votingStatus) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent" />
      </div>
    );
  }

  // The tap counts at once; the server's tally takes over when it answers.
  const voted = hasVoted || isVoting;
  const skipVotes = votingStatus.skipVotes + (isVoting && !hasVoted ? 1 : 0);
  const { majorityNeeded } = votingStatus;
  const votesNeeded = Math.max(0, majorityNeeded - skipVotes);

  return (
    <div className="flex flex-col items-center justify-center gap-8 max-w-4xl mx-auto px-4 min-h-[70vh]">
      {/* Timer */}
      <VoteTimer key={displayedPrompt} seconds={votingStatus.timeRemaining} />

      {/* Prompt Display */}
      <div className="w-full">
        <p className="text-gray-400 text-center mb-4">The prompt is:</p>
        <AnimatePresence mode="wait">
          <motion.div
            key={displayedPrompt}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: promptAnimation ? 0 : 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="bg-[#242424] rounded-xl p-6 text-center"
          >
            <p className="text-2xl md:text-3xl font-bold text-white leading-relaxed">
              &quot;{displayedPrompt}&quot;
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Skip Vote Section */}
      <div className="flex flex-col items-center gap-4 w-full max-w-md">
        <p className="text-gray-400 text-sm text-center">
          Not feeling this prompt? Vote to skip it!
        </p>

        <motion.button
          onClick={handleVoteSkip}
          disabled={voted}
          aria-pressed={voted}
          className={`w-full py-4 px-6 rounded-lg font-semibold text-lg transition-colors ${
            voted
              ? "bg-green-600/30 text-green-400 cursor-default"
              : "bg-[#242424] text-white hover:bg-[#333] cursor-pointer"
          }`}
          whileHover={voted ? {} : { scale: 1.02 }}
          whileTap={voted ? {} : { scale: 0.98 }}
        >
          {voted ? "You voted to skip" : `Skip Prompt (${votesNeeded} more needed)`}
        </motion.button>

        {/* Vote Progress */}
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>
            {skipVotes}/{majorityNeeded} votes
          </span>
          <div className="flex-1 h-2 bg-[#242424] rounded-full overflow-hidden min-w-[100px]">
            <motion.div
              className="h-full bg-green-500"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(1, skipVotes / majorityNeeded) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </div>

      {/* Info */}
      <p className="text-gray-500 text-xs text-center max-w-md">
        Song selection begins automatically when the timer ends.
        If majority votes to skip, a new prompt will be shown.
      </p>
    </div>
  );
}

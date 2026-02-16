import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "../../hooks/useSession";

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
  const [isVoting, setIsVoting] = useState(false);
  const [promptAnimation, setPromptAnimation] = useState(false);
  const [displayedPrompt, setDisplayedPrompt] = useState("");

  // Track local time remaining (more responsive than server)
  const [localTimeRemaining, setLocalTimeRemaining] = useState(15);

  // Update local timer every second
  useEffect(() => {
    if (!votingStatus) return;

    // Sync with server time when it updates
    setLocalTimeRemaining(votingStatus.timeRemaining);

    const interval = setInterval(() => {
      setLocalTimeRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [votingStatus?.timeRemaining]);

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
        setLocalTimeRemaining(15); // Reset timer
      }, 300);
    }
  }, [votingStatus?.currentPrompt, displayedPrompt]);

  // Initialize displayed prompt
  useEffect(() => {
    if (votingStatus?.currentPrompt && !displayedPrompt) {
      setDisplayedPrompt(votingStatus.currentPrompt);
    }
  }, [votingStatus?.currentPrompt, displayedPrompt]);

  const handleVoteSkip = async () => {
    if (!session?.playerId || hasVoted || isVoting) return;

    setIsVoting(true);
    try {
      await voteSkipMutation({
        code: gameCode,
        playerId: session.playerId,
      });
      setHasVoted(true);
    } catch (error) {
      console.error("Failed to vote:", error);
    } finally {
      setIsVoting(false);
    }
  };

  if (!votingStatus) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent" />
      </div>
    );
  }

  const { skipVotes, majorityNeeded, totalPlayers } = votingStatus;
  const votesNeeded = majorityNeeded - skipVotes;
  const isLowTime = localTimeRemaining <= 5;

  return (
    <div className="flex flex-col items-center justify-center gap-8 max-w-4xl mx-auto px-4 min-h-[70vh]">
      {/* Timer */}
      <motion.div
        className={`px-6 py-3 rounded-full font-bold text-2xl ${
          isLowTime ? "bg-red-600 text-white" : "bg-[#242424] text-white"
        }`}
        animate={isLowTime ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 0.5, repeat: isLowTime ? Infinity : 0 }}
      >
        {localTimeRemaining}s
      </motion.div>

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
              "{displayedPrompt}"
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
          disabled={hasVoted || isVoting}
          className={`w-full py-4 px-6 rounded-lg font-semibold text-lg transition-all ${
            hasVoted
              ? "bg-green-600/30 text-green-400 cursor-default"
              : "bg-[#242424] text-white hover:bg-[#333] cursor-pointer"
          }`}
          whileHover={hasVoted ? {} : { scale: 1.02 }}
          whileTap={hasVoted ? {} : { scale: 0.98 }}
        >
          {isVoting ? (
            <span className="flex items-center justify-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
              Voting...
            </span>
          ) : hasVoted ? (
            "You voted to skip"
          ) : (
            `Skip Prompt (${votesNeeded} more needed)`
          )}
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
              animate={{ width: `${(skipVotes / majorityNeeded) * 100}%` }}
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

import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "../../services/GameContext";
import {
  useSocket,
  useSocketConnection,
  useGameTransition,
} from "../../services/SocketProvider";
import Song from "../../components/Song";
import SearchBar from "../../components/SearchBar";
import recordLogo from "../../components/record-logo.svg";
import nextIcon from "../../assets/next-icon.svg";

/**
 * RoundWinner component displays the results of a completed round.
 * Shows the winning song and other submissions, with options to proceed to the next round.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function RoundWinner() {
  const { gameCode } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const isConnected = useSocketConnection();
  const setGameTransition = useGameTransition();
  const { state, dispatch } = useGame();
  const { roundResults, currentPrompt, currentRound, numberOfRounds } = state;
  const [receivedResults, setReceivedResults] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [loadingResults, setLoadingResults] = useState(true);

  // Check if this is the final round
  const isFinalRound = currentRound >= numberOfRounds;

  // Set up game transition
  useEffect(() => {
    setGameTransition(true);
    const timer = setTimeout(() => {
      setGameTransition(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [setGameTransition]);

  // Handle component mount transition
  useEffect(() => {
    setGameTransition(true);
    const timer = setTimeout(() => {
      setGameTransition(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [setGameTransition]);

  // Handle connection state
  useEffect(() => {
    if (!isConnected && !isTransitioning) {
      navigate("/lobby", { replace: true });
    }
  }, [isConnected, navigate, isTransitioning]);

  // Handle game phase updates
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handlePhaseUpdate = ({ phase, currentRound }) => {
      if (typeof currentRound !== "undefined") {
        dispatch({ type: "SET_CURRENT_ROUND", payload: currentRound });
      }
      if (phase === "results") {
        dispatch({ type: "CLEAR_ROUND_RESULTS" });
        setLoadingResults(true);
        setReceivedResults(false);
        socket.emit("request-round-results", { gameCode });
      }
      dispatch({ type: "SET_PHASE", payload: phase });
    };

    socket.on("game-phase-updated", handlePhaseUpdate);
    return () => socket.off("game-phase-updated", handlePhaseUpdate);
  }, [socket, gameCode, dispatch, isConnected]);

  // Handle round results
  useEffect(() => {
    if (!socket || !isConnected) {
      return;
    }
    
    if (receivedResults) {
      return;
    }

    const handleRoundResults = ({ results }) => {
      dispatch({ type: "SET_ROUND_RESULTS", payload: results });
      setReceivedResults(true);
      setLoadingResults(false);
    };

    socket.on("round-results", handleRoundResults);

    if (!roundResults?.songs || roundResults.songs.length === 0) {
      setLoadingResults(true);
      socket.emit("request-round-results", { gameCode });
    } else {
      setLoadingResults(false);
    }

    return () => {
      socket.off("round-results", handleRoundResults);
    };
  }, [socket, isConnected, gameCode, roundResults, dispatch]);

  // Handle prompt updates
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handlePromptUpdated = ({ prompt }) => {
      dispatch({ type: "SET_PROMPT", payload: prompt });
      // Navigation will be handled by GameRouteGuard based on phase change
    };

    socket.on("prompt-updated", handlePromptUpdated);
    return () => socket.off("prompt-updated", handlePromptUpdated);
  }, [socket, isConnected, dispatch]);

  /**
   * Handles the transition to the next round or final results
   */
  const handleNextRound = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setGameTransition(true);

    if (isFinalRound) {
      dispatch({ type: "SET_GAME_OVER", payload: true });
      socket.emit("next-round", { gameCode });
    } else {
      dispatch({ type: "NEXT_ROUND" });
      socket.emit("next-round", { gameCode });
    }
  };

  // Use state to prevent button text flickering
  const [buttonText, setButtonText] = useState("");
  
  useEffect(() => {
    if (!isTransitioning) {
      setButtonText(isFinalRound ? "See Final Results" : "Next Round");
    }
  }, [isFinalRound, isTransitioning]);

  // Loading skeleton component
  const LoadingSkeleton = () => (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center w-full"
    >
      {/* Winner skeleton */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-44 h-44 md:w-[180px] md:h-[180px] bg-[#242424] rounded-lg animate-pulse mb-4"></div>
        <div className="h-8 w-32 bg-[#242424] rounded animate-pulse mb-2"></div>
        <div className="h-6 w-40 bg-[#242424] rounded animate-pulse mb-1"></div>
        <div className="h-4 w-24 bg-[#242424] rounded animate-pulse"></div>
      </div>
      
      {/* Other songs skeleton */}
      {[...Array(2)].map((_, idx) => (
        <div key={idx} className="flex items-center w-[95%] max-w-[580px] mx-auto my-4 p-3">
          <div className="w-[60px] h-[60px] md:w-[80px] md:h-[80px] bg-[#242424] rounded-md animate-pulse mr-4"></div>
          <div className="flex-1">
            <div className="h-6 w-32 bg-[#242424] rounded animate-pulse mb-2"></div>
            <div className="h-4 w-48 bg-[#242424] rounded animate-pulse mb-1"></div>
            <div className="h-4 w-36 bg-[#242424] rounded animate-pulse"></div>
          </div>
          <div className="flex items-center">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-[#242424] rounded-full animate-pulse mr-2"></div>
            <div className="h-8 w-8 bg-[#242424] rounded animate-pulse"></div>
          </div>
        </div>
      ))}
    </motion.div>
  );

  return (
    <div className="relative flex flex-col h-screen w-full max-w-7xl mx-auto pt-2 pb-6 px-2 md:p-6 bg-transparent items-center overflow-hidden">
      {/* Navigation button */}
      <div className="w-full flex flex-row justify-end mb-1 mt-2 md:mb-2 md:mt-4">
        <button
          disabled={isTransitioning}
          className={`flex items-center gap-2 py-1 px-3 md:py-2 md:px-4 rounded-md text-white font-semibold cursor-pointer transition-all bg-[#242424] hover:bg-[#191414] text-sm md:text-base ${
            isTransitioning ? "opacity-70 cursor-not-allowed" : ""
          }`}
          onClick={handleNextRound}
          style={{ minWidth: "100px" }}
        >
          {buttonText}
          <img src={nextIcon} alt="Arrow Right" className="w-4 h-4 md:w-5 md:h-5 pt-0.5" />
        </button>
      </div>

      {/* Current prompt */}
      <div className="w-full max-w-3xl mx-auto mb-6 md:mb-8 mt-1 md:mt-2 px-2">
        <SearchBar value={currentPrompt || ""} readOnly onChange={() => {}} />
      </div>

      {/* Results section with loading state */}
      <AnimatePresence mode="wait">
        {loadingResults || !roundResults?.songs || roundResults.songs.length === 0 ? (
          <LoadingSkeleton key="loading" />
        ) : (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center w-full"
          >
            {/* Winner display */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col items-center w-full mt-2"
            >
              <div className="relative flex flex-col items-center">
                <div className="relative flex flex-col items-center">
                  <Song
                    track={roundResults.songs[0].name}
                    artist={roundResults.songs[0].artist}
                    albumCover={roundResults.songs[0].albumCover}
                    player={roundResults.songs[0].player?.name}
                    rating={roundResults.songs[0].totalRecords}
                    winner="winner"
                  />
                  <div
                    className="absolute -top-5 -right-5 sm:-top-7 sm:-right-7 flex items-center z-20"
                    style={{ pointerEvents: "none" }}
                  >
                    <div className="flex items-center bg-[#191414] bg-opacity-90 rounded-2xl px-2 py-1 shadow-lg">
                      <img
                        src={recordLogo}
                        alt="Record"
                        className="w-8 h-8 sm:w-12 sm:h-12 mr-1"
                      />
                      <span className="text-white text-2xl sm:text-3xl font-bold">
                        x{roundResults.songs[0].totalRecords}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Other songs list */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="w-full flex-1 flex flex-col items-center gap-2 pb-4 overflow-y-auto"
              style={{ minHeight: "0" }}
            >
              {roundResults.songs.length > 1 &&
                roundResults.songs
                  .slice(1)
                  .map((song, index) => (
                    <motion.div
                      key={song.songId || index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                    >
                      <Song
                        track={song.name}
                        artist={song.artist}
                        albumCover={song.albumCover}
                        player={song.player?.name}
                        rating={song.totalRecords}
                        winner="not-winner"
                      />
                    </motion.div>
                  ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

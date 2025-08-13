import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
// No authentication needed for YouTube

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
        dispatch({ type: "SET_ROUND_RESULTS", payload: { songs: [] } });
        setLoadingResults(true);
        setReceivedResults(false);
        socket.emit("request-round-results", { gameCode });
      }
      if (phase === "lobby") {
        navigate(`/lobby/${gameCode}`, { replace: true });
      } else if (phase === "songSelection") {
        navigate(`/lobby/${gameCode}/round`, { replace: true });
      } else if (phase === "gameOver") {
        navigate(`/lobby/${gameCode}/gamewinner`, { replace: true });
      }
    };

    socket.on("game-phase-updated", handlePhaseUpdate);
    return () => socket.off("game-phase-updated", handlePhaseUpdate);
  }, [socket, gameCode, navigate, dispatch, isConnected]);

  // Handle round results
  useEffect(() => {
    if (!socket || !isConnected || receivedResults) return;

    const handleRoundResults = ({ results }) => {
      dispatch({ type: "SET_ROUND_RESULTS", payload: results });
      setReceivedResults(true);
      setLoadingResults(false);
    };

    socket.on("round-results", handleRoundResults);

    if (!roundResults?.songs || roundResults.songs.length === 0) {
      setLoadingResults(true);
      socket.emit("request-round-results", { gameCode });
    }

    return () => socket.off("round-results", handleRoundResults);
  }, [socket, isConnected, gameCode, roundResults, dispatch, receivedResults]);

  // Handle prompt updates
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handlePromptUpdated = ({ prompt }) => {
      dispatch({ type: "SET_PROMPT", payload: prompt });

      if (!isTransitioning) {
        setIsTransitioning(true);
        navigate(`/lobby/${gameCode}/round`, { replace: true });
      }
    };

    socket.on("prompt-updated", handlePromptUpdated);
    return () => socket.off("prompt-updated", handlePromptUpdated);
  }, [socket, isConnected, gameCode, navigate, dispatch, isTransitioning]);

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

  const buttonText = isFinalRound ? "See Final Results" : "Next Round";

  return (
    <div className="relative flex flex-col w-full max-w-7xl mx-auto pt-2 pb-2 px-2 md:p-6 bg-transparent justify-center items-center">
      {/* Navigation button */}
      <div className="w-full flex flex-row justify-end mb-2 mt-4">
        <button
          disabled={isTransitioning}
          className={`flex items-center gap-2 py-2 px-4 rounded-md text-white font-semibold cursor-pointer transition-all ${
            isTransitioning ? "opacity-70 cursor-not-allowed" : ""
          }`}
          onClick={handleNextRound}
          style={{ minWidth: "120px" }}
        >
          {buttonText}
          <img src={nextIcon} alt="Arrow Right" className="w-5 h-5 pt-0.5" />
        </button>
      </div>

      {/* Current prompt */}
      <div className="w-full max-w-3xl mx-auto mb-10 mt-2">
        <SearchBar value={currentPrompt || ""} readOnly onChange={() => {}} />
      </div>

      {/* Winner display */}
      {roundResults?.songs && roundResults.songs.length > 0 && (
        <div className="flex flex-col items-center w-full mb-6">
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
        </div>
      )}

      {/* Other songs list */}
      <div
        className="w-full flex flex-col items-center gap-2 pb-4 overflow-y-auto"
        style={{ maxHeight: "30vh", minHeight: "10rem" }}
      >
        {roundResults?.songs &&
          roundResults.songs.length > 1 &&
          roundResults.songs
            .slice(1)
            .map((song, index) => (
              <Song
                key={song.songId || index}
                track={song.name}
                artist={song.artist}
                albumCover={song.albumCover}
                player={song.player?.name}
                rating={song.totalRecords}
                winner="not-winner"
              />
            ))}
      </div>
    </div>
  );
}

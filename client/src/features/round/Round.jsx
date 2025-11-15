import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
// GameContext removed - using Convex queries directly
// import { useSocket, useSocketConnection, useGameTransition } from "../../services/SocketProvider";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { searchTracks, getCachedResults } from "../../services/serverYoutubeApi";
import { useToast } from "../../contexts/ToastContext";
import RoundStart from "./RoundStart";
import SongSelection from "./SongSelection";
import PromptModal from "./PromptModal";
import WaitingScreen from "./WaitingScreen";
import RatingScreen from "./RatingScreen";
import SnippetSelector from "../../components/SnippetSelector";
import { useSession } from "../../hooks/useSession";
import { useHeartbeat } from "../../hooks/useHeartbeat";

/**
 * Round component manages the game round flow including song selection and rating phases.
 * Handles socket events for game state updates, player interactions, and phase transitions.
 *
 * @returns {JSX.Element} The rendered round component
 */
export default function Round() {
  const { gameCode } = useParams();
  const navigate = useNavigate();
  // const socket = useSocket();
  // const isConnected = useSocketConnection();
  const setGameTransition = () => {};
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');
  const currentRatingSong = useQuery(api.game.flow.getCurrentRatingSong, gameCode ? { code: gameCode } : 'skip');
  const submissionStatus = useQuery(api.game.flow.getSubmissionStatus, gameCode ? { code: gameCode } : 'skip');
  const currentRatingStatus = useQuery(api.game.flow.getCurrentRatingStatus, gameCode ? { code: gameCode } : 'skip');
  const submitSong = useMutation(api.game.flow.submitSong);
  const submitRating = useMutation(api.game.flow.submitRating);
  const { showToast } = useToast();
  const { session, clearSession } = useSession();

  // Heartbeat to keep connection alive during round
  useHeartbeat(
    gameCode,
    session?.playerId,
    session?.connectionId,
    null, // No takeover modal needed during active gameplay
    clearSession
  );

  // Extract current prompt from room data
  const room = roomQuery?.room || roomQuery;
  const currentPrompt = room?.currentPrompt || '';

  // Query for player's submission in current round
  const mySubmission = useQuery(
    api.game.flow.getMySubmission,
    gameCode && session?.playerId && room?.currentRound
      ? { code: gameCode, playerId: session.playerId, round: room.currentRound }
      : "skip"
  );

  // State Management
  // ===============

  // Song Selection State (truly local UI state)
  const [isSongSelectionView, setIsSongSelectionView] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [showSnippetSelector, setShowSnippetSelector] = useState(false);

  // Optimistic UI flag for rating phase (prevent double-submission during query update window)
  const [hasRatingSubmitted, setHasRatingSubmitted] = useState(false);

  // Transition State
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Derive from queries - no local state duplication
  const isRatingPhase = currentRatingSong !== null && currentRatingSong !== undefined;
  const songToRate = currentRatingSong;
  const submittedCount = submissionStatus?.submitted || 0;
  const totalPlayers = submissionStatus?.total || currentRatingStatus?.total || 0;
  const ratingSubmittedCount = currentRatingStatus?.submitted || 0;
  const ratingIndex = room?.currentRatingIndex ?? 0;
  const totalSongs = submissionStatus?.total || 0;
  const hasSongSubmitted = mySubmission !== null && mySubmission !== undefined;

  // Effects
  // =======


  // Phase-driven navigation handled by GameRouteGuard

  // Reset hasRatingSubmitted when moving to a new song
  useEffect(() => {
    if (currentRatingSong) {
      setHasRatingSubmitted(false);
    }
  }, [currentRatingSong]);

  // Auto-skip rating for player's own song
  useEffect(() => {
    if (isRatingPhase && songToRate && session?.playerId && session?.connectionId) {
      if (songToRate.player?.id === session.playerId && !hasRatingSubmitted) {
        submitRating({
          code: gameCode,
          playerId: session.playerId,
          connectionId: session.connectionId,
          songId: songToRate.songId,
          rating: -1
        })
          .then(() => setHasRatingSubmitted(true))
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRatingPhase, songToRate, session?.playerId, session?.connectionId]);

  // Phase changes handled by GameRouteGuard

  /**
   * Handles YouTube track search with caching and debouncing via Express server
   * NOTE: Uses Express endpoint instead of Convex Action because youtube-search-api
   * is incompatible with Convex's Node.js runtime (package resolves as undefined)
   */
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    // Show cached results immediately if available
    const cachedResults = getCachedResults(searchTerm);
    if (cachedResults) {
      setSearchResults(cachedResults);
      setSearchError(null);
    }

    const delayDebounce = setTimeout(async () => {
      try {
        setSearchError(null);
        const result = await searchTracks(searchTerm);

        if (Array.isArray(result)) {
          setSearchResults(result);
          setSearchError(result.length === 0 ? "No songs found. Try different keywords." : null);
        } else {
          setSearchError("Search service temporarily unavailable. Please try again.");
          setSearchResults([]);
        }
      } catch (error) {
        setSearchError("Connection issue. Please check your internet and try again.");
        // Keep existing results if we have cached ones
        if (!cachedResults || cachedResults.length === 0) {
          setSearchResults([]);
        }
      } finally {
        setIsSearching(false);
      }
    }, 800);

    return () => clearTimeout(delayDebounce);
  }, [searchTerm]);

  // Player count viability checks (optional) can be rendered from submissionStatus

  // Errors are surfaced via toasts in mutation catches

  // Event Handlers
  // =============

  /**
   * Handles initial song selection - shows snippet selector
   * @param {Object} track - The selected track object
   */
  const handleSelectSong = (track) => {
    setSelectedTrack(track);
    setShowSnippetSelector(true);
  };

  /**
   * Handles final song submission with snippet times
   * @param {Object} trackWithSnippet - Track object with snippet times
   */
  const handleConfirmSongWithSnippet = async (trackWithSnippet) => {
    try {
      await submitSong({
        code: gameCode,
        playerId: session?.playerId,
        connectionId: session?.connectionId,
        trackId: trackWithSnippet.id,
        trackDetails: {
          name: trackWithSnippet.name,
          artist: trackWithSnippet.artists[0].name,
          albumCover: trackWithSnippet.album.images[0].url,
          previewUrl: trackWithSnippet.preview_url,
          snippet: trackWithSnippet.snippet,
        },
      });
    } catch (error) {
      showToast("Failed to submit song. Please try again.", "error");
      return;
    }
    setIsSongSelectionView(false);
    setShowSnippetSelector(false);
    setSelectedTrack(null);
  };

  /**
   * Handles song rating submission
   * @param {string} songId - The ID of the song being rated
   * @param {number} rating - The rating value
   */
  const handleSubmitRating = async (songId, rating) => {
    try {
      await submitRating({
        code: gameCode,
        playerId: session?.playerId,
        connectionId: session?.connectionId,
        songId,
        rating
      });
      setHasRatingSubmitted(true);
    } catch (e) {
      showToast("Failed to submit rating.", "error");
    }
  };

  // Render Logic
  // ===========


  // Always render; connectivity is managed by Convex client

  const renderContent = () => {
    if (isRatingPhase) {
      // Check if this is the player's own song - never show rating UI for own song
      const isOwnSong = songToRate?.player?.id === session?.playerId;

      if (hasRatingSubmitted || isOwnSong) {
        return (
          <WaitingScreen
            completedCount={ratingSubmittedCount}
            totalCount={totalPlayers}
            message={isOwnSong
              ? "This is your song! Waiting for others to rate..."
              : "Waiting for other players to rate this song..."}
          />
        );
      } else if (songToRate) {
        return (
          <RatingScreen
            currentPrompt={currentPrompt}
            songToRate={songToRate}
            onSubmitRating={handleSubmitRating}
            currentIndex={ratingIndex}
            totalSongs={totalSongs}
          />
        );
      }
    } else {
      if (hasSongSubmitted) {
        return (
          <WaitingScreen 
            completedCount={submittedCount} 
            totalCount={totalPlayers}
            message="Waiting for other players to submit their songs..." 
          />
        );
      } else if (isSongSelectionView) {
        return (
          <SongSelection
            searchTerm={searchTerm}
            onSearchChange={(e) => setSearchTerm(e.target.value)}
            searchResults={searchResults}
            searchError={searchError}
            isSearching={isSearching}
            onSelectSong={handleSelectSong}
            onShowPrompt={() => setShowPromptModal(true)}
            showPromptModal={showPromptModal}
          />
        );
      } else {
        return (
          <RoundStart 
            currentPrompt={currentPrompt}
            onStartSelection={() => setIsSongSelectionView(true)}
          />
        );
      }
    }
  };

  return (
    <>
      <div className={`round-start flex flex-col items-center justify-center text-white p-4 min-h-screen ${showSnippetSelector ? 'blur-sm' : ''}`}>
        {renderContent()}

        {showPromptModal && !hasSongSubmitted && !isRatingPhase && (
          <PromptModal
            currentPrompt={currentPrompt}
            onClose={() => setShowPromptModal(false)}
          />
        )}
      </div>

      {showSnippetSelector && selectedTrack && (
        <SnippetSelector
          track={selectedTrack}
          onConfirm={handleConfirmSongWithSnippet}
          onCancel={() => {
            setShowSnippetSelector(false);
            setSelectedTrack(null);
          }}
        />
      )}
    </>
  );
}

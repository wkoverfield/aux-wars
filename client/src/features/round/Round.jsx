import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
// GameContext removed - using Convex queries directly
// import { useSocket, useSocketConnection, useGameTransition } from "../../services/SocketProvider";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { searchTracks, getCachedResults } from "../../services/musicSearch";
import { useToast } from "../../contexts/ToastContext";
import RoundStart from "./RoundStart";
import SongSelection from "./SongSelection";
import PromptModal from "./PromptModal";
import WaitingScreen from "./WaitingScreen";
import RatingScreen from "./RatingScreen";
import SnippetSelector from "../../components/SnippetSelector";
import PromptVoting from "./PromptVoting";
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
  const { session, clearSession, connectionId, updateSession } = useSession();

  // Ensure session always has connectionId (handles back button navigation)
  useEffect(() => {
    if (session && !session.connectionId && connectionId) {
      updateSession({ connectionId });
    }
  }, [session, connectionId, updateSession]);

  // Heartbeat to keep connection alive during round
  useHeartbeat(
    gameCode,
    session?.playerId,
    session?.connectionId || connectionId,
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
  // Track song selected in search results but not yet confirmed (for auto-submit)
  const [pendingTrack, setPendingTrack] = useState(null);
  // Lock selection when timer enters danger zone to prevent race conditions
  const [selectionLocked, setSelectionLocked] = useState(false);

  // Optimistic UI flag for rating phase (prevent double-submission during query update window)
  const [hasRatingSubmitted, setHasRatingSubmitted] = useState(false);

  // Transition State
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Ref for SnippetSelector to get current selection on auto-submit
  const snippetSelectorRef = useRef(null);
  // Guard to prevent multiple auto-submits during timer countdown
  const hasAutoSubmittedRef = useRef(false);

  // Derive from queries - no local state duplication
  const isRatingPhase = currentRatingSong !== null && currentRatingSong !== undefined;
  const songToRate = currentRatingSong;
  const submittedCount = submissionStatus?.submitted || 0;
  const totalPlayers = submissionStatus?.total || currentRatingStatus?.total || 0;
  const ratingSubmittedCount = currentRatingStatus?.submitted || 0;
  const ratingIndex = room?.currentRatingIndex ?? 0;
  const totalSongs = submissionStatus?.total || 0;
  const hasSongSubmitted = mySubmission !== null && mySubmission !== undefined;

  // Selection timer logic
  const roundLength = room?.settings?.roundLength || 0; // 0 = no limit
  const selectionStartedAt = room?.selectionStartedAt;
  const [timeRemaining, setTimeRemaining] = useState(null);

  // Update timer every second during song selection phase
  useEffect(() => {
    // Don't show timer during prompt voting (it has its own timer)
    const isPromptVoting = room?.phase === "promptVoting";
    if (!selectionStartedAt || roundLength === 0 || hasSongSubmitted || isRatingPhase || isPromptVoting) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = (Date.now() - selectionStartedAt) / 1000;
      const remaining = Math.max(0, roundLength - elapsed);
      setTimeRemaining(Math.ceil(remaining));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [selectionStartedAt, roundLength, hasSongSubmitted, isRatingPhase, room?.phase]);

  // Format timer display
  const formatTimer = (seconds) => {
    if (seconds === null) return null;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Effects
  // =======

  // Auto-submit on timer expiry when user has a song selected (any screen)
  useEffect(() => {
    // Trigger at 2 seconds to give buffer for network latency before server timeout
    // Guard prevents multiple submissions as timer ticks from 2 → 1 → 0
    // Check both selectedTrack (in snippet selector) and pendingTrack (clicked in search results)
    const trackToSubmit = selectedTrack || pendingTrack;

    if (timeRemaining !== null && timeRemaining <= 2 && timeRemaining > 0 &&
        trackToSubmit && !hasAutoSubmittedRef.current) {
      hasAutoSubmittedRef.current = true;

      // Preview clips are the whole snippet, so snippet is always null.
      if (showSnippetSelector && selectedTrack) {
        const currentSelection = snippetSelectorRef.current?.getCurrentSelection?.();
        handleConfirmSongWithSnippet(currentSelection || { ...selectedTrack, snippet: null });
      } else {
        handleConfirmSongWithSnippet({ ...trackToSubmit, snippet: null });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining, showSnippetSelector, selectedTrack, pendingTrack]);

  // Reset auto-submit guard when selection is cleared (allows future auto-submits in next round)
  useEffect(() => {
    if (!selectedTrack && !pendingTrack) {
      hasAutoSubmittedRef.current = false;
    }
  }, [selectedTrack, pendingTrack]);

  // Lock selection when timer enters danger zone (prevents race condition on rapid clicks)
  useEffect(() => {
    if (timeRemaining !== null && timeRemaining <= 3 && !selectionLocked && (selectedTrack || pendingTrack)) {
      setSelectionLocked(true);
    }
    // Reset lock when timer resets or phase changes
    if (timeRemaining === null || timeRemaining > 3) {
      setSelectionLocked(false);
    }
  }, [timeRemaining, selectionLocked, selectedTrack, pendingTrack]);

  // Clean up selection state when phase changes to rating (handles edge cases where auto-submit fails)
  // Note: State setters are stable and don't need deps
  useEffect(() => {
    if (isRatingPhase) {
      setShowSnippetSelector(false);
      setSelectedTrack(null);
      setPendingTrack(null);
    }
  }, [isRatingPhase]);

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
   * Handles music track search with caching and debouncing via Express server.
   * The Express proxy queries iTunes + Deezer and returns 30s preview clips.
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
    // Validate required session data
    if (!session?.playerId) {
      showToast("Session expired. Please refresh the page.", "error");
      navigate("/");
      return;
    }

    const finalConnectionId = session?.connectionId || connectionId;
    if (!finalConnectionId) {
      showToast("Connection error. Please refresh the page.", "error");
      return;
    }

    try {
      await submitSong({
        code: gameCode,
        playerId: session.playerId,
        connectionId: finalConnectionId,
        trackId: trackWithSnippet.id,
        trackDetails: {
          name: trackWithSnippet.name,
          artist: trackWithSnippet.artists[0].name,
          albumCover: trackWithSnippet.album.images[0].url,
          previewUrl: trackWithSnippet.preview_url,
          // Preview clips have no sub-window, so snippet is omitted (the
          // validator is v.optional — it accepts undefined, not null).
          ...(trackWithSnippet.snippet ? { snippet: trackWithSnippet.snippet } : {}),
        },
      });
    } catch (error) {
      const errorMessage = error?.message || "Failed to submit song. Please try again.";
      showToast(errorMessage, "error");
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
    // Validate required session data
    if (!session?.playerId) {
      showToast("Session expired. Please refresh the page.", "error");
      navigate("/");
      return;
    }

    const finalConnectionId = session?.connectionId || connectionId;
    if (!finalConnectionId) {
      showToast("Connection error. Please refresh the page.", "error");
      return;
    }

    try {
      await submitRating({
        code: gameCode,
        playerId: session.playerId,
        connectionId: finalConnectionId,
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

  // Check if we're in prompt voting phase
  const isPromptVotingPhase = room?.phase === "promptVoting";

  const renderContent = () => {
    // Handle prompt voting phase first
    if (isPromptVotingPhase) {
      return <PromptVoting gameCode={gameCode} />;
    }

    if (isRatingPhase) {
      // Check if this is the player's own song
      const isOwnSong = songToRate?.player?.id === session?.playerId;

      // Show WaitingScreen only if already rated someone else's song
      if (hasRatingSubmitted && !isOwnSong) {
        return (
          <WaitingScreen
            completedCount={ratingSubmittedCount}
            totalCount={totalPlayers}
            message="Waiting for other players to rate this song..."
          />
        );
      } else if (songToRate) {
        // Show RatingScreen for both voting and spectating (own song)
        // spectatorMode shows the video/audio but hides voting UI
        return (
          <RatingScreen
            currentPrompt={currentPrompt}
            songToRate={songToRate}
            onSubmitRating={handleSubmitRating}
            onAutoSubmit={handleSubmitRating}
            currentIndex={ratingIndex}
            totalSongs={totalSongs}
            anonymousMode={room?.settings?.anonymousMode}
            spectatorMode={isOwnSong}
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
            onSelectionChange={selectionLocked ? undefined : setPendingTrack}
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

  // Selection timer component
  const SelectionTimer = () => {
    if (timeRemaining === null || hasSongSubmitted || isRatingPhase) return null;

    const isLow = timeRemaining <= 10;

    return (
      <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full font-bold text-lg ${
        isLow
          ? 'bg-red-600 text-white animate-pulse'
          : 'bg-[#242424] text-white'
      }`}>
        ⏱ {formatTimer(timeRemaining)}
      </div>
    );
  };

  return (
    <>
      <SelectionTimer />
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
          ref={snippetSelectorRef}
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

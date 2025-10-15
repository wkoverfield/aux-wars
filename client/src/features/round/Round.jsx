import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGame } from "../../services/GameContext";
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
  const { state, dispatch } = useGame();
  const currentRatingSong = useQuery(api.game.flow.getCurrentRatingSong, gameCode ? { code: gameCode } : 'skip');
  const submissionStatus = useQuery(api.game.flow.getSubmissionStatus, gameCode ? { code: gameCode } : 'skip');
  const currentRatingStatus = useQuery(api.game.flow.getCurrentRatingStatus, gameCode ? { code: gameCode } : 'skip');
  const submitSong = useMutation(api.game.flow.submitSong);
  const submitRating = useMutation(api.game.flow.submitRating);
  const { showToast } = useToast();
  const { session } = useSession();

  // State Management
  // ===============

  // Song Selection State
  const [isSongSelectionView, setIsSongSelectionView] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [showSnippetSelector, setShowSnippetSelector] = useState(false);
  
  // Submission Tracking State
  const [hasSongSubmitted, setHasSongSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [totalPlayers, setTotalPlayers] = useState(0);
  
  // Rating Phase State
  const [isRatingPhase, setIsRatingPhase] = useState(false);
  const [songToRate, setSongToRate] = useState(null);
  const [ratingIndex, setRatingIndex] = useState(0);
  const [totalSongs, setTotalSongs] = useState(0);
  const [hasRatingSubmitted, setHasRatingSubmitted] = useState(false);
  const [ratingSubmittedCount, setRatingSubmittedCount] = useState(0);
  
  // Transition State
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Effects
  // =======


  // Phase-driven navigation handled by GameRouteGuard

  /**
   * Handles prompt updates and requests current prompt on mount
   */
  useEffect(() => {
    if (currentRatingSong) {
      // rating phase
      setIsRatingPhase(true);
      setSongToRate(currentRatingSong);
      setHasRatingSubmitted(false);
    }
  }, [currentRatingSong]);

  /**
   * Manages song submission updates and tracking
   */
  useEffect(() => {
    if (submissionStatus) {
      setSubmittedCount(submissionStatus.submitted || 0);
      setTotalPlayers(submissionStatus.total || 0);
    }
  }, [submissionStatus]);

  useEffect(() => {
    if (currentRatingStatus) {
      setRatingSubmittedCount(currentRatingStatus.submitted || 0);
      setTotalPlayers(currentRatingStatus.total || 0);
    }
  }, [currentRatingStatus]);

  // Rating transitions are handled on the backend via scheduler and queries

  // Auto-skip rating for player's own song
  useEffect(() => {
    if (isRatingPhase && songToRate && session?.playerId) {
      if (songToRate.player?.id === session.playerId && !hasRatingSubmitted) {
        submitRating({ code: gameCode, playerId: session.playerId, songId: songToRate.songId, rating: -1 })
          .then(() => setHasRatingSubmitted(true))
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRatingPhase, songToRate, session?.playerId]);

  // Phase changes handled by GameRouteGuard

  /**
   * Handles YouTube track search with caching and debouncing
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
    setHasSongSubmitted(true);
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
      await submitRating({ code: gameCode, playerId: session?.playerId, songId, rating });
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
      if (hasRatingSubmitted) {
        return (
          <WaitingScreen 
            completedCount={ratingSubmittedCount} 
            totalCount={totalPlayers}
            message="Waiting for other players to rate this song..." 
          />
        );
      } else if (songToRate) {
        return (
          <RatingScreen
            currentPrompt={state.currentPrompt}
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
            currentPrompt={state.currentPrompt}
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
            currentPrompt={state.currentPrompt}
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

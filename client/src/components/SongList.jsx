import SongItem from './SongItem';

/**
 * SongList component displays a list of songs with selection functionality.
 * Shows a message when no songs are found.
 * 
 * @param {Object} props - Component props
 * @param {Array<Object>} props.tracks - Array of track objects to display
 * @param {Object} props.selectedTrack - Currently selected track
 * @param {Function} props.onSelectTrack - Callback when a track is selected
 * @param {Function} props.onConfirmTrack - Callback when a track is confirmed
 * @returns {JSX.Element} Rendered component
 */
const SongList = ({ tracks, selectedTrack, onSelectTrack, onConfirmTrack }) => {
  return (
    <div className="song-list flex-1 overflow-y-auto px-4">
      {tracks && tracks.length > 0 ? (
        tracks.map((track) => (
          <SongItem
            key={track.id}
            track={track}
            selected={selectedTrack && selectedTrack.id === track.id}
            onSelect={() => onSelectTrack(track)}
            onSelectSong={() => onConfirmTrack(track)}
          />
        ))
      ) : (
        <div className="text-center text-gray-200 py-4">
          No songs found. Try searching for something else.
        </div>
      )}
    </div>
  );
};

export default SongList;

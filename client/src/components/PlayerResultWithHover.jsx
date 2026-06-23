import React from 'react';
import recordLogo from './record-logo.svg';
import AlbumThumbnailWithHover from './AlbumThumbnailWithHover';

/**
 * PlayerResultWithHover component displays a player's game results with hover expansion.
 * Shows album covers that expand on hover to reveal all songs.
 * 
 * @param {Object} props - Component props
 * @param {string} props.playerName - Name of the player
 * @param {Array<Object>} props.songs - Array of song objects with details
 * @param {number} props.wins - Number of wins
 * @param {number} props.totalRecords - Total number of records earned
 * @param {boolean} [props.isWinner=false] - Whether this player is the winner
 * @returns {JSX.Element} Rendered component
 */
const PlayerResultWithHover = React.memo(function PlayerResultWithHover({ playerName, songs, wins, totalRecords, isWinner = false }) {
  const albums = songs?.map(song => song.albumCover) || [];
  const isStack = albums.length > 1;
  

  if (isWinner) {
    // Winner: large vertical layout with flexible thumbnail container
    return (
      <div className="flex flex-col items-center text-center w-full max-w-md mx-auto mb-4 p-2 md:mb-8 md:p-4">
        <div className="flex justify-center items-center mb-2 md:mb-4 h-20 md:h-28">
          <div className="flex items-center justify-center">
            {songs?.slice(0, 5).map((song, idx) => (
              <AlbumThumbnailWithHover
                key={idx}
                album={song.albumCover}
                song={song}
                index={idx}
                isStacked={isStack}
                size="large"
                stackOffset={36}
              />
            ))}
          </div>
        </div>
        
        <div className="text-center w-full mt-1 md:mt-2">
          <h3 className="text-xl md:text-2xl lg:text-3xl font-bold m-0 text-[#68d570]">{playerName}</h3>
          <div className="flex flex-row justify-center items-center gap-2 md:gap-4 mt-1 md:mt-2">
            <span className="text-base md:text-lg lg:text-xl font-semibold text-white">{wins} Win{wins !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1 text-gray-300 text-base md:text-lg lg:text-xl font-semibold">
              <img src={recordLogo} alt="Record" className="w-5 h-5 md:w-7 md:h-7 inline-block" />
              {totalRecords}
            </span>
          </div>
        </div>
      </div>
    );
  } else {
    // Non-winner: row layout with flexible thumbnail container
    return (
      <div className="flex items-center w-[95%] max-w-[580px] mx-auto my-4 p-3 rounded-lg text-white text-left gap-4">
        <div className="flex items-center">
          {songs?.slice(0, 5).map((song, idx) => (
            <AlbumThumbnailWithHover
              key={idx}
              album={song.albumCover}
              song={song}
              index={idx}
              isStacked={isStack}
              size="small"
              stackOffset={18}
            />
          ))}
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col justify-center">
          <h3 className="text-xl font-bold m-0 text-white truncate">{playerName}</h3>
          <div className="flex flex-row items-center gap-3 mt-1">
            <span className="text-base text-white font-semibold">{wins} Win{wins !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1 text-gray-300 text-base font-semibold">
              <img src={recordLogo} alt="Record" className="w-5 h-5 inline-block" />
              {totalRecords}
            </span>
          </div>
        </div>
      </div>
    );
  }
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  return (
    prevProps.playerName === nextProps.playerName &&
    prevProps.wins === nextProps.wins &&
    prevProps.totalRecords === nextProps.totalRecords &&
    prevProps.isWinner === nextProps.isWinner &&
    prevProps.songs?.length === nextProps.songs?.length &&
    JSON.stringify(prevProps.songs) === JSON.stringify(nextProps.songs)
  );
});

export default PlayerResultWithHover;

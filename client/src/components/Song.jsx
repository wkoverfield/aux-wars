import recordLogo from './record-logo.svg'

/**
 * Song component displays a song's details including album cover, track info, and rating.
 * Can be rendered in two different layouts: winner (vertical) or non-winner (horizontal).
 * 
 * @param {Object} props - Component props
 * @param {string} props.track - Name of the track
 * @param {string} props.artist - Name of the artist
 * @param {string} props.albumCover - URL of the album cover image
 * @param {string} props.player - Name of the player who submitted the song
 * @param {number} props.rating - Rating given to the song
 * @param {string} props.winner - Indicates if this is the winning song ('winner' or undefined)
 * @returns {JSX.Element} Rendered component
 */
export default function Song({ track, artist, albumCover, player, rating, winner }) {
    if (winner === 'winner') {
        return (
            <div className="flex flex-col items-center text-center w-full max-w-md mx-auto p-2 md:p-4">
                {/* Album cover */}
                <div className="relative flex flex-col items-center mb-2 md:mb-4">
                    <img 
                        src={albumCover} 
                        className="w-32 h-32 md:w-44 md:h-44 lg:w-[180px] lg:h-[180px] rounded-lg shadow-lg" 
                        alt="Album Cover"
                    />
                </div>
                
                {/* Song and player info */}
                <div className="text-center w-full">
                    <h3 className="text-lg md:text-xl lg:text-2xl font-bold m-0 text-white">{player}</h3>
                    <h5 className="text-base md:text-lg truncate max-w-[250px] mx-auto my-0.5 text-white">{track}</h5>
                    <p className="text-xs md:text-sm text-gray-300 truncate max-w-[250px] mx-auto">{artist}</p>
                </div>
            </div>
        );
    } else {
        return (
            <div className="flex items-center justify-between w-full max-w-2xl mx-auto my-4 p-3 rounded-lg text-white">
                {/* Album cover */}
                <div className="mr-4">
                    <img 
                        src={albumCover} 
                        className="w-[60px] h-[60px] md:w-[80px] md:h-[80px] rounded-md shadow-md" 
                        alt="Album Cover"
                    />
                </div>
                
                {/* Song and player info */}
                <div className="flex-1 overflow-hidden min-w-0 pr-2">
                    <h3 className="text-lg md:text-xl font-bold m-0 text-white truncate">{player}</h3>
                    <h5 className="text-sm md:text-base truncate my-0.5 text-white">{track}</h5>
                    <p className="text-xs md:text-sm text-gray-300 truncate">{artist}</p>
                </div>
                
                {/* Rating display */}
                <div className="flex items-center whitespace-nowrap flex-shrink-0">
                    <img src={recordLogo} className="w-10 h-10 md:w-16 md:h-16 mr-1" alt="Record Logo"/>
                    <span className="text-white font-bold text-xl md:text-2xl">{rating}</span>
                </div>
            </div>
        );
    }
}
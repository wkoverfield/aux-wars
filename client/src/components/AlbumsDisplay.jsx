import AlbumRow from "./AlbumsRow";

/**
 * AlbumsDisplay component creates a grid of album covers with alternating row directions.
 * Splits albums into rows of 9 and displays them in a vertical stack.
 * 
 * @param {Object} props - Component props
 * @param {Array<Object>} props.albums - Array of album objects to display
 * @returns {JSX.Element} Rendered component
 */
export default function AlbumsDisplay({ albums }) {
  // Split albums into rows of 9
  const chunkSize = 9;
  const chunkedAlbums = [];
  for (let i = 0; i < albums.length; i += chunkSize) {
    chunkedAlbums.push(albums.slice(i, i + chunkSize));
  }

  return (
    <div className="album-display h-screen absolute z-10 flex flex-col justify-center gap-16 md:gap-20">
      {chunkedAlbums.map((albumRow, rowIndex) => (
        <AlbumRow
          key={rowIndex}
          albums={albumRow}
          direction={rowIndex % 2 === 0 ? "left" : "right"}
        />
      ))}
    </div>
  );
}

/**
 * One row of the homepage album wall, drifting horizontally with a CSS
 * animation (see .album-row-track in index.css) so it runs on the compositor.
 *
 * @param {Object} props - Component props
 * @param {Array<string>} props.albums - Album cover image URLs
 * @param {string} props.direction - Drift direction ('left' or 'right')
 * @returns {JSX.Element} Rendered component
 */
export default function AlbumRow({ albums, direction }) {
  return (
    <div className="album-row-track" data-direction={direction === "left" ? "left" : "right"}>
      <div className="album-row flex gap-10">
        {albums.map((album, index) => (
          <div key={index} className="album">
            <img
              src={album}
              alt=""
              width={250}
              height={250}
              decoding="async"
              className="block w-full h-auto aspect-square object-cover"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

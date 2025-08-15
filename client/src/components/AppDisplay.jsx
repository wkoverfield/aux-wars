import AlbumsDisplay from "./AlbumsDisplay";
import { Outlet } from "react-router-dom";
import albums from "./albums";

/**
 * AppDisplay component serves as the main layout container for the application.
 * It provides a full-screen container with routing outlet for nested components.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function AppDisplay() {
  return (
    <div className="relative w-full h-screen overflow-hidden">
      <AlbumsDisplay albums={albums} />
      <div className="relative z-20 h-full">
        <Outlet />
      </div>
    </div>
  );
}

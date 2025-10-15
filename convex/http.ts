import { httpRouter } from "convex/server";
import { youtubeSearch } from "./youtube";

const http = httpRouter();

http.route({ path: "/youtube/search", method: "POST", handler: youtubeSearch });

export default http;




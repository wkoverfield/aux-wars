import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useNoIndex } from "../../hooks/useNoIndex";
import logo from "../../assets/aux-wars-logo.svg";
import { screenViewFor, stageFor } from "./screenModel";
import { StageContext } from "./stage";
import { useScreenPresence } from "./useScreenPresence";
import {
  ScreenLobby,
  ScreenPrompt,
  ScreenSelection,
  ScreenRating,
  ScreenTallying,
  ScreenResults,
  ScreenJoinTag,
} from "./ScreenViews";
import ScreenGameOver from "./ScreenGameOver";

function useStage() {
  const read = () => (typeof window === "undefined" ? stageFor(0, 0) : stageFor(window.innerWidth, window.innerHeight));
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const onResize = () => setScale(read());
    // Rotating a phone or tablet flips the stage between landscape and portrait.
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return scale;
}

/** Keeps a TV or laptop from sleeping mid-game, where the browser allows it. */
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock?.request) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = () => {
      navigator.wakeLock.request("screen").then((l) => {
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      }).catch(() => {});
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

/**
 * Browsers block sound until someone interacts with the page, and a TV has
 * nobody tapping it mid-game: one tap here lets every song after it play out
 * loud on its own.
 */
function StartOverlay({ onStart }) {
  return (
    <button
      type="button"
      data-vital="screen-start"
      onClick={onStart}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black/70 text-white cursor-pointer"
    >
      <img src={logo} alt="" className="w-20" />
      <span className="rounded-full bg-[#68d570] px-10 py-4 text-3xl font-bold text-black">
        Tap to start Local play
      </span>
      <span className="text-2xl text-white/60 text-center px-10">The songs play from here. Everyone picks and votes on their phone.</span>
    </button>
  );
}

function RoomNotFound({ quickPlay = false }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-6 text-white text-center px-10">
      <img src={logo} alt="" className="w-20" />
      <h1 className="text-5xl font-bold">{quickPlay ? "Local play isn't available here" : "Room not found"}</h1>
      <p className="text-2xl text-gray-300">
        {quickPlay ? "Quick Play rooms play on phones only." : "This game has ended or the code is wrong."}
      </p>
      <Link to="/" className="text-xl text-gray-400 hover:text-white underline underline-offset-4">
        Go to the home page
      </Link>
    </div>
  );
}

/**
 * /screen/:code: the room on a TV or laptop for everyone in the room to
 * watch. Display only: it never joins the room, has no controls, and plays
 * each song out loud so phones can stay quiet.
 */
export default function BigScreen() {
  const { code: rawCode } = useParams();
  const code = (rawCode || "").toUpperCase();
  useNoIndex(code ? `Aux Wars · ${code}` : "Aux Wars");
  const stage = useStage();
  const [started, setStarted] = useState(false);

  const roomResult = useQuery(api.game.rooms.getRoomByCode, code ? { code } : "skip");
  const ratingSong = useQuery(api.game.flow.getCurrentRatingSong, code ? { code } : "skip");
  const view = screenViewFor(code ? roomResult : null, ratingSong);
  const room = roomResult?.room || null;
  const players = roomResult?.players || [];
  // Quick Play rooms get no screen: nothing attaches, nothing plays.
  const exists = Boolean(room) && view !== "unavailable";

  // Attached only once it can play sound: until the start tap, phones keep
  // their audio and songs are not held for the screen.
  useScreenPresence(code, exists && started);
  useWakeLock(started && exists);

  let content = null;
  if (view === "missing") content = <RoomNotFound />;
  else if (view === "unavailable") content = <RoomNotFound quickPlay />;
  else if (view === "lobby") content = <ScreenLobby code={code} room={room} players={players} />;
  else if (view === "prompt") content = <ScreenPrompt code={code} room={room} />;
  else if (view === "selection") content = <ScreenSelection code={code} room={room} players={players} />;
  else if (view === "rating") content = <ScreenRating code={code} room={room} song={ratingSong} audioOn={started} />;
  else if (view === "tallying") content = <ScreenTallying />;
  else if (view === "results") content = <ScreenResults code={code} room={room} />;
  else if (view === "gameOver") content = <ScreenGameOver code={code} room={room} />;

  return (
    <div data-vital="screen" className="fixed inset-0 overflow-hidden flex items-center justify-center">
      <div
        className="relative shrink-0"
        data-stage={stage.portrait ? "portrait" : "landscape"}
        style={{ width: stage.width, height: stage.height, transform: `scale(${stage.scale})`, transformOrigin: "center" }}
      >
        <StageContext.Provider value={{ portrait: stage.portrait }}>
          {content}
          {exists && view !== "lobby" && <ScreenJoinTag code={code} />}
          {exists && !started && <StartOverlay onStart={() => setStarted(true)} />}
        </StageContext.Provider>
      </div>
    </div>
  );
}

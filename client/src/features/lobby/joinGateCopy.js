/**
 * What the join screen says about a room, from its public state.
 * `canJoin` is false for rooms a link can never seat someone in.
 */
// Names the app assigns until a player types their own ("Host", "Player 42").
const PLACEHOLDER_NAME_RE = /^(Host|Player \d{1,3})$/;

/** True for a name the app assigned, which says nothing about who the player is. */
export function isPlaceholderName(name) {
  return PLACEHOLDER_NAME_RE.test(String(name || "").trim());
}

export function joinGateCopy(room, players) {
  const count = players.length;
  const host = players.find((p) => p.isHost)?.name?.trim();
  const who = host && !isPlaceholderName(host) ? `${host}'s game` : "this game";
  if (room.isPublic) {
    return {
      canJoin: false,
      title: "This is a Quick Play game",
      detail: "Quick Play matches you with players automatically, so it can't be joined by link. Start Quick Play from the home page.",
    };
  }
  if (room.locked) {
    return {
      canJoin: false,
      title: "This room is locked",
      detail: "The host has stopped new players from joining. Ask them to unlock it, then open the link again.",
    };
  }
  const people = `${count} ${count === 1 ? "player" : "players"} in the room`;
  return {
    canJoin: true,
    title: `Join ${who}`,
    detail: room.phase === "lobby" ? `${people}. Pick a name to jump in.` : `${people}, game in progress. Pick a name to jump in.`,
  };
}

import { capture } from "./posthog";

export function hashRoomCode(code) {
  const value = String(code || "").trim().toUpperCase();
  if (!value) return null;

  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return `room_${(hash >>> 0).toString(36)}`;
}

export function gameProperties({ code, room, players, session, extra } = {}) {
  const settings = room?.settings || {};
  return {
    room_code_hash: hashRoomCode(code),
    is_host: Boolean(players?.some?.((player) => player.playerId === session?.playerId && player.isHost)),
    player_count: Array.isArray(players) ? players.length : undefined,
    round_number: room?.currentRound,
    room_phase: room?.phase,
    rounds_total: settings.numberOfRounds,
    song_selection_time: settings.roundLength,
    clip_length: settings.snippetDuration,
    prompt_pool_size: Array.isArray(settings.selectedPrompts) ? settings.selectedPrompts.length : undefined,
    prompt_voting_enabled: settings.enablePromptVoting !== false,
    anonymous_mode: Boolean(settings.anonymousMode),
    host_pro: Boolean(settings.hostPro),
    ...extra,
  };
}

export function captureGameEvent(event, properties) {
  capture(event, properties);
}

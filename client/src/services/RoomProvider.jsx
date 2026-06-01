import React, { createContext, useContext } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

const RoomContext = createContext(null);

export function RoomProvider({ children }) {
  const { gameCode } = useParams();
  const roomData = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');
  const value = {
    room: roomData?.room || roomData || null,
    players: roomData?.players || [],
    loading: roomData === undefined,
  };
  return (
    <RoomContext.Provider value={value}>
      {children}
    </RoomContext.Provider>
  );
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}

// Non-throwing variant: returns null when used outside a RoomProvider (e.g. the
// Home screen). Used by AdSlot so it can self-suppress ads in pro rooms without
// breaking on screens that have no room context.
export function useRoomOptional() {
  return useContext(RoomContext);
}



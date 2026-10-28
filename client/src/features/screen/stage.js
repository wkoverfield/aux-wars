import { createContext, useContext } from "react";

/** The stage the screen is drawn on: { portrait } (see stageFor). */
export const StageContext = createContext({ portrait: false });

/** Whether the screen is upright (the 720x1280 portrait stage). */
export function usePortrait() {
  return useContext(StageContext).portrait;
}

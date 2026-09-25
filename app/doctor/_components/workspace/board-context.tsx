"use client";

import { createContext, useContext } from "react";

/** What a row, the panel and the sheet may ask of the board. */
export interface BoardApi {
  /** Open the patient panel (`?patient=`), optionally at a section. */
  openPanel: (key: string, section?: PanelSection) => void;
  /** Say what went wrong (or clear it); the board shows one message at a time. */
  report: (message: string | null) => void;
  /** An own action is under way: its result shows even while the list is held (E3). */
  follow: () => void;
  serverNowIso: string;
}

export type PanelSection = "also_open" | "assign" | "reassign";

export const BoardContext = createContext<BoardApi | null>(null);

export function useBoard(): BoardApi {
  const api = useContext(BoardContext);
  if (!api) throw new Error("useBoard is only available inside the workspace board");
  return api;
}

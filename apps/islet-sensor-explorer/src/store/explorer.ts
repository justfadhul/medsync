import type { Path } from "@/content/sensor";
import { create } from "zustand";

import { CYCLE } from "@/content/sensor";
import { PATHS } from "@/lib/nodes";

/**
 * The one piece of shared state the explorer screens hold: what is selected,
 * which signal paths are showing, and where the cycle playback has reached.
 *
 * Nothing derived lives here. A screen works out its own filtered lists from
 * these values, so the store never has to be kept in step with the content.
 */

export type PathFilter = Record<Path, boolean>;

function allPathsOn(): PathFilter {
  const filter = {} as PathFilter;
  for (const path of PATHS) filter[path] = true;
  return filter;
}

/** The cycle is a loop, so stepping past either end comes round again. */
const CYCLE_LENGTH = Math.max(1, CYCLE.length);

export interface ExplorerState {
  /** The part whose detail is open, or null when nothing is selected. */
  selectedPartId: number | null;
  /** Which signal paths are drawn. All four are on to begin with. */
  activePaths: PathFilter;
  /** True while the measurement cycle is running on its own. */
  playing: boolean;
  /** Which cadence step is showing, counted from zero. */
  cycleIndex: number;

  setSelectedPart: (id: number | null) => void;
  togglePart: (id: number) => void;
  togglePath: (path: Path) => void;
  resetPaths: () => void;

  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBack: () => void;
  reset: () => void;
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  selectedPartId: null,
  activePaths: allPathsOn(),
  playing: false,
  cycleIndex: 0,

  setSelectedPart: (id) => set({ selectedPartId: id }),
  togglePart: (id) => set((state) => ({ selectedPartId: state.selectedPartId === id ? null : id })),
  togglePath: (path) =>
    set((state) => ({
      activePaths: { ...state.activePaths, [path]: !state.activePaths[path] },
    })),
  resetPaths: () => set({ activePaths: allPathsOn() }),

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  stepForward: () => set((state) => ({ cycleIndex: (state.cycleIndex + 1) % CYCLE_LENGTH })),
  stepBack: () =>
    set((state) => ({ cycleIndex: (state.cycleIndex - 1 + CYCLE_LENGTH) % CYCLE_LENGTH })),
  reset: () => set({ playing: false, cycleIndex: 0 }),
}));

import type { Board } from "../types";
import type { EngineInterface } from "claude-code";

// The board both lines share. `$.store` is one JSON file per user with no
// compare-and-set, so two sessions writing at once could lose a lock; this
// file lives under the git common dir (shared by every checkout and worktree
// of the repo) and every change runs under an atomic `mkdir` mutex, written
// to a temp file and moved into place.

export const emptyBoard = (): Board => ({
  lines: {},
  locks: {},
  tasks: [],
  cso: [],
  csoNext: 1,
  stale: {},
  stream: [],
  needs: [],
  notes: [],
  traffic: [],
  checks: {},
  agents: {},
});

const STALE_MUTEX_MS = 5_000;

export async function readBoard($: EngineInterface, dir: string): Promise<Board> {
  try {
    return {
      ...emptyBoard(),
      ...(JSON.parse(await $.fs.read(`${dir}/board.json`)) as Partial<Board>),
    };
  } catch {
    return emptyBoard();
  }
}

/** Runs `change` on the freshest board under the mutex and saves it. */
export async function mutateBoard<T>(
  $: EngineInterface,
  dir: string,
  tag: string,
  change: (board: Board, now: number) => T,
): Promise<{ board: Board; value: T }> {
  const mutex = `${dir}/.mutex`;
  for (let attempt = 0; ; attempt++) {
    if ((await $.process.run(["mkdir", mutex])).exitCode === 0) break;
    if (attempt > 80) throw new Error("medsync: board mutex stuck");
    const held = await $.fs.stat(mutex).catch(() => undefined);
    if (held && (await $.clock.now()) - held.mtimeMs > STALE_MUTEX_MS)
      await $.process.run(["rmdir", mutex]);
    else await $.process.run(["sleep", "0.05"]);
  }
  try {
    const board = await readBoard($, dir);
    const value = change(board, await $.clock.now());
    board.stream = board.stream.slice(-150);
    board.traffic = board.traffic.slice(-40);
    const tmp = `${dir}/board.${tag}.tmp`;
    await $.fs.write(tmp, JSON.stringify(board));
    await $.process.run(["mv", "-f", tmp, `${dir}/board.json`]);
    return { board, value };
  } finally {
    await $.process.run(["rmdir", mutex]);
  }
}

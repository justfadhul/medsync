import { getTableName } from "drizzle-orm";

/**
 * A scripted stand-in for Drizzle's `db`: each awaited SELECT takes the next
 * queued result, each UPDATE / INSERT is recorded. Enough to test a write
 * path's decisions (what it reads, then what it writes) without a database.
 */
export function scriptedDb() {
  const queue: unknown[][] = [];
  const writes: { kind: "update" | "insert"; table: string; values: Record<string, unknown> }[] =
    [];
  const thenable = <T>(run: () => T) => ({
    then: (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(run()).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  });
  const select = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
      chain[m] = () => chain;
    }
    Object.assign(
      chain,
      thenable(() => queue.shift() ?? []),
    );
    return chain;
  };
  const db = {
    select,
    update: (t: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => ({
        where: () =>
          thenable(() => {
            writes.push({ kind: "update", table: getTableName(t), values });
            return [];
          }),
      }),
    }),
    insert: (t: Parameters<typeof getTableName>[0]) => ({
      values: (values: Record<string, unknown>) => {
        const record = () => {
          writes.push({ kind: "insert", table: getTableName(t), values });
          return [{ id: "new-encounter" }];
        };
        return { returning: () => thenable(record), ...thenable(record) };
      },
    }),
  };
  return { db, queue, writes };
}

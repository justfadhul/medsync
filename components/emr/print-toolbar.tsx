"use client";

import { Button } from "@/components/ui/button";

/**
 * Screen-only controls above a printout: Print, and — when restricted items exist — a plain GET
 * form that includes them item by item (`?include=<id>`). Unticked, they stay off the paper.
 */
export function PrintToolbar({
  withheld,
  included = [],
}: {
  withheld: readonly { id: string; label: string }[];
  included?: readonly { id: string; label: string }[];
}) {
  const all = [...included, ...withheld];
  return (
    <>
      <Button onClick={() => window.print()}>Print</Button>
      {all.length > 0 ? (
        <form method="get" className="border-border flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-body-s text-foreground">
            {withheld.length === 0
              ? "Restricted items included in this printout"
              : `${withheld.length} restricted item${withheld.length === 1 ? "" : "s"} not printed — include:`}
          </p>
          {all.map((i) => (
            <label key={i.id} className="text-body-s flex min-h-11 items-center gap-2 sm:min-h-0">
              <input
                type="checkbox"
                name="include"
                value={i.id}
                defaultChecked={included.some((x) => x.id === i.id)}
                className="size-4 accent-teal-600"
              />
              {i.label}
            </label>
          ))}
          <Button type="submit" variant="secondary" size="sm" className="w-fit">
            Update printout
          </Button>
        </form>
      ) : null}
    </>
  );
}

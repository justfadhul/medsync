"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { RC } from "@/content/pharmacy-rework-records";
import { CataloguePicker, pickTitle } from "../../_components/catalogue-picker";
import { addFromCatalogueAction } from "../actions";

const M = RC.setup.medicines;

/** Set-up › Medicines: tick medicines in MedSync's catalogue; each becomes one of the hospital's products. */
export function AddFromCatalogue() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string[]>([]);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button disabled={pending} onClick={() => setOpen(true)}>
        {M.add}
      </Button>
      <CataloguePicker
        open={open}
        onOpenChange={setOpen}
        onPick={() => {}}
        onPickMany={(picks) => {
          const fresh = picks.flatMap((p) =>
            p.kind === "pack"
              ? [p.pack.packId ? { packId: p.pack.packId } : { medicineId: p.medicine.id }]
              : [],
          );
          const titles = picks.filter((p) => p.kind === "pack").map(pickTitle);
          const mine = picks
            .filter((p) => p.kind === "product")
            .map((p) => `${pickTitle(p)}: ${M.already}`);
          if (!fresh.length) return setSaid(mine);
          start(async () => {
            const r = await addFromCatalogueAction({ picks: fresh });
            setSaid(
              r.ok
                ? [
                    ...(r.data?.notes ?? []).map((n, i) =>
                      n?.includes(titles[i]!) ? n : `${titles[i]}: ${n ?? M.already}`,
                    ),
                    ...mine,
                  ]
                : [r.error],
            );
            router.refresh();
          });
        }}
      />
      <span
        role="status"
        aria-live="polite"
        className="text-caption text-ink-700 max-w-md text-right"
      >
        {said.map((s) => (
          <span key={s} className="block">
            {s}
          </span>
        ))}
      </span>
    </span>
  );
}

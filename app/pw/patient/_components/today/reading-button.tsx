"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { ReadingDialog } from "@/components/tide/reading-dialog";

type Kind = "bp" | "sugar" | "weight" | "pulse";

/** Opens Log a reading (the centred dialog) for one measure, from a tile or a link on Today. */
export function ReadingButton(p: { kind?: Kind; className?: string; children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={p.className} aria-label={p.label} onClick={() => setOpen(true)}>
        {p.children}
      </button>
      <ReadingDialog open={open} onOpenChange={setOpen} initialKind={p.kind} />
    </>
  );
}

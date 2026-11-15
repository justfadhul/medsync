"use client";

import type { ReactNode } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import s from "./desk.module.css";
import { c, Icon } from "./ui";

/** A centred desk dialog (ADR 0161): EditorDialog underneath, the canvas card on top. */
export function DeskDialog({
  open,
  onClose,
  label,
  size,
  tile,
  red,
  title,
  lead,
  closeLabel = "Close",
  cls,
  mark,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  size?: "xw" | "cbm" | "slm";
  tile: string;
  red?: boolean;
  title: ReactNode;
  lead?: ReactNode;
  closeLabel?: string;
  /** Extra classes on the card (a caller's own width). */
  cls?: string;
  /** Replaces the icon tile (the clinics workspace shows the clinic's colour swatch). */
  mark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <EditorDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      className="w-auto max-w-none overflow-visible rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-h-none sm:max-w-none"
    >
      <div className={`${s.tokens} ${c("modal", size)} ${cls ?? ""}`} aria-label={label}>
        <div className={c("mh")}>
          {mark ?? (
            <span className={c("tile", red && "red")} aria-hidden="true">
              <Icon n={tile} size={18} />
            </span>
          )}
          <div>
            <h2 className={red ? s.redText : undefined}>{title}</h2>
            {lead ? <p>{lead}</p> : null}
          </div>
          <button type="button" className={c("btn", "sm", "q", "x")} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </EditorDialog>
  );
}

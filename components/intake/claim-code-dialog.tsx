"use client";

import type { ClaimCodeResult } from "@/app/reception/actions";
import { useId, useState, useTransition } from "react";
import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react";

import { StatusWord } from "@/components/emr/status-word";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SheetBody,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DESK_CLAIM } from "@/content/desk-register";

const TARGET = "min-h-11";

/**
 * "Give a sign-up code" (ADR 0475, migration 0292): for a patient this desk registered, after checking it is them.
 * The code is shown once; the patient takes the record over with it at sign-up. A new code replaces the old one.
 */
export function ClaimCodeDialog({
  action,
}: {
  action: (patientCode: string) => Promise<ClaimCodeResult>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [patientCode, setPatientCode] = useState("");
  const [result, setResult] = useState<ClaimCodeResult | null>(null);
  const [pending, start] = useTransition();
  const given = result?.ok ? result : null;

  return (
    <EditorDialog
      width="medium"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setPatientCode("");
        }
      }}
      trigger={
        <DialogTrigger render={<Button type="button" variant="ghost" className={TARGET} />}>
          <KeyRoundIcon className="size-4" aria-hidden />
          {DESK_CLAIM.open}
        </DialogTrigger>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation(); // portalled, but React bubbles to the front door's own form
          start(async () => setResult(await action(patientCode)));
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex min-h-0 flex-1 flex-col"
      >
        <SheetHeader>
          <SheetTitle>{DESK_CLAIM.title}</SheetTitle>
          <SheetDescription>{DESK_CLAIM.lead}</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4">
          {given ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-s text-muted-foreground">{DESK_CLAIM.given}</p>
              <p className="text-foreground text-heading-l font-mono tracking-widest tabular-nums">
                {given.code}
              </p>
              <p className="text-body-s text-muted-foreground max-w-[60ch]">
                {DESK_CLAIM.how(
                  new Date(given.expiresAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                )}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-body-s text-foreground font-medium">
                {DESK_CLAIM.patientCode}
              </label>
              <Input
                id={id}
                value={patientCode}
                onChange={(e) => setPatientCode(e.target.value)}
                maxLength={32}
                autoComplete="off"
                className={`${TARGET} font-mono`}
                aria-describedby={`${id}-hint`}
              />
              <span id={`${id}-hint`} className="text-caption text-muted-foreground">
                {DESK_CLAIM.patientCodeHint}
              </span>
            </div>
          )}
          {result && !result.ok ? (
            <p role="alert">
              <StatusWord tone="caution" glyph={TriangleAlertIcon}>
                {result.error}
              </StatusWord>
            </p>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button
            type="button"
            variant="secondary"
            className={TARGET}
            onClick={() => setOpen(false)}
          >
            {DESK_CLAIM.close}
          </Button>
          {given ? null : (
            <Button type="submit" className={TARGET} disabled={pending}>
              {pending ? DESK_CLAIM.pending : DESK_CLAIM.submit}
            </Button>
          )}
        </SheetFooter>
      </form>
    </EditorDialog>
  );
}

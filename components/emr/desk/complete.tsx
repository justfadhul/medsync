"use client";

import type { FollowUpChoice } from "./flows";
import type { DeskPayload } from "./model";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DISPOSITION_CODES } from "@/lib/emr/encounter";
import { ChoiceChips, PRESS } from "../orders/choice-chips";
import { StatusWord } from "../status-word";
import { CLOSURE_WORDS, DISPOSITION_WORDS } from "./model";

/**
 * Complete visit (gate-a E.12, PROMPT §5.10): a disposition is required; follow-up is none, a
 * review date or as needed; the warnings are shown and never block. "Died" is a record state in
 * neutral words. Close without completing needs a reason, is audited, and nothing closes on its
 * own. The printouts are one tap away.
 */

export interface CompleteInput {
  disposition: string | null;
  followUp: FollowUpChoice | null;
  reviewDate: string;
}

const FOLLOW_UP: readonly { value: FollowUpChoice; label: string }[] = [
  { value: "none", label: "None" },
  { value: "review_date", label: "Review on a date" },
  { value: "as_needed", label: "As needed" },
];

export function CompleteVisitView({
  p,
  pending,
  message,
  onComplete,
  onClose,
}: {
  p: DeskPayload;
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
  onComplete?: (input: CompleteInput) => void;
  onClose?: (input: { reason: string | null; note: string }) => void;
}) {
  const [v, setV] = useState<CompleteInput>({ disposition: null, followUp: null, reviewDate: "" });
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onComplete?.(v);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s text-foreground mb-2 font-medium">
            Disposition (required)
          </legend>
          <ChoiceChips
            name="desk-disposition"
            label="Disposition"
            options={DISPOSITION_CODES.map((c) => ({ value: c, label: DISPOSITION_WORDS[c] ?? c }))}
            value={v.disposition}
            onChange={(d) => setV((x) => ({ ...x, disposition: d }))}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s text-foreground mb-2 font-medium">Follow-up</legend>
          <ChoiceChips
            name="desk-follow-up"
            label="Follow-up"
            options={FOLLOW_UP}
            value={v.followUp}
            onChange={(f) => setV((x) => ({ ...x, followUp: f }))}
          />
          {v.followUp === "review_date" ? (
            <div className="flex w-48 flex-col gap-1.5">
              <label htmlFor="desk-review-date" className="text-caption text-muted-foreground">
                Review date
              </label>
              <Input
                id="desk-review-date"
                type="date"
                value={v.reviewDate}
                onChange={(e) => setV((x) => ({ ...x, reviewDate: e.target.value }))}
              />
            </div>
          ) : null}
        </fieldset>
        <div className="flex flex-col gap-2">
          <h3 className="text-body-s text-foreground font-medium">
            Before you complete — warnings, not blocks
          </h3>
          {p.completionWarnings.length ? (
            <ul className="flex flex-col gap-1.5">
              {p.completionWarnings.map((w) => (
                <li key={w}>
                  <StatusWord tone="caution">{w}</StatusWord>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-s text-muted-foreground">Nothing outstanding.</p>
          )}
          <p className="text-body-s text-muted-foreground">
            Pending results move to Results to review.
          </p>
        </div>
        {message ? (
          message.ok ? (
            <p role="status" className="text-body-s text-foreground">
              {message.text}
            </p>
          ) : (
            <p role="status">
              <StatusWord tone="caution">{message.text}</StatusWord>
            </p>
          )
        ) : null}
        <div>
          <Button type="submit" className={PRESS} disabled={!v.disposition || pending}>
            Complete visit
          </Button>
        </div>
      </form>

      <nav
        aria-label="Printouts"
        className="border-border flex flex-wrap gap-x-4 gap-y-2 border-t pt-4"
      >
        <a
          href={p.links.print.summary}
          className="text-body-s font-medium text-teal-700 underline-offset-4 hover:underline"
        >
          Print visit summary
        </a>
        <a
          href={p.links.print.referral}
          className="text-body-s font-medium text-teal-700 underline-offset-4 hover:underline"
        >
          Print referral note
        </a>
        <a
          href={p.links.print.labRequest}
          className="text-body-s font-medium text-teal-700 underline-offset-4 hover:underline"
        >
          Print laboratory request
        </a>
      </nav>

      <div className="border-border flex flex-col gap-3 border-t pt-4">
        {closing ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              onClose?.({ reason, note });
            }}
          >
            <ChoiceChips
              name="desk-closure"
              label="Why the encounter is closed without completing"
              options={p.settings.closureReasons.map((c) => ({
                value: c,
                label: CLOSURE_WORDS[c] ?? c,
              }))}
              value={reason}
              onChange={setReason}
            />
            <label htmlFor="desk-closure-note" className="text-caption text-muted-foreground">
              Note (required for Other)
            </label>
            <Input id="desk-closure-note" value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="text-caption text-muted-foreground">
              Recorded and audited. Nothing closes automatically.
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="secondary"
                disabled={!reason || (reason === "other" && !note.trim()) || pending}
              >
                Close encounter
              </Button>
              <Button type="button" variant="ghost" onClick={() => setClosing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" className="w-fit" onClick={() => setClosing(true)}>
            Close without completing…
          </Button>
        )}
      </div>
    </div>
  );
}

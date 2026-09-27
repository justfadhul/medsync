"use client";

import type { InviteStaffState, IssuedInvitation, StaffActionState } from "../actions";
import type { InvitationRow } from "../page";
import type { PillTone } from "@/components/ui/data-table";
import { useActionState, useEffect, useState } from "react";
import { ClipboardCopyIcon, MailPlusIcon, RotateCcwIcon, SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { inviteStaffAction, revokeStaffInvitationAction } from "../actions";

// Workflow states are tags, never a patient's clinical colours (ADR 0162).
const STATUS_TONES: Record<InvitationRow["status"], PillTone> = {
  pending: "notice",
  accepted: "active",
  revoked: "neutral",
  expired: "neutral",
};

const STATUS_LABEL: Record<InvitationRow["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
};

interface InvitationsPanelProps {
  rows: ReadonlyArray<InvitationRow>;
}

/**
 * Invitations tab — pre-fill hints + claim-URL list.
 *
 * Two halves:
 *   1. Send form: one email per line (single or bulk), required reason.
 *      On submit, the server returns the issued list with plaintext
 *      claim URLs; we render them inline so the admin can copy +
 *      forward (SMS/email integration is its own ticket).
 *   2. Existing invitations: every invitation for THIS hospital with
 *      its current status. Pending ones get a Revoke button.
 *
 * The plaintext token is shown ONCE in the response. The DB only
 * stores a hash, so refreshing the page won't recover it — by design.
 */
export function InvitationsPanel({ rows }: InvitationsPanelProps) {
  const [issued, setIssued] = useState<ReadonlyArray<IssuedInvitation>>([]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <SendForm onIssued={setIssued} />
      <ExistingInvitations rows={rows} justIssued={issued} />
    </div>
  );
}

/* ─── Send form ────────────────────────────────────────────────────── */

function SendForm({ onIssued }: { onIssued: (issued: ReadonlyArray<IssuedInvitation>) => void }) {
  const [state, formAction, pending] = useActionState<InviteStaffState, FormData>(
    inviteStaffAction,
    {},
  );

  useEffect(() => {
    if (state.ok && state.invitations.length > 0) {
      onIssued(state.invitations);
    }
  }, [state, onIssued]);

  return (
    <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground inline-flex items-center gap-2 text-[14px] font-medium tracking-[-0.005em]">
          <MailPlusIcon className="text-brand-600 dark:text-brand-400 size-4" aria-hidden />
          Invite staff
        </h2>
        <p className="text-muted-foreground text-[12.5px] leading-relaxed">
          Paste one email per line. We&apos;ll return a claim URL for each — share it however you
          like (SMS layer lands later). Invitees still complete the full council-anchored signup.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="emails_blob">
            Emails{" "}
            <span className="text-muted-foreground font-normal">(one per line · max 100)</span>
          </Label>
          <textarea
            id="emails_blob"
            name="emails_blob"
            required
            rows={5}
            placeholder={"dr.amina.n@mulago.go.ug\nm.okello@mulago.go.ug"}
            className={cn(
              "border-border text-foreground placeholder:text-muted-foreground",
              "min-h-[120px] resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none",
              "focus-visible:ring-ring focus-visible:ring-2",
            )}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">
            Reason <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
          </Label>
          <Input
            id="reason"
            name="reason"
            required
            minLength={8}
            placeholder="e.g. New IM ward intake — Q3 cohort onboarding."
            aria-invalid={!state.ok && !!state.error}
          />
          {!state.ok && state.error ? (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {state.error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={pending}>
            <SendIcon className="size-3.5" />
            {pending ? "Sending…" : "Send invitations"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ─── Existing invitations + revoke ───────────────────────────────── */

function ExistingInvitations({
  rows,
  justIssued,
}: {
  rows: ReadonlyArray<InvitationRow>;
  justIssued: ReadonlyArray<IssuedInvitation>;
}) {
  const issuedById = new Map(justIssued.map((i) => [i.id, i]));

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border">
      <header className="border-border flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-foreground text-[14px] font-medium tracking-[-0.005em]">
          Invitations on file
        </h2>
        <span className="text-muted-foreground text-caption ml-auto font-mono tabular-nums">
          {rows.length} {rows.length === 1 ? "invitation" : "invitations"}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-body-s p-6 text-center">
          No invitations sent yet. Use the form on the left.
        </p>
      ) : (
        <ul className="divide-border/70 flex flex-col divide-y">
          {rows.map((row) => (
            <InvitationItem key={row.id} row={row} justIssued={issuedById.get(row.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitationItem({
  row,
  justIssued,
}: {
  row: InvitationRow;
  justIssued?: IssuedInvitation;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground text-body-s truncate font-medium">
            {row.name ?? row.email}
          </span>
          <span className="text-muted-foreground text-caption truncate font-mono">{row.email}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Pill tone={STATUS_TONES[row.status]}>{STATUS_LABEL[row.status]}</Pill>
          {row.source === "bulk" ? <Pill tone="neutral">bulk</Pill> : null}
        </div>
      </div>

      {justIssued ? <ClaimUrlBlock claimUrl={justIssued.claim_url} /> : null}

      <div className="text-caption flex items-center gap-3">
        <span className="text-muted-foreground font-mono tabular-nums">
          Sent {new Date(row.invitedAtIso).toLocaleDateString()}
        </span>
        <span className="text-muted-foreground font-mono tabular-nums">
          Expires {new Date(row.expiresAtIso).toLocaleDateString()}
        </span>
        {row.acceptedAtIso ? (
          <span className="font-mono text-emerald-700 tabular-nums dark:text-emerald-300">
            Accepted {new Date(row.acceptedAtIso).toLocaleDateString()}
          </span>
        ) : null}
        {row.revokedAtIso ? (
          <span className="text-muted-foreground italic" title={row.revocationReason ?? undefined}>
            Revoked
          </span>
        ) : null}
        {row.status === "pending" ? (
          <span className="ml-auto">
            <RevokeButton invitationId={row.id} email={row.email} />
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ClaimUrlBlock({ claimUrl }: { claimUrl: string }) {
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard.writeText(claimUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="border-border bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2">
      <span
        className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11.5px]"
        title={claimUrl}
      >
        {claimUrl}
      </span>
      <Button type="button" variant="secondary" size="sm" onClick={copy}>
        <ClipboardCopyIcon className="size-3" />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function RevokeButton({ invitationId, email }: { invitationId: string; email: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    revokeStaffInvitationAction,
    {},
  );
  // No useEffect cleanup — on success the server revalidates the
  // page, the row's status flips from "pending" to "revoked", and
  // the parent stops rendering this button entirely. We just guard
  // the confirm UI against a stale display if React re-runs us.

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-muted-foreground text-caption inline-flex items-center gap-1 transition-colors hover:text-amber-700 dark:hover:text-amber-300"
      >
        <RotateCcwIcon className="size-3" aria-hidden />
        Revoke
      </button>
    );
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="invitation_id" value={invitationId} />
      <input
        type="text"
        name="reason"
        required
        minLength={8}
        autoFocus
        placeholder={`Why revoking ${email}? (≥ 8 chars)`}
        className="border-border text-caption focus-visible:ring-ring w-64 max-w-full rounded-md border bg-transparent px-2 py-0.5 outline-none focus-visible:ring-2"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Revoking…" : "Confirm"}
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-muted-foreground hover:text-foreground text-caption"
      >
        Cancel
      </button>
      {!state.ok && state.error ? (
        <span role="alert" className="text-caption text-red-700 dark:text-red-300">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

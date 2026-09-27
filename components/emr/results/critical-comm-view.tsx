import type { CommDraft, CommMethod, CommRole, CommTarget, PatientIdentity } from "./model";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ChoiceChips } from "../orders/choice-chips";
import { StatusWord } from "../status-word";
import { COMM_METHODS, COMM_ROLES, commIssues } from "./model";

/**
 * The laboratory's record of a critical-result call (gate-a E.10, D-EMR-06): who was told, in
 * which role, how, and whether they read it back. The escalation time frame (REF-CRIT-TIMEFRAME)
 * is unsigned, so no clock is shown — the line says so rather than implying one.
 */
export function CriticalCommView({
  identity,
  test,
  target,
  draft,
  pending = false,
  message = null,
  onTo,
  onRole,
  onMethod,
  onReadBack,
  onSave,
}: {
  identity: PatientIdentity;
  test: string;
  target: CommTarget;
  draft: CommDraft;
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
  onTo?: (userId: string) => void;
  onRole?: (r: CommRole) => void;
  onMethod?: (m: CommMethod) => void;
  onReadBack?: (v: "yes" | "no") => void;
  onSave?: () => void;
}) {
  const issues = commIssues(draft);
  return (
    <section aria-labelledby="crit-comm" className="flex flex-col gap-4 border-t pt-5">
      <h2 id="crit-comm" className="text-heading-s font-medium">
        Record critical communication
      </h2>
      <p className="text-body-s flex flex-wrap gap-x-3">
        <span>{test}</span>
        <span className="font-medium">{identity.name}</span>
        <span className="font-mono tabular-nums">{identity.mrn}</span>
      </p>
      <label className="text-body-s flex flex-col gap-1 sm:max-w-sm">
        <span className="text-muted-foreground">Told</span>
        <select
          value={draft.toUserId}
          onChange={(e) => onTo?.(e.target.value)}
          className="border-input bg-card text-body-s focus-visible:shadow-focus min-h-11 rounded-sm border px-2 outline-none sm:min-h-9"
        >
          <option value="">Choose a clinician</option>
          {target.people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
              {p.userId === target.ordererUserId ? " (orderer)" : ""}
            </option>
          ))}
        </select>
      </label>
      <Row label="As">
        <ChoiceChips
          name="crit-role"
          label="Their role"
          options={COMM_ROLES}
          value={draft.role}
          onChange={onRole}
        />
      </Row>
      <Row label="How">
        <ChoiceChips
          name="crit-method"
          label="How they were told"
          options={COMM_METHODS}
          value={draft.method}
          onChange={onMethod}
        />
      </Row>
      <Row label="Read back">
        <ChoiceChips
          name="crit-readback"
          label="Read back"
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          value={draft.readBack}
          onChange={onReadBack}
        />
      </Row>
      <p className="text-body-s text-muted-foreground">
        Escalation to the in-charge waits for a signed time frame; none is set yet.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onSave} disabled={pending || issues.length > 0}>
          {pending ? "Saving…" : "Save call record"}
        </Button>
        <span role="status" aria-live="polite" className="text-body-s">
          {message ? (
            message.ok ? (
              message.text
            ) : (
              <StatusWord tone="caution">{message.text}</StatusWord>
            )
          ) : null}
        </span>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-body-s grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr] sm:items-center">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

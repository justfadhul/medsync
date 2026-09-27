"use client";

import type { StaffActionState } from "../actions";
import type { PendingAffiliationRow } from "../page";
import { useActionState, useEffect, useState } from "react";
import { CheckIcon, ExternalLinkIcon, FileTextIcon, MessageSquareIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import { APPROVAL } from "@/content/onboarding-staff";
import { cn } from "@/lib/utils";
import { getEvidenceSignedUrlAction } from "../../../admin/actions";
import {
  approveStaffAffiliationAction,
  rejectStaffAffiliationAction,
  requestStaffInfoAction,
} from "../actions";

/**
 * Evidence-in-panel slide-out for a pending staff_affiliations row.
 *
 * Same case-file shape as the superadmin Approvals detail. Three
 * actions (Approve / Reject / Request info), each with its own
 * reason-capture form (≥ 8 chars, audited).
 *
 * Verification section branches on cadre.is_clinical:
 *
 *   Clinical → council registration + licence document
 *              (anchor = council registry).
 *   Non-clinical → NIN-on-file flag + optional appointment letter +
 *                  optional authorising officer
 *                  (anchor = the admin's attestation here).
 *
 * Storage opens via the shared `getEvidenceSignedUrlAction`. Buckets:
 *   - clinician-licences (migration 0016)
 *   - staff-identity-documents (migration 0034)
 */

type Mode = "view" | "approve" | "reject" | "request_info";

interface SheetProps {
  item: PendingAffiliationRow | null;
  onOpenChange: (open: boolean) => void;
}

export function PendingDetailSheet({ item, onOpenChange }: SheetProps) {
  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent widthClassName="w-full sm:max-w-[600px]">
        {item ? (
          <DetailContent key={item.id} item={item} onClose={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailContent({ item, onClose }: { item: PendingAffiliationRow; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("view");
  const days = item.daysSinceSubmission;
  // DOC-1: a clinician can't be approved until the licence is here (the Edge Function refuses too).
  const waitingLicence = item.isClinical && !item.licenceDocumentPath;

  return (
    <>
      <SheetHeader className="gap-0 px-6 pt-6 pb-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Pill tone="neutral">Staff affiliation</Pill>
            <Pill tone="notice">Pending review</Pill>
            {item.reviewNote ? <Pill tone="notice">Info requested</Pill> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="text-foreground text-heading-l leading-[1.15] tracking-[-0.015em]">
              {item.fullName}
            </h2>
            <p className="text-muted-foreground text-body-s leading-snug">
              {item.roleName} · {item.departmentName}
            </p>
          </div>

          <div className="bg-ink-300 h-px w-10" aria-hidden />

          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-[11.5px]">
            <Meta label="Received" value={`${days} day${days === 1 ? "" : "s"} ago`} mono />
            <Meta label="Path" value={item.isClinical ? "Clinical" : "Non-clinical"} />
            {item.isClinical && item.councilName ? (
              <Meta label="Council" value={item.councilName} />
            ) : null}
            {item.isClinical && item.registrationNumber ? (
              <Meta label="Reg. #" value={item.registrationNumber} mono />
            ) : null}
          </dl>
        </div>
      </SheetHeader>

      <SheetBody className="px-0 py-0">
        {item.reviewNote ? (
          <Section index={1} title="Outstanding info request">
            <div className="rounded-md bg-amber-50/70 px-2.5 py-2 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-950/25">
              <p className="text-body-s leading-relaxed text-amber-900 italic dark:text-amber-200">
                &ldquo;{item.reviewNote}&rdquo;
              </p>
            </div>
          </Section>
        ) : null}

        <Section index={item.reviewNote ? 2 : 1} title="Verification">
          {item.isClinical ? (
            <Rows
              rows={[
                { label: "Full name", value: item.fullName },
                { label: "Email", value: item.email, mono: true },
                { label: "Council", value: item.councilName ?? "—" },
                {
                  label: "Registration #",
                  value: item.registrationNumber ?? "—",
                  mono: true,
                },
                ...(item.registrationExpiry
                  ? [{ label: "Expires", value: item.registrationExpiry, mono: true }]
                  : []),
              ]}
            />
          ) : (
            <Rows
              rows={[
                { label: "Full name", value: item.fullName },
                { label: "Email", value: item.email, mono: true },
                {
                  label: "National ID",
                  value: item.ninOnFile ? "On file (encrypted)" : "Not provided",
                },
                ...(item.staffNumber
                  ? [{ label: "Staff #", value: item.staffNumber, mono: true }]
                  : []),
                ...(item.authorisingOfficerName
                  ? [
                      {
                        label: "Authorising",
                        value: item.authorisingOfficerRole
                          ? `${item.authorisingOfficerName} · ${item.authorisingOfficerRole}`
                          : item.authorisingOfficerName,
                      },
                    ]
                  : []),
              ]}
            />
          )}
          {!item.isClinical ? (
            <p className="text-muted-foreground bg-brand-50/60 ring-brand-500/25 dark:bg-brand-950/25 rounded-md px-2.5 py-2 text-[11.5px] leading-relaxed italic ring-1 ring-inset">
              Non-clinical path — your approval IS the employer attestation. There is no external
              council to check. Confirm the applicant is a current employee in this role before
              approving.
            </p>
          ) : null}
          {item.isClinical && item.councilCode === "UMDPC" ? (
            <a
              href={APPROVAL.umdpcRegisterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-body-s inline-flex w-fit items-center gap-1.5 font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
            >
              {APPROVAL.checkUmdpc}
              <ExternalLinkIcon aria-hidden className="size-3" />
            </a>
          ) : null}
        </Section>

        <Section index={item.reviewNote ? 3 : 2} title="Claimed role">
          <Rows
            rows={[
              { label: "Cadre", value: item.cadreName },
              ...(item.cadreGradeName ? [{ label: "Grade", value: item.cadreGradeName }] : []),
              { label: "Role", value: item.roleName },
              { label: "Department", value: item.departmentName },
              ...(item.specialtyName
                ? [{ label: "Sub-specialty", value: item.specialtyName }]
                : []),
              {
                label: "Employment",
                value: item.employmentType.replace(/_/g, " "),
              },
            ]}
          />
        </Section>

        {item.isClinical ? (
          item.licenceDocumentPath ? (
            <Section index={item.reviewNote ? 4 : 3} title="Licence document">
              <LicenceCard
                bucket="clinician-licences"
                path={item.licenceDocumentPath}
                label="Council licence"
              />
            </Section>
          ) : (
            <Section index={item.reviewNote ? 4 : 3} title="Licence document">
              <p className="rounded-md bg-amber-50/70 px-2.5 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-950/25 dark:text-amber-200">
                {APPROVAL.noLicence}
              </p>
            </Section>
          )
        ) : (
          <Section index={item.reviewNote ? 4 : 3} title="Appointment letter">
            {item.appointmentLetterPath ? (
              <LicenceCard
                bucket="staff-identity-documents"
                path={item.appointmentLetterPath}
                label="Appointment letter"
              />
            ) : (
              <p className="text-muted-foreground rounded-md bg-amber-50/70 px-2.5 py-2 text-[12.5px] ring-1 ring-amber-500/30 ring-inset dark:bg-amber-950/25">
                None uploaded — optional, but consider requesting one if you can&rsquo;t place this
                applicant.
              </p>
            )}
          </Section>
        )}
      </SheetBody>

      <SheetFooter>
        {mode === "view" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="ghost" onClick={() => setMode("request_info")}>
              <MessageSquareIcon className="size-3.5" />
              Request info…
            </Button>
            <Button variant="secondary" onClick={() => setMode("reject")}>
              <XIcon className="size-3.5" />
              Reject…
            </Button>
            {waitingLicence ? (
              <span id="approve-blocked" className="text-muted-foreground text-body-s self-center">
                {APPROVAL.waitingLicence}
              </span>
            ) : null}
            <Button
              variant="primary"
              onClick={() => setMode("approve")}
              disabled={waitingLicence}
              aria-describedby={waitingLicence ? "approve-blocked" : undefined}
            >
              <CheckIcon className="size-3.5" />
              Approve…
            </Button>
          </>
        ) : (
          <ActionForm
            item={item}
            mode={mode}
            onCancel={() => setMode("view")}
            onSuccess={onClose}
          />
        )}
      </SheetFooter>
    </>
  );
}

/* ─── Action form ─────────────────────────────────────────────────── */

function ActionForm({
  item,
  mode,
  onCancel,
  onSuccess,
}: {
  item: PendingAffiliationRow;
  mode: "approve" | "reject" | "request_info";
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const action =
    mode === "approve"
      ? approveStaffAffiliationAction
      : mode === "reject"
        ? rejectStaffAffiliationAction
        : requestStaffInfoAction;
  const fieldName = mode === "request_info" ? "note" : "reason";
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  const labelText =
    mode === "approve"
      ? "Approval note"
      : mode === "reject"
        ? "Reason for rejection"
        : "Note to applicant";
  const placeholder =
    mode === "approve"
      ? "e.g. Licence verified against MDC registry; matches claimed cadre."
      : mode === "reject"
        ? "e.g. Registration number does not match any current MDC record."
        : "e.g. Please re-upload your council registration; the current image is unreadable.";
  const submitLabel = pending
    ? mode === "approve"
      ? "Approving…"
      : mode === "reject"
        ? "Rejecting…"
        : "Sending…"
    : mode === "approve"
      ? "Confirm approval"
      : mode === "reject"
        ? "Confirm rejection"
        : "Send request";

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="affiliation_id" value={item.id} />

      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor={fieldName}>
          {labelText}{" "}
          <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
        </Label>
        <Input
          id={fieldName}
          name={fieldName}
          required
          minLength={8}
          autoFocus
          placeholder={placeholder}
          aria-invalid={!!state.error}
        />
        {state.error ? (
          <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
      </div>

      {mode === "approve" && item.isClinical ? (
        <div className="flex flex-col gap-1.5 text-left">
          <Label htmlFor="licence_valid_until">
            {APPROVAL.validUntil}{" "}
            <span className="text-muted-foreground font-normal">{APPROVAL.validUntilHint}</span>
          </Label>
          <Input
            id="licence_valid_until"
            name="licence_valid_until"
            type="date"
            className="w-fit"
          />
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={mode === "approve" ? "primary" : "secondary"}
          disabled={pending}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ─── Licence card ────────────────────────────────────────────────── */

function LicenceCard({
  bucket,
  path,
  label,
}: {
  bucket: "clinician-licences" | "staff-identity-documents";
  path: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(getEvidenceSignedUrlAction, {
    ok: false as const,
    error: "",
  });

  useEffect(() => {
    if (state.ok && state.url) {
      window.open(state.url, "_blank", "noopener,noreferrer");
    }
  }, [state]);

  const ext = path.split(".").pop()?.toUpperCase() ?? "";
  const kind =
    ext === "PDF" ? "PDF" : ext === "JPG" || ext === "JPEG" || ext === "PNG" ? "IMG" : "DOC";

  return (
    <form
      action={formAction}
      className="border-border bg-card hover:border-border/80 hover:bg-muted/30 group flex items-center gap-3 rounded-md border p-3 transition-colors"
    >
      <input type="hidden" name="bucket" value={bucket} />
      <input type="hidden" name="path" value={path} />
      <div className="bg-slate-tint text-slate-icon ring-slate-edge flex size-9 shrink-0 items-center justify-center rounded ring-1">
        <FileTextIcon className="size-4" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-body-s truncate font-medium">{label}</span>
          <span className="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-px font-mono text-[9.5px] tracking-wide tabular-nums">
            {kind}
          </span>
        </div>
        <span
          className="text-muted-foreground truncate font-mono text-[10.5px] leading-tight"
          title={`${bucket} · ${path}`}
        >
          {bucket} · {path}
        </span>
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        <ExternalLinkIcon className="size-3" />
        {pending ? "Opening…" : "Open"}
      </Button>
    </form>
  );
}

/* ─── Layout primitives ────────────────────────────────────────────── */

function Section({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border/70 flex flex-col gap-3 px-6 py-5 [&:not(:first-child)]:border-t">
      <header className="flex items-baseline gap-3">
        <span className="text-muted-foreground/70 font-mono text-[10px] tracking-[0.1em] tabular-nums">
          {index.toString().padStart(2, "0")}
        </span>
        <h3 className="text-foreground text-[12.5px] font-medium tracking-[-0.005em]">{title}</h3>
        <span
          aria-hidden
          className="from-border/80 ml-2 h-px flex-1 bg-gradient-to-r to-transparent"
        />
      </header>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: ReadonlyArray<{ label: string; value: string; mono?: boolean }> }) {
  return (
    <dl className="flex flex-col">
      {rows.map((row, i) => (
        <div
          key={i}
          className="border-border/40 grid grid-cols-[140px_1fr] gap-x-5 border-l-2 border-l-transparent py-2 pl-2.5 sm:py-1.5 [&:not(:first-child)]:border-t"
        >
          <dt className="text-muted-foreground self-baseline text-[11.5px] font-medium">
            {row.label}
          </dt>
          <dd
            className={cn(
              "text-foreground text-body-s self-baseline leading-relaxed wrap-break-word",
              row.mono && "font-mono text-[12.5px] tabular-nums",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className={cn("text-foreground", mono && "font-mono tabular-nums")}>{value}</dd>
    </div>
  );
}

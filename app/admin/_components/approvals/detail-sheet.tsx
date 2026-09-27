"use client";

import type { ReviewState, SignedUrlState } from "../../actions";
import type { ApprovalEvidence, ApprovalItem } from "./types";
import { useActionState, useEffect, useState } from "react";
import { AlertTriangleIcon, CheckIcon, ExternalLinkIcon, FileTextIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  approveHospitalApplicationAction,
  approveStaffAffiliationAction,
  getEvidenceSignedUrlAction,
  rejectHospitalApplicationAction,
  rejectStaffAffiliationAction,
} from "../../actions";

/**
 * Right-anchored case-file panel for an approval item.
 *
 * Layout:
 *   - Hero: kind + status chips, big Fraunces name, supporting line,
 *     compact meta strip (submitted relative + application id), with a
 *     1px teal hairline accent — the recurring landing-page motif.
 *   - Sections: numbered "01 / Institution" headers with a hairline rule.
 *     Each evidence row is a label/value pair; tone-coded rows get a 2px
 *     left bar so warnings/critical/ok read at a glance.
 *   - Documents: per-doc cards with a file-type chip, label, and mono path.
 *   - Footer: Approve / Reject flips to an inline reason form (≥ 8 chars,
 *     enforced server-side).
 *
 * The Sheet wraps a content component keyed on item id so picking a
 * different row fully remounts and resets local state (no useEffect
 * reset hooks needed).
 */

interface SheetProps {
  item: ApprovalItem | null;
  onOpenChange: (open: boolean) => void;
}

type Mode = "view" | "approve" | "reject";

export function ApprovalDetailSheet({ item, onOpenChange }: SheetProps) {
  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent widthClassName="w-full sm:max-w-[600px]">
        {item ? (
          <ApprovalDetailContent
            key={`${item.kind}-${item.id}`}
            item={item}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ApprovalDetailContent({ item, onClose }: { item: ApprovalItem; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("view");
  const isHospital = item.kind === "hospital";

  return (
    <>
      <SheetHeader className="gap-0 px-6 pt-6 pb-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Pill tone={isHospital ? "admitted" : "neutral"}>
              {isHospital ? "Hospital application" : "Staff affiliation"}
            </Pill>
            <Pill tone="notice">Pending review</Pill>
            {item.flagged ? (
              <Pill tone="notice">
                <AlertTriangleIcon className="mr-0.5 -ml-0.5 size-3" aria-hidden />
                Flag
              </Pill>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="text-foreground text-heading-l leading-[1.15] tracking-[-0.015em]">
              {item.title}
            </h2>
            <p className="text-muted-foreground text-body-s leading-snug">{item.subtitle}</p>
          </div>

          {/* Hairline teal accent — the recurring motif from the landing surface. */}
          <div className="bg-ink-300 h-px w-10" aria-hidden />

          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-[11.5px]">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
                Received
              </dt>
              <dd className="text-foreground font-mono tabular-nums">
                {formatRelative(item.createdAtIso)}
              </dd>
            </div>
            <div className="flex min-w-0 items-baseline gap-1.5">
              <dt className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
                ID
              </dt>
              <dd className="text-muted-foreground truncate font-mono tabular-nums" title={item.id}>
                {item.id.slice(0, 8)}…
              </dd>
            </div>
          </dl>
        </div>
      </SheetHeader>

      <SheetBody className="px-0 py-0">
        <EvidenceGrouped evidence={item.evidence} />

        {item.documents && item.documents.length > 0 ? (
          <SectionBlock index={countSections(item.evidence) + 1} title="Documents">
            <div className="flex flex-col gap-2.5">
              {item.documents.map((doc, i) => (
                <EvidenceDocCard key={i} label={doc.label} bucket={doc.bucket} path={doc.path} />
              ))}
            </div>
          </SectionBlock>
        ) : null}
      </SheetBody>

      <SheetFooter>
        {mode === "view" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" onClick={() => setMode("reject")}>
              <XIcon className="size-3.5" />
              Reject…
            </Button>
            {item.approveBlocked && item.kind === "hospital" ? (
              <span className="text-body-s text-muted-foreground self-center">
                {item.approveBlocked}
              </span>
            ) : item.approveBlocked ? (
              <Button variant="primary" disabled>
                {item.approveBlocked}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setMode("approve")}>
                <CheckIcon className="size-3.5" />
                {item.approveLabel ?? "Approve"}…
              </Button>
            )}
          </>
        ) : (
          <ReasonForm
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

/* ────────────────────────────────────────────────────────────────── */

function ReasonForm({
  item,
  mode,
  onCancel,
  onSuccess,
}: {
  item: ApprovalItem;
  mode: "approve" | "reject";
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const action = pickAction(item.kind, mode);
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(action, {});

  // onSuccess is a parent callback, so calling it from an effect is the
  // canonical "react to async result" pattern with useActionState.
  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="id" value={item.id} />

      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor="reason">
          {mode === "approve" ? "Approval note" : "Reason for rejection"}{" "}
          <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
        </Label>
        <Input
          id="reason"
          name="reason"
          required
          minLength={8}
          autoFocus
          placeholder={
            mode === "approve"
              ? "e.g. Licence verified against MDC registry."
              : "e.g. Registration number does not match a current MDC record."
          }
          aria-invalid={!!state.error}
        />
        {state.error ? (
          <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={mode === "reject" ? "secondary" : "primary"}
          disabled={pending}
        >
          {pending
            ? mode === "approve"
              ? "Approving…"
              : "Rejecting…"
            : mode === "approve"
              ? (item.approveLabel ?? "Confirm approval")
              : "Confirm rejection"}
        </Button>
      </div>
    </form>
  );
}

function pickAction(kind: ApprovalItem["kind"], mode: "approve" | "reject") {
  if (kind === "staff") {
    return mode === "approve" ? approveStaffAffiliationAction : rejectStaffAffiliationAction;
  }
  return mode === "approve" ? approveHospitalApplicationAction : rejectHospitalApplicationAction;
}

/* ────────────────────────────────────────────────────────────────── */

/**
 * Renders the evidence rows grouped by their `section` field with
 * numbered section headers. Rows without a section render in an
 * "Overview" block at the top.
 */
function EvidenceGrouped({ evidence }: { evidence: ReadonlyArray<ApprovalEvidence> }) {
  const ungrouped = evidence.filter((e) => !e.section);
  const sectionOrder: string[] = [];
  const grouped = new Map<string, ApprovalEvidence[]>();
  for (const row of evidence) {
    if (!row.section) continue;
    if (!grouped.has(row.section)) {
      grouped.set(row.section, []);
      sectionOrder.push(row.section);
    }
    grouped.get(row.section)!.push(row);
  }

  let index = 0;
  return (
    <div className="flex flex-col">
      {ungrouped.length > 0 ? (
        <SectionBlock index={++index} title="Overview">
          <EvidenceList rows={ungrouped} />
        </SectionBlock>
      ) : null}
      {sectionOrder.map((name) => (
        <SectionBlock key={name} index={++index} title={name}>
          <EvidenceList rows={grouped.get(name)!} />
        </SectionBlock>
      ))}
    </div>
  );
}

function countSections(evidence: ReadonlyArray<ApprovalEvidence>): number {
  const seen = new Set<string>();
  let count = evidence.some((e) => !e.section) ? 1 : 0;
  for (const row of evidence) {
    if (row.section && !seen.has(row.section)) {
      seen.add(row.section);
      count++;
    }
  }
  return count;
}

function SectionBlock({
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
          className="from-border/80 ml-2 h-px flex-1 bg-gradient-to-r to-transparent"
          aria-hidden
        />
      </header>
      {children}
    </section>
  );
}

function EvidenceList({ rows }: { rows: ReadonlyArray<ApprovalEvidence> }) {
  return (
    <dl className="flex flex-col">
      {rows.map((row, i) => (
        <EvidenceRow key={i} row={row} />
      ))}
    </dl>
  );
}

function EvidenceRow({ row }: { row: ApprovalEvidence }) {
  // Tone treatment: tinted fill + inset ring (never a coloured left
  // bar — standing project rule) so the row reads as "needs attention"
  // without relying on text color alone.
  const toneFill =
    row.tone === "critical"
      ? "bg-red-50/60 ring-1 ring-red-500/25 ring-inset dark:bg-red-950/20"
      : row.tone === "warning"
        ? "bg-amber-50/60 ring-1 ring-amber-500/25 ring-inset dark:bg-amber-950/20"
        : row.tone === "ok"
          ? "bg-emerald-50/50 ring-1 ring-emerald-500/20 ring-inset dark:bg-emerald-950/20"
          : null;

  return (
    <div
      className={cn(
        "border-border/40 grid grid-cols-[140px_1fr] gap-x-5 rounded-sm py-2 pl-2.5 not-first:border-t sm:py-1.5",
        toneFill,
      )}
    >
      <dt className="text-muted-foreground self-baseline text-[11.5px] font-medium">{row.label}</dt>
      <dd
        className={cn(
          "text-foreground text-body-s self-baseline leading-relaxed wrap-break-word",
          row.mono && "font-mono text-[12.5px] tabular-nums",
          row.tone === "warning" && "text-amber-800 dark:text-amber-200",
          row.tone === "critical" && "text-red-800 dark:text-red-200",
          row.tone === "ok" && "text-emerald-800 dark:text-emerald-200",
        )}
      >
        {row.value}
      </dd>
    </div>
  );
}

/**
 * Per-document card. Lazily fetches a short-lived signed URL on click
 * so the link never appears in server-rendered HTML. The file-type chip
 * is inferred from the path extension; falls back to "DOC".
 */
function EvidenceDocCard({
  label,
  bucket,
  path,
}: {
  label?: string;
  bucket: "clinician-licences" | "hospital-authorisations";
  path: string;
}) {
  const [state, formAction, pending] = useActionState<SignedUrlState, FormData>(
    getEvidenceSignedUrlAction,
    { ok: false, error: "" },
  );

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
          <span className="text-foreground text-body-s truncate font-medium">
            {label ?? "Supporting document"}
          </span>
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

/* ────────────────────────────────────────────────────────────────── */

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day} day${day === 1 ? "" : "s"} ago`;
  const wk = Math.round(day / 7);
  if (wk < 8) return `${wk} wk ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

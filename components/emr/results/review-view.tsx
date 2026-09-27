import type { AckAction, AckDraft, ReviewItem, StaffOption } from "./model";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unitWords } from "@/lib/emr/unit-words";
import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { formatters } from "../format";
import { ChoiceChips } from "../orders/choice-chips";
import { ResultValueText, StatusWord } from "../status-word";
import { ACK_ACTIONS, ackIssues, reviewWords } from "./model";

/**
 * Results to review (gate-a E.10, D-EMR-07). Critical first. Each row carries two identifiers with
 * age and sex, the test, every value with the laboratory's own flag as text, and its state in
 * amber words ("Awaiting acknowledgement", "Amended — acknowledge again"). Only a value the saved
 * report marks MedSync-critical takes the critical style — the row and its state stay amber.
 * Acknowledge one row, or select several and acknowledge them together.
 */

export interface ReviewHandlers {
  onSelect?: (reportId: string, on: boolean) => void;
  onSelectAll?: (on: boolean) => void;
  onQuick?: (reportId: string, action: Exclude<AckAction, "forwarded">) => void;
  onAction?: (a: AckAction) => void;
  onNote?: (t: string) => void;
  onForwardTo?: (userId: string) => void;
  onAcknowledge?: () => void;
}

const CONCLUSION_WORDS: Record<string, string> = {
  normal: "Normal",
  abnormal: "Abnormal",
  indeterminate: "Indeterminate",
};

export function ReviewView({
  items,
  selected,
  draft,
  staff,
  timeZone,
  pending = false,
  message = null,
  ...on
}: {
  items: readonly ReviewItem[];
  selected: ReadonlySet<string>;
  draft: AckDraft;
  staff: readonly StaffOption[];
  timeZone?: string;
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
} & ReviewHandlers) {
  const f = formatters(timeZone);
  if (items.length === 0)
    return (
      <EmptyState>
        No results waiting for your review. Released results on orders you placed or cover arrive
        here.
      </EmptyState>
    );
  const issues = ackIssues(draft, selected.size);
  const all = items.every((i) => selected.has(i.reportId));
  return (
    <div className="flex flex-col gap-5">
      <div className="border-border flex flex-col gap-3 border-b pb-4">
        <label className="text-body-s has-[:focus-visible]:shadow-focus inline-flex min-h-11 items-center gap-3 rounded-md sm:min-h-8">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => on.onSelectAll?.(e.target.checked)}
            className="size-5 accent-teal-600"
          />
          Select all {items.length}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <ChoiceChips
            name="ack-action"
            label="Acknowledge as"
            options={ACK_ACTIONS}
            value={draft.action}
            onChange={on.onAction}
          />
          {draft.action === "forwarded" ? (
            <select
              aria-label="Forward to"
              value={draft.forwardedToUserId}
              onChange={(e) => on.onForwardTo?.(e.target.value)}
              className="border-input bg-card text-body-s focus-visible:shadow-focus min-h-11 rounded-sm border px-2 outline-none sm:min-h-9"
            >
              <option value="">Forward to…</option>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Note (optional)"
            placeholder="Note (optional)"
            value={draft.note}
            maxLength={1000}
            onChange={(e) => on.onNote?.(e.target.value)}
            className="min-h-11 max-w-md sm:min-h-9"
          />
          <Button
            type="button"
            onClick={on.onAcknowledge}
            disabled={pending || issues.length > 0}
            className="min-h-11 sm:min-h-9"
          >
            {pending
              ? "Acknowledging…"
              : selected.size === 0
                ? "Acknowledge selected"
                : `Acknowledge ${selected.size} ${selected.size === 1 ? "result" : "results"}`}
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
      </div>

      <ul className="divide-border flex flex-col divide-y">
        {items.map((i) => (
          <li
            key={i.reportId}
            data-critical={i.critical || undefined}
            className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:gap-4"
          >
            <input
              type="checkbox"
              aria-label={`Select ${i.test} for ${i.identity.name}`}
              checked={selected.has(i.reportId)}
              onChange={(e) => on.onSelect?.(i.reportId, e.target.checked)}
              className="size-5 shrink-0 accent-teal-600 sm:mt-1"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-body-s flex flex-wrap gap-x-3">
                <span className="font-medium">{i.identity.name}</span>
                <span className="text-muted-foreground font-mono tabular-nums">
                  {i.identity.mrn}
                </span>
                {i.identity.ageSex.split(" · ").map((p) => (
                  <span key={p} className="text-muted-foreground">
                    {p}
                  </span>
                ))}
              </p>
              <p className="text-body-s flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{i.test}</span>
                {i.restricted ? <RestrictedMark /> : null}
                <StatusWord tone="caution">{reviewWords(i)}</StatusWord>
                <span className="text-muted-foreground">
                  Released{" "}
                  <span className="font-mono tabular-nums">{f.dateTime(i.releasedAtIso)}</span>
                </span>
              </p>
              {i.values.length ? (
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[minmax(8rem,auto)_1fr]">
                  {i.values.map((v) => (
                    <div key={v.key} className="contents">
                      <dt className="text-body-s text-muted-foreground">{v.display}</dt>
                      <dd className="text-body-s flex flex-wrap items-baseline gap-x-3">
                        <span className="inline-flex items-baseline gap-1">
                          <ResultValueText critical={v.critical}>{v.valueText}</ResultValueText>
                          {v.unit ? (
                            <span className="text-caption text-muted-foreground">
                              {unitWords(v.unit)}
                            </span>
                          ) : null}
                        </span>
                        {v.flagText ? <span>{v.flagText}</span> : null}
                        {v.uncatalogued ? (
                          <span className="text-caption text-muted-foreground">
                            Not read by decision support
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {i.conclusion ? (
                <p className="text-body-s flex flex-col gap-1">
                  <span>
                    Conclusion: {CONCLUSION_WORDS[i.conclusion.code] ?? i.conclusion.code}
                  </span>
                  {i.conclusion.text ? (
                    <span className="max-w-[72ch] whitespace-pre-line">{i.conclusion.text}</span>
                  ) : null}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => on.onQuick?.(i.reportId, "seen")}
                  className="min-h-11 sm:min-h-8"
                >
                  Seen
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => on.onQuick?.(i.reportId, "acted")}
                  className="min-h-11 sm:min-h-8"
                >
                  Acted
                </Button>
                <Link
                  href={`/doctor/patients/${i.patientUserId}#chart-results`}
                  className="text-body-s tap inline-flex min-h-11 items-center font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
                >
                  Open chart
                </Link>
                {i.encounterId ? (
                  <Link
                    href={`/doctor/encounters/${i.encounterId}`}
                    className="text-body-s tap inline-flex min-h-11 items-center font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
                  >
                    Open visit
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

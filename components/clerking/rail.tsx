import type { VitalRow, VitalsView } from "./model";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { formatters } from "@/components/emr/format";
import type { BpScheme, VitalClass } from "@/lib/clerking/vital-classification";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { RestrictedMark } from "@/components/emr/chips";
import { StatusWord } from "@/components/emr/status-word";
import { Button } from "@/components/ui/button";
import { BP_SCHEMES, DEFAULT_BP_SCHEME } from "@/lib/clerking/vital-classification";
import { cn } from "@/lib/utils";
import { Segmented } from "./controls";

/**
 * The left rail (§5.1): what the record already holds, shown and never copied. Vital signs carry
 * NEWS2 from the triage engine (C6): the chip, a message for any parameter scoring 3, a score per
 * row, an arrow on a reading scoring 3, the amber prompts for what is missing, and "Record a new
 * set" (Examination). Red appears only on a NEWS2 score of 3 and its value (Law 8), always with the
 * number and words for a screen reader; 1–2 is amber. Beside NEWS2, each reading carries its
 * standard classification in words (lib/clerking/vital-classification, draft awaiting the CSO):
 * amber when abnormal, red only for the emergencies the data file marks critical.
 */

/** The doctor's blood-pressure scheme, kept per browser (never in the record). In memory too, so a
 *  blocked localStorage (private window) still honours the switch this session. */
const BP_KEY = "medsync.clerking.bpScheme";
const bpListeners = new Set<() => void>();
let bpMemo: BpScheme | null = null;
function bpScheme(): BpScheme {
  if (bpMemo) return bpMemo;
  try {
    const saved = window.localStorage.getItem(BP_KEY);
    if (BP_SCHEMES.some((x) => x.id === saved)) return saved as BpScheme;
  } catch {
    // Blocked storage: the default stands.
  }
  return DEFAULT_BP_SCHEME;
}
function setBpScheme(s: BpScheme) {
  bpMemo = s;
  try {
    window.localStorage.setItem(BP_KEY, s);
  } catch {
    // Per-browser convenience only: the in-memory value stands.
  }
  bpListeners.forEach((l) => l());
}
const subscribeBp = (l: () => void) => {
  bpListeners.add(l);
  return () => bpListeners.delete(l);
};
export function useBpScheme(): [BpScheme, (s: BpScheme) => void] {
  return [useSyncExternalStore(subscribeBp, bpScheme, () => DEFAULT_BP_SCHEME), setBpScheme];
}

const CLS_TONE = { normal: "neutral", caution: "caution", critical: "critical" } as const;
const Cls = ({ c }: { c: VitalClass }) => (
  <StatusWord tone={CLS_TONE[c.tone]} className="px-1.5 py-0">
    <span title={c.scheme}>{c.label}</span>
  </StatusWord>
);

/** The only red in this file besides a critical classification: a reading that scores 3 in NEWS2. */
const SCORE3 = "bg-status-critical-bg text-red-700 dark:text-status-critical-fg";
const SCORE3_TEXT = "text-red-700 dark:text-status-critical-fg";
const SCORE12 = "bg-status-caution-bg text-amber-800 dark:text-status-caution-fg";
const AMBER_TEXT = "text-amber-800 dark:text-status-caution-fg";

function Block({ title, at, children }: { title: string; at?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-border flex flex-col gap-2 border-b px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-label text-foreground">{title}</h2>
        {at}
      </div>
      {children}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="text-body-s text-muted-foreground">{children}</p>
);

/** One line of names; a restricted item keeps its lock (Law 10). */
function InlineList({
  items,
}: {
  items: readonly { id: string; display: string; restricted: boolean }[];
}) {
  return (
    <p className="text-body-s text-foreground flex flex-wrap gap-x-2">
      {items.map((x, i) => (
        <span key={x.id} className="inline-flex items-center gap-1">
          {`${x.display}${i < items.length - 1 ? "," : ""}`}
          {x.restricted ? <RestrictedMark /> : null}
        </span>
      ))}
    </p>
  );
}

/** What the reading was before this one, in grey beside it, as the triage pop-up shows it. */
function Trend({ t }: { t: NonNullable<VitalRow["trend"]> }) {
  return (
    <span data-slot="vital-trend" className="text-caption text-muted-foreground whitespace-nowrap">
      {`was ${t.was}`}
    </span>
  );
}

function Row({ r, children }: { r: VitalRow; children?: ReactNode }) {
  const three = r.points === 3;
  const Arrow = r.arrow === "low" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <li className="border-border/60 flex flex-col border-b py-1 last:border-b-0">
      <div className="flex min-h-[22px] items-center gap-1.5">
        <span className="text-body-s text-muted-foreground min-w-0 flex-1">{r.label}</span>
        {r.arrow ? (
          <>
            <Arrow aria-hidden className={cn("size-3 shrink-0", SCORE3_TEXT)} />
            <span className="sr-only">{r.arrow}</span>
          </>
        ) : null}
        {r.value === null ? (
          <span className={cn("text-body-s font-medium whitespace-nowrap", AMBER_TEXT)}>
            Not recorded
          </span>
        ) : (
          <span
            className={cn(
              "text-body-s font-mono whitespace-nowrap tabular-nums",
              three ? cn("font-semibold", SCORE3_TEXT) : "text-foreground",
            )}
          >
            {r.value}
            {r.unit ? (
              <span className="text-caption text-muted-foreground font-sans">{` ${r.unit}`}</span>
            ) : null}
          </span>
        )}
        {r.points ? (
          <span
            title={`NEWS2 score ${r.points}`}
            className={cn(
              "text-caption inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs px-1 font-mono font-semibold",
              three ? SCORE3 : SCORE12,
            )}
          >
            <span className="sr-only">NEWS2 score </span>
            {r.points}
          </span>
        ) : (
          <span aria-hidden className="w-[18px] shrink-0" />
        )}
      </div>
      {r.cls || r.note || r.trend ? (
        <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
          {r.cls ? <Cls c={r.cls} /> : null}
          {r.note ? (
            <span
              className={cn("text-caption", r.note.caution ? AMBER_TEXT : "text-muted-foreground")}
            >
              {r.note.text}
            </span>
          ) : null}
          {r.trend ? <Trend t={r.trend} /> : null}
        </span>
      ) : null}
      {children}
    </li>
  );
}

export function ClerkingRail({
  p,
  fmt,
  vitals,
  body = [],
  bp,
  alarm,
  onRecord,
}: {
  p: DeskPayload;
  fmt: ReturnType<typeof formatters>;
  /** null: no reading on record. */
  vitals: VitalsView | null;
  /** Weight, height, BMI and waist from the chart (model.bodyRows). */
  body?: VitalRow[];
  /** The blood-pressure scheme switch (useBpScheme); absent, no switch. */
  bp?: { scheme: BpScheme; onScheme: (s: BpScheme) => void };
  /** A signed vital-sign flag fired (the chip turns amber). */
  alarm: boolean;
  onRecord?: () => void;
}) {
  const c = p.context;
  const k = p.clerking;
  const results = [
    c.pendingOrders.length ? `${c.pendingOrders.length} ordered, not yet resulted` : null,
    c.results.length
      ? `${c.results.length} ${c.results.length === 1 ? "result" : "results"}`
      : null,
  ].filter((x): x is string => !!x);
  return (
    <div data-slot="clerking-rail" className="flex flex-col">
      <Block
        title="Triage"
        at={
          c.triage ? (
            <span className="text-caption text-muted-foreground font-mono tabular-nums">
              {fmt.time(c.triage.at)}
            </span>
          ) : undefined
        }
      >
        {c.triage ? (
          <>
            <p className="text-body-s text-foreground inline-flex flex-wrap items-center gap-x-2">
              <StatusWord tone="neutral">{`Level ${c.triage.level}`}</StatusWord>
              <span className="text-muted-foreground">{c.triage.levelWord}</span>
            </p>
            {c.triage.complaint ? <p className="text-body-s">{c.triage.complaint}</p> : null}
          </>
        ) : (
          <Quiet>No triage record for this visit.</Quiet>
        )}
      </Block>

      <Block
        title="Vital signs"
        at={
          k?.vitalsAt ? (
            <span className="text-caption text-muted-foreground font-mono tabular-nums">
              {`${fmt.time(k.vitalsAt)}${k.vitalsFromTriage ? ", triage" : ""}`}
            </span>
          ) : undefined
        }
      >
        {vitals ? (
          <>
            <p>
              <StatusWord tone={alarm ? "caution" : "neutral"}>{vitals.chip}</StatusWord>
            </p>
            {vitals.message ? (
              <p className={cn("text-body-s font-medium", AMBER_TEXT)}>{vitals.message}</p>
            ) : null}
            <ul aria-label="Vital signs with NEWS2 scores" className="flex flex-col">
              {vitals.rows.map((r) => (
                <Row key={r.key} r={r}>
                  {r.key === "systolic_bp" && r.cls && bp ? (
                    <span className="flex justify-end pt-1">
                      <Segmented
                        label="Blood pressure classification"
                        options={BP_SCHEMES}
                        value={bp.scheme}
                        onPick={bp.onScheme}
                      />
                    </span>
                  ) : null}
                </Row>
              ))}
            </ul>
            {vitals.missing ? (
              <p className="text-caption text-muted-foreground">{vitals.missing}</p>
            ) : null}
          </>
        ) : (
          <Quiet>No vital signs recorded.</Quiet>
        )}
        {body.length ? (
          <ul aria-label="Body measurements" className="flex flex-col">
            {body.map((r) => (
              <Row key={r.key} r={r} />
            ))}
          </ul>
        ) : null}
        {onRecord ? (
          <Button variant="secondary" size="sm" className="w-fit" onClick={onRecord}>
            Record a new set
          </Button>
        ) : null}
      </Block>

      <Block title="Results">
        {results.length ? (
          <p className="text-body-s text-foreground flex flex-wrap gap-x-2">
            {results.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </p>
        ) : (
          <Quiet>No results or pending orders.</Quiet>
        )}
      </Block>

      <Block title="Medicines">
        {c.medicines.length ? (
          <InlineList items={c.medicines} />
        ) : (
          <Quiet>No current medicines on record.</Quiet>
        )}
      </Block>

      <Block title="Problems">
        {c.problems.length ? <InlineList items={c.problems} /> : <Quiet>No active problems.</Quiet>}
      </Block>
    </div>
  );
}

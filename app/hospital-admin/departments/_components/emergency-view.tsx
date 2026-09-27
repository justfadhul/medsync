"use client";

import type { CapabilityKey } from "@/supabase/functions/_shared/services-hub";
import Link from "next/link";
import { useState } from "react";
import { CheckIcon } from "lucide-react";

import { SectionNumber } from "@/components/medsync/section-number";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CAPABILITY_KEYS, CAPABILITY_SECTIONS } from "@/supabase/functions/_shared/services-hub";
import {
  Amber,
  ConfirmBlock,
  ErrorLine,
  fmtDate,
  inputClass,
  Select,
  useHub,
  YesNo,
} from "./hub-ui";

interface Cap {
  key: string;
  value: unknown;
  pendingValue: unknown;
  pending: { byName: string; at: string; mine: boolean } | null;
  verified: { byName: string; at: string } | null;
  derived: boolean;
}

/** A value as a sentence a person reads. */
function show(k: CapabilityKey, v: unknown): string {
  if (v === null || v === undefined || v === "") return "Not set";
  switch (k.value.type) {
    case "yesno":
      return v ? "Yes" : "No";
    case "choice":
      return k.value.options.find((o) => o.code === v)?.label ?? String(v);
    case "multi":
      return (
        (v as string[])
          .map(
            (c) =>
              (k.value as { options: readonly { code: string; label: string }[] }).options.find(
                (o) => o.code === c,
              )?.label ?? c,
          )
          .join(", ") || "None"
      );
    case "pre_alert": {
      const p = v as { enabled: boolean; owner: string | null };
      return p.enabled ? `Yes — board owner: ${p.owner ?? "—"}` : "No";
    }
    default:
      return String(v);
  }
}

export function EmergencyView({ caps }: { caps: Cap[] }) {
  const sections = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const pendingCount = caps.filter((c) => c.pending && !c.pending.mine).length;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-body-s max-w-3xl">
        Values marked <span className="text-foreground font-medium">Emergency routing</span> decide
        where an emergency goes. A change to one waits until another admin verifies it; until then
        MedSync keeps signposting with the last verified value.
        {pendingCount ? (
          <span className="ml-1">
            <Amber>
              {pendingCount} change{pendingCount === 1 ? "" : "s"} waiting for you to verify
            </Amber>
          </span>
        ) : null}
      </p>
      {sections.map((n) => {
        const keys = CAPABILITY_KEYS.filter((k) => k.section === n);
        return (
          <section
            key={n}
            aria-labelledby={`cap-${n}`}
            className="border-border bg-card rounded-lg border"
          >
            <header className="border-border flex items-center gap-3 border-b px-4 py-3">
              <SectionNumber n={n} />
              <h2 id={`cap-${n}`} className="text-foreground text-body-m font-medium">
                {CAPABILITY_SECTIONS[n]}
              </h2>
            </header>
            <ul className="divide-border divide-y">
              {keys.map((k) => (
                <CapRow key={k.key} k={k} cap={caps.find((c) => c.key === k.key)!} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-muted-foreground text-caption">
        Designating isolation or treatment units for outbreaks is the Ministry&apos;s decision; this
        page shows isolation beds only.
      </p>
    </div>
  );
}

function CapRow({ k, cap }: { k: CapabilityKey; cap: Cap }) {
  const hub = useHub();
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1 sm:w-64">
        <span className="text-foreground text-body-s font-medium">{k.label}</span>
        {k.routing ? (
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
            Emergency routing
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {k.derived ? (
          <p className="text-body-s">
            <span className="text-foreground font-mono tabular-nums">{String(cap.value ?? 0)}</span>{" "}
            <Link
              href="/hospital-admin/departments/wards"
              className="text-muted-foreground text-caption hover:underline"
            >
              from Wards &amp; beds
            </Link>
          </p>
        ) : editing ? (
          <Editor
            k={k}
            initial={cap.pending ? cap.pendingValue : cap.value}
            pending={hub.pending}
            onCancel={() => setEditing(false)}
            onSave={(value) =>
              hub.run({ op: "set_capability", key: k.key, value }, () => setEditing(false))
            }
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-body-s",
                cap.value === null || cap.value === undefined
                  ? "text-muted-foreground"
                  : "text-foreground",
              )}
            >
              {show(k, cap.value)}
            </span>
            <Button
              variant="link"
              size="sm"
              className="text-teal-700"
              onClick={() => setEditing(true)}
            >
              Change
            </Button>
          </div>
        )}
        <ErrorLine error={hub.error} />
        {k.routing && !k.derived ? <Verification k={k} cap={cap} hub={hub} /> : null}
      </div>
    </li>
  );
}

function Verification({
  k,
  cap,
  hub,
}: {
  k: CapabilityKey;
  cap: Cap;
  hub: ReturnType<typeof useHub>;
}) {
  if (cap.pending) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-2.5 dark:bg-amber-950/20">
        <p className="text-body-s flex flex-wrap items-center gap-2">
          <Amber>Change pending · needs a second admin</Amber>
          <span className="text-muted-foreground">
            {cap.pending.byName} proposed{" "}
            <span className="text-foreground">{show(k, cap.pendingValue)}</span> ·{" "}
            {fmtDate(cap.pending.at)}
          </span>
        </p>
        {cap.pending.mine ? (
          <p className="text-muted-foreground text-caption">
            You made this change, so another admin verifies it.
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <Button
              size="sm"
              disabled={hub.pending}
              onClick={() => hub.run({ op: "verify_capability", key: k.key })}
            >
              <CheckIcon aria-hidden /> Verify
            </Button>
            <ConfirmBlock
              verb="Reject"
              pending={hub.pending}
              consequence={<>The proposed value is dropped; the verified one stays.</>}
              onConfirm={(reason) => hub.run({ op: "reject_capability", key: k.key, reason })}
            />
          </div>
        )}
      </div>
    );
  }
  if (cap.verified) {
    return (
      <p className="text-muted-foreground text-caption">
        Verified by {cap.verified.byName} · {fmtDate(cap.verified.at)}
      </p>
    );
  }
  return cap.value === null || cap.value === undefined || cap.value === "" ? null : (
    <Amber className="self-start">Unverified</Amber>
  );
}

function Editor({
  k,
  initial,
  pending,
  onSave,
  onCancel,
}: {
  k: CapabilityKey;
  initial: unknown;
  pending: boolean;
  onSave: (v: unknown) => void;
  onCancel: () => void;
}) {
  const t = k.value;
  const [v, setV] = useState<unknown>(
    initial ??
      (t.type === "pre_alert" ? { enabled: false, owner: "" } : t.type === "multi" ? [] : null),
  );
  let input: React.ReactNode = null;
  if (t.type === "yesno")
    input = <YesNo name={k.label} value={(v as boolean | null) ?? null} onChange={setV} />;
  else if (t.type === "count")
    input = (
      <input
        className={cn(inputClass, "w-32 font-mono")}
        inputMode="numeric"
        value={v === null ? "" : String(v)}
        onChange={(e) =>
          setV(e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")))
        }
        aria-label={k.label}
      />
    );
  else if (t.type === "choice")
    input = (
      <Select
        aria-label={k.label}
        className="w-64"
        value={(v as string) ?? ""}
        onChange={(x) => setV(x || null)}
        placeholder="Choose"
        options={t.options.map((o) => ({ value: o.code, label: o.label }))}
      />
    );
  else if (t.type === "multi")
    input = (
      <div className="flex flex-wrap gap-3">
        {t.options.map((o) => {
          const on = ((v as string[]) ?? []).includes(o.code);
          return (
            <label key={o.code} className="text-body-s flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-teal-700"
                checked={on}
                onChange={() =>
                  setV(
                    on
                      ? (v as string[]).filter((c) => c !== o.code)
                      : [...((v as string[]) ?? []), o.code],
                  )
                }
              />
              {o.label}
            </label>
          );
        })}
      </div>
    );
  else if (t.type === "phone")
    input = (
      <input
        className={cn(inputClass, "w-56 font-mono")}
        inputMode="tel"
        placeholder="0772 123 456"
        value={(v as string) ?? ""}
        onChange={(e) => setV(e.target.value)}
        aria-label={k.label}
      />
    );
  else if (t.type === "text")
    input = (
      <div className="flex flex-col gap-1">
        <textarea
          className={cn(inputClass, "min-h-16")}
          maxLength={t.max}
          value={(v as string) ?? ""}
          onChange={(e) => setV(e.target.value)}
          aria-label={k.label}
        />
        <span className="text-muted-foreground text-caption">
          {((v as string) ?? "").length}/{t.max} — it goes out by SMS
        </span>
      </div>
    );
  else if (t.type === "pre_alert") {
    const p = v as { enabled: boolean; owner: string };
    input = (
      <div className="flex flex-col gap-2">
        <YesNo name={k.label} value={p.enabled} onChange={(enabled) => setV({ ...p, enabled })} />
        {p.enabled ? (
          <input
            className={cn(inputClass, "w-72")}
            placeholder="Who owns the Incoming board each shift"
            value={p.owner ?? ""}
            maxLength={240}
            onChange={(e) => setV({ ...p, owner: e.target.value })}
            aria-label="Board owner per shift"
          />
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {input}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => onSave(v)}>
          {pending ? "Saving…" : k.routing ? "Propose change" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {k.routing ? (
        <p className="text-muted-foreground text-caption">
          Another admin verifies this before it reaches emergency directions.
        </p>
      ) : null}
    </div>
  );
}

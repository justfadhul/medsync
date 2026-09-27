"use client";

import type { AckDraft, ReviewItem, StaffOption } from "./model";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { acknowledgeResults } from "@/lib/emr/actions/results";
import { ackBatches } from "./model";
import { ReviewView } from "./review-view";

/**
 * The review island: selection, the batch action and one acknowledgeResults call per patient
 * (the action takes one patient). A row's Seen / Acted acknowledges that row alone. The outcome is
 * said in a polite live region, then the list refreshes without the acknowledged rows.
 */
export function ReviewList({
  items,
  staff,
  surface,
  timeZone,
}: {
  items: readonly ReviewItem[];
  staff: readonly StaffOption[];
  surface: "doctor" | "clinician";
  timeZone?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<AckDraft>({ action: "seen", note: "", forwardedToUserId: "" });

  const run = (ids: ReadonlySet<string>, d: AckDraft) =>
    start(async () => {
      const batches = ackBatches(items, ids, d, crypto.randomUUID());
      let done = 0;
      for (const b of batches) {
        const r = await acknowledgeResults({ surface, ...b });
        if (!r.ok) {
          setMessage({ ok: false, text: done ? `${done} acknowledged. ${r.error}` : r.error });
          router.refresh();
          return;
        }
        done += b.items.length;
      }
      setMessage({
        ok: true,
        text: done === 1 ? "Result acknowledged." : `${done} results acknowledged.`,
      });
      setSelected(new Set());
      router.refresh();
    });

  return (
    <ReviewView
      items={items}
      selected={selected}
      draft={draft}
      staff={staff}
      timeZone={timeZone}
      pending={pending}
      message={message}
      onSelect={(id, on) =>
        setSelected((s) => {
          const n = new Set(s);
          if (on) n.add(id);
          else n.delete(id);
          return n;
        })
      }
      onSelectAll={(on) => setSelected(on ? new Set(items.map((i) => i.reportId)) : new Set())}
      onQuick={(id, action) => run(new Set([id]), { action, note: "", forwardedToUserId: "" })}
      onAction={(action) => setDraft((d) => ({ ...d, action }))}
      onNote={(note) => setDraft((d) => ({ ...d, note }))}
      onForwardTo={(forwardedToUserId) => setDraft((d) => ({ ...d, forwardedToUserId }))}
      onAcknowledge={() => run(selected, draft)}
    />
  );
}

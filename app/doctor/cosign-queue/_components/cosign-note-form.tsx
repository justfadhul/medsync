"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cosignNote } from "@/lib/emr/actions/notes";

/**
 * A note co-signature from the review queue (EMR v1, D-EMR-03). The note is read on its visit —
 * where an addendum can also be added before co-signing — and co-signed here or there. The
 * decision writes the note event and answers the request in one transaction
 * (lib/emr/write/notes.ts cosignNote), so the queue and the note never disagree.
 */
export function CosignNoteForm({
  patientUserId,
  noteId,
  encounterId,
}: {
  patientUserId: string;
  noteId: string;
  encounterId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () =>
    start(async () => {
      const r = await cosignNote({
        surface: "doctor",
        patientUserId,
        noteId,
        clientKey: crypto.randomUUID(),
        ...(note.trim() ? { reviewNote: note.trim() } : {}),
      });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setMessage({ ok: true, text: "Note co-signed." });
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="Review note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Review note (optional)"
        className="border-input bg-background text-body-s focus-visible:shadow-focus resize-none rounded-md border px-3 py-2 outline-none"
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span role="status" aria-live="polite" className="text-body-s mr-auto">
          {message?.text}
        </span>
        <Link
          href={`/doctor/encounters/${encounterId}`}
          className="text-body-s tap inline-flex min-h-11 items-center font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
        >
          Read the note
        </Link>
        <Button type="button" size="sm" onClick={run} disabled={pending}>
          {pending ? "Co-signing…" : "Co-sign note"}
        </Button>
      </div>
    </div>
  );
}

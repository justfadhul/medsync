"use client";

import type { DocumentKind } from "@/lib/onboarding/documents";
import { useId, useRef, useState } from "react";
import { CameraIcon, UploadIcon } from "lucide-react";

import {
  attachDocumentAction,
  createDocumentUploadAction,
} from "@/app/onboarding/_actions/documents";
import { DOCUMENTS } from "@/content/onboarding";
import { DOCUMENT_MAX_BYTES } from "@/lib/onboarding/documents";
import { cn } from "@/lib/utils";

// ── On-device image re-encode (E5): long edge ≤ 1600 px, JPEG. Also strips EXIF, GPS tags included. ──
const LONG_EDGE = 1600;
export async function prepareFile(
  file: File,
): Promise<{ blob: Blob; name: string } | { error: string }> {
  if (file.type === "application/pdf") {
    return file.size > DOCUMENT_MAX_BYTES
      ? { error: DOCUMENTS.tooBig }
      : { blob: file, name: file.name };
  }
  if (!file.type.startsWith("image/")) return { error: DOCUMENTS.wrongType };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob) return { error: DOCUMENTS.wrongType };
    return blob.size > DOCUMENT_MAX_BYTES
      ? { error: DOCUMENTS.tooBig }
      : { blob, name: file.name.replace(/\.\w+$/, ".jpg") };
  } catch {
    return { error: DOCUMENTS.wrongType };
  }
}

/** Straight to private storage with a server-minted signed URL, then attach (DOC-4). */
export async function uploadDocument(kind: DocumentKind, blob: Blob): Promise<boolean> {
  const ticket = await createDocumentUploadAction({ kind, type: blob.type });
  if (!ticket.ok) return false;
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", blob);
  const res = await fetch(ticket.signedUrl, {
    method: "PUT",
    body,
    headers: { "x-upsert": "false", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
  }).catch(() => null);
  if (!res?.ok) return false;
  return (await attachDocumentAction({ kind, path: ticket.path })).ok;
}

export const kb = (n: number) =>
  n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} kB`;

export function Picker({
  inputId,
  onPick,
  error,
  describedBy,
}: {
  inputId: string;
  onPick: (f: File) => void;
  error?: string;
  describedBy?: string;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onPick(f);
  };
  const btn =
    "tap text-body-m inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 font-medium text-foreground hover:border-gray-300";
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-dashed p-3",
        error
          ? "border-amber-600 bg-amber-50/40 dark:bg-amber-950/20"
          : "border-gray-300 dark:border-gray-600",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          id={inputId}
          type="button"
          className={btn}
          onClick={() => camera.current?.click()}
          aria-describedby={describedBy}
        >
          <CameraIcon aria-hidden className="size-4" /> {DOCUMENTS.takePhoto}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => file.current?.click()}
          aria-describedby={describedBy}
        >
          <UploadIcon aria-hidden className="size-4" /> {DOCUMENTS.uploadFile}
        </button>
      </div>
      <p className="text-body-s text-muted-foreground text-center">{DOCUMENTS.types}</p>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={take}
        aria-hidden
      />
      <input
        ref={file}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        onChange={take}
        aria-hidden
      />
    </div>
  );
}

/** A "Still needed" document on a pending page: pick, and it uploads straight away. */
export function DocumentUploadNow({ kind, onDone }: { kind: DocumentKind; onDone: () => void }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  async function pick(f: File) {
    setProblem(null);
    const r = await prepareFile(f);
    if ("error" in r) return setProblem(r.error);
    setState("busy");
    const ok = await uploadDocument(kind, r.blob);
    setState(ok ? "idle" : "failed");
    if (ok) onDone();
  }
  return (
    <div className="flex flex-col gap-2">
      {state === "busy" ? (
        <p className="text-body-s text-muted-foreground" role="status">
          {DOCUMENTS.uploading("your document")}
        </p>
      ) : (
        <Picker inputId={id} onPick={pick} error={problem ?? undefined} describedBy={`${id}-p`} />
      )}
      {problem || state === "failed" ? (
        <p id={`${id}-p`} className="text-body-s text-amber-800 dark:text-amber-300" role="alert">
          {problem ?? DOCUMENTS.failed}
        </p>
      ) : null}
    </div>
  );
}

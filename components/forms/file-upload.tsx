"use client";

import { useId, useRef, useState } from "react";
import { FileIcon, UploadCloudIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Drop-zone file upload.
 *
 * Used in GATE D for clinician license docs and in GATE E for hospital
 * registration evidence. Renders a labelled drop zone with click-to-pick
 * fallback (mobile camera capture wired via `capture="environment"` so
 * users can photograph their licence directly), a list of selected
 * files, and per-file remove buttons.
 *
 * What the surrounding action MUST do:
 *   1. Stream the upload to Supabase Storage (private bucket).
 *   2. Encrypt at rest is provided by Storage; the document key
 *      itself can be stored plaintext in the relevant table row.
 *   3. Run virus scan async (kickoff §A.6) — block lifecycle
 *      transition until scan returns clean.
 *   4. Re-validate MIME + size server-side; never trust client.
 *
 * Client-side guards here are UX-only: a friendly type/size hint so
 * users don't waste their data plan uploading the wrong thing.
 */
export interface FileUploadProps {
  name: string;
  /** Comma-separated accept list (e.g. "application/pdf,image/jpeg"). */
  accept?: string;
  /** Max single-file size in megabytes. UX-only — server enforces too. */
  maxMb?: number;
  /** Allow multiple files in one slot. Default false. */
  multiple?: boolean;
  /** Mobile camera affordance (back-facing). Useful for licence photos. */
  capture?: "user" | "environment";
  /** Short helper line under the drop zone (e.g. "PDF or photo, ≤ 5MB"). */
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** Called whenever selected files change (after client-side filtering). */
  onFilesChange?: (files: File[]) => void;
}

export function FileUpload({
  name,
  accept = "application/pdf,image/jpeg,image/png",
  maxMb = 5,
  multiple = false,
  capture,
  hint,
  required,
  disabled,
  invalid,
  className,
  onFilesChange,
}: FileUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isOver, setIsOver] = useState(false);
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);

  function applyClientFilters(picked: FileList | File[] | null): File[] {
    if (!picked) return [];
    const arr = Array.from(picked);
    const allowedTypes = accept.split(",").map((t) => t.trim());
    const limit = maxMb * 1024 * 1024;
    const next: File[] = [];
    for (const f of arr) {
      if (allowedTypes.length > 0 && !allowedTypes.some((t) => matchesAccept(f, t))) {
        setRejectedReason(`Skipped ${f.name}: file type not allowed.`);
        continue;
      }
      if (f.size > limit) {
        setRejectedReason(`Skipped ${f.name}: over ${maxMb}MB.`);
        continue;
      }
      next.push(f);
    }
    return next;
  }

  function commit(next: File[]) {
    setFiles(next);
    onFilesChange?.(next);
    if (inputRef.current) {
      const dt = new DataTransfer();
      next.forEach((f) => dt.items.add(f));
      inputRef.current.files = dt.files;
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setRejectedReason(null);
    const filtered = applyClientFilters(e.target.files);
    commit(multiple ? [...files, ...filtered] : filtered.slice(0, 1));
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsOver(false);
    if (disabled) return;
    setRejectedReason(null);
    const filtered = applyClientFilters(e.dataTransfer?.files ?? null);
    commit(multiple ? [...files, ...filtered] : filtered.slice(0, 1));
  }

  function removeAt(idx: number) {
    commit(files.filter((_, i) => i !== idx));
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={onDrop}
        className={cn(
          "border-input bg-card text-muted-foreground flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-5 py-7 text-center",
          "ease-expo-out transition-all duration-150",
          "hover:border-teal-300 hover:bg-teal-50/30 dark:hover:bg-teal-50/5",
          isOver && "border-teal-500 bg-teal-50/40 dark:bg-teal-50/10",
          invalid && "border-destructive bg-alert-bg",
          disabled && "pointer-events-none cursor-not-allowed opacity-50",
        )}
      >
        <UploadCloudIcon className="size-5" strokeWidth={1.5} />
        <span className="text-foreground text-[13px] font-medium">
          Tap to upload or drop a file
        </span>
        {hint ? <span className="text-[11.5px]">{hint}</span> : null}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          capture={capture}
          required={required && files.length === 0}
          disabled={disabled}
          onChange={onPick}
          className="sr-only"
        />
      </label>

      {files.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="border-input bg-card flex items-center gap-3 rounded-sm border px-3 py-2"
            >
              <FileIcon className="text-muted-foreground size-3.5" strokeWidth={2} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-foreground truncate text-[13px]">{f.name}</span>
                <span className="text-muted-foreground text-[11px]">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${f.name}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-7 items-center justify-center rounded-sm"
              >
                <XIcon className="size-3.5" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {rejectedReason ? (
        <span className="text-destructive text-[11.5px]">{rejectedReason}</span>
      ) : null}
    </div>
  );
}

function matchesAccept(file: File, pattern: string): boolean {
  if (!pattern) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return file.type.startsWith(prefix);
  }
  return file.type === pattern;
}

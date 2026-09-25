"use client";

import type { DocumentKind } from "@/lib/onboarding/documents";
import { createContext, useContext, useState } from "react";
import { FileTextIcon } from "lucide-react";
import { useController, useFormContext } from "react-hook-form";

import { DOCUMENTS } from "@/content/onboarding";
import { cn } from "@/lib/utils";
import { kb, Picker, prepareFile } from "./document-upload";
import { FieldError } from "./fields";
import { fieldId, revealClass } from "./styles";

/** The form's chosen files, held until the account exists (never in the draft, never in the post). */
export const DocumentsContext = createContext<Map<DocumentKind, Blob> | null>(null);

/**
 * A document inside a v2 form (§5.7): pick now (compressed on the phone), or "Add it later". The
 * form value is "file" | "later"; the file itself waits in DocumentsContext until the account exists.
 */
export function DocumentField({
  name,
  kind,
  label,
  laterText,
}: {
  name: string;
  kind: DocumentKind;
  label: string;
  laterText: string;
}) {
  const docs = useContext(DocumentsContext)!;
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const [chosen, setChosen] = useState<{ name: string; size: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = fieldId(name);
  const errId = `${id}-error`;

  async function pick(f: File) {
    setProblem(null);
    const r = await prepareFile(f);
    if ("error" in r) return setProblem(r.error);
    docs.set(kind, r.blob);
    setChosen({ name: r.name, size: r.blob.size });
    field.onChange("file");
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field={name}>
      <span className="text-body-s text-foreground font-medium">{label}</span>
      {field.value === "later" ? (
        <p
          className={cn(
            "text-body-s text-muted-foreground rounded-md bg-gray-50 px-3 py-2.5 dark:bg-gray-900",
            revealClass,
          )}
        >
          {laterText}{" "}
          <button
            type="button"
            className="font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
            onClick={() => field.onChange(undefined)}
          >
            {DOCUMENTS.addNow}
          </button>
        </p>
      ) : chosen && field.value === "file" ? (
        <div
          className={cn(
            "border-input flex items-center gap-3 rounded-md border px-3 py-2.5",
            revealClass,
          )}
        >
          <FileTextIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <span className="text-body-m min-w-0 flex-1 truncate">{chosen.name}</span>
          <span className="text-body-s text-muted-foreground tabular-nums">{kb(chosen.size)}</span>
          <button
            type="button"
            className="text-body-s text-muted-foreground hover:text-foreground font-medium underline underline-offset-4"
            onClick={() => {
              docs.delete(kind);
              setChosen(null);
              field.onChange(undefined);
            }}
          >
            {DOCUMENTS.remove}
          </button>
        </div>
      ) : (
        <>
          <Picker inputId={id} onPick={pick} error={problem ?? undefined} describedBy={errId} />
          <button
            type="button"
            className="text-body-s self-start font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
            onClick={() => {
              docs.delete(kind);
              field.onChange("later");
            }}
          >
            {DOCUMENTS.addLater}
          </button>
        </>
      )}
      {problem ? (
        <p id={errId} className="text-body-s text-amber-800 dark:text-amber-300">
          {problem}
        </p>
      ) : (
        <FieldError name={name} />
      )}
    </div>
  );
}

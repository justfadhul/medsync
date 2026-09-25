"use client";

import type { DetailsState } from "../actions";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { AvatarUpload } from "@/components/forms/avatar-upload";
import { DocumentUploadNow } from "@/components/onboarding/document-upload";
import { inputClass } from "@/components/onboarding/styles";
import { Button } from "@/components/ui/button";
import { KIT, PENDING } from "@/content/onboarding";
import { STAFF_PENDING } from "@/content/onboarding-staff";
import { cn } from "@/lib/utils";
import { saveMyGradeAction, updateMyPhotoAction } from "../actions";

/** "Still needed": the licence uploads straight away, then the page re-reads what's on file. */
export function LicenceNow() {
  const router = useRouter();
  return <DocumentUploadNow kind="licence" onDone={() => router.refresh()} />;
}

function Feedback({ state, saved }: { state: DetailsState; saved: string }) {
  return state.error ? (
    <p
      role="alert"
      className="text-body-s flex items-start gap-1.5 text-amber-800 dark:text-amber-300"
    >
      <TriangleAlertIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" strokeWidth={2} />
      {state.error}
    </p>
  ) : (
    <span aria-live="polite" className="text-body-s text-muted-foreground">
      {state.ok ? saved : ""}
    </span>
  );
}

export function PhotoForm({
  currentUrl,
  personName,
}: {
  currentUrl: string | null;
  personName: string | null;
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(updateMyPhotoAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <AvatarUpload
        name="photo"
        currentUrl={currentUrl}
        personName={personName}
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" className="min-h-11" disabled={pending}>
          {pending ? STAFF_PENDING.photoSaving : STAFF_PENDING.photoSave}
        </Button>
        <Feedback state={state} saved={STAFF_PENDING.photoSaved} />
      </div>
    </form>
  );
}

/** Optional qualification — only for cadres whose grade doesn't change scope (PROFILE_GRADES). */
export function GradeForm({
  options,
  current,
}: {
  options: readonly { code: string; label: string }[];
  current: string | null;
}) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(saveMyGradeAction, {});
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <label htmlFor="grade" className="text-body-s text-foreground font-medium">
        {PENDING.grade} <span className="text-muted-foreground font-normal">{KIT.optional}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <select
          id="grade"
          name="grade"
          defaultValue={current ?? ""}
          disabled={pending}
          className={cn(inputClass, "w-auto min-w-48 pr-8")}
        >
          <option value="">{STAFF_PENDING.gradeNone}</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" className="min-h-11" disabled={pending}>
          {pending ? STAFF_PENDING.gradeSaving : STAFF_PENDING.gradeSave}
        </Button>
        <Feedback state={state} saved={PENDING.gradeSaved} />
      </div>
    </form>
  );
}

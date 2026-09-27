"use client";

import type { ProfileUpdateState } from "../actions";
import { useActionState } from "react";

import { PhoneInput } from "@/components/forms";
import { BottomActionBar, BottomActionBarSpacer } from "@/components/responsive/bottom-action-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { updatePatientProfileAction } from "../actions";

const NOK_OPTIONS = [
  { value: "", label: "Choose a relationship" },
  { value: "spouse", label: "Spouse" },
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Sibling" },
  { value: "guardian", label: "Guardian" },
  { value: "friend", label: "Friend" },
  { value: "other", label: "Other" },
];

const LANGUAGE_SUGGESTIONS = [
  "English",
  "Luganda",
  "Swahili",
  "Runyankole",
  "Lusoga",
  "Acholi",
  "Lugbara",
];

/** One label treatment on this screen, matching the read-only identity
 *  fields beside it. `Label` ships `text-caption`; `cn` resolves the pair. */
const LABEL = "text-overline uppercase";

/** The two free-text controls the design system has no primitive for. Kept
 *  verbatim in shape from `Input` — same padding, radius, surface and focus —
 *  so a textarea and a select don't read as two more field languages.
 *  `shadow-focus` is the system's 2px ring; both it and `brand-500` hold in
 *  dark on their own, so no `dark:` override to fight the ramp flip. */
const CONTROL =
  "border-input bg-card text-foreground text-body-s ease-expo-out rounded-sm border px-2.5 py-2 transition-all duration-150 outline-none placeholder:text-gray-400 focus-visible:border-ring focus-visible:shadow-focus";

export interface ProfileDefaults {
  phone: string;
  villageAddress: string | null;
  preferredLanguage: string | null;
  knownConditions: string[];
  nokName: string | null;
  nokRelationship: string | null;
  nokPhone: string | null;
}

export function ProfileForm({
  defaults,
  className,
}: {
  defaults: ProfileDefaults;
  className?: string;
}) {
  const [state, formAction] = useActionState<ProfileUpdateState, FormData>(
    updatePatientProfileAction,
    {} as ProfileUpdateState,
  );

  return (
    <form action={formAction} className={cn("flex flex-col gap-4", className)}>
      <section className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs">
        <h2 className="text-foreground text-heading-s">Contact</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone" className={LABEL}>
            Phone
          </Label>
          <PhoneInput id="phone" name="phone" defaultValue={defaults.phone} required mobileOnly />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="village_address" className={LABEL}>
            Village / address (optional)
          </Label>
          <Input
            id="village_address"
            name="village_address"
            defaultValue={defaults.villageAddress ?? ""}
            placeholder="Where you live"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="preferred_language" className={LABEL}>
            Preferred language (optional)
          </Label>
          <Input
            id="preferred_language"
            name="preferred_language"
            defaultValue={defaults.preferredLanguage ?? ""}
            placeholder="English, Luganda…"
            list="language-suggestions"
          />
          <datalist id="language-suggestions">
            {LANGUAGE_SUGGESTIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
      </section>

      <section className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs">
        <h2 className="text-foreground text-heading-s">Health</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="known_conditions" className={LABEL}>
            Known conditions (optional)
          </Label>
          <textarea
            id="known_conditions"
            name="known_conditions"
            rows={3}
            defaultValue={defaults.knownConditions.join(", ")}
            placeholder="Diabetes, Hypertension, Asthma…"
            className={cn(CONTROL, "resize-none leading-relaxed")}
          />
          <p className="text-muted-foreground text-body-s leading-relaxed">
            Comma-separated. We use this to suggest what to log on the Track tab.
          </p>
        </div>
      </section>

      <section className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs">
        <h2 className="text-foreground text-heading-s">Next of kin</h2>
        <p className="text-muted-foreground text-body-s leading-relaxed">
          Someone to contact in an emergency. Both name and phone, or leave the whole section blank.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nok_name" className={LABEL}>
            Name
          </Label>
          <Input
            id="nok_name"
            name="nok_name"
            defaultValue={defaults.nokName ?? ""}
            placeholder="Their full name"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nok_relationship" className={LABEL}>
              Relationship
            </Label>
            <select
              id="nok_relationship"
              name="nok_relationship"
              defaultValue={defaults.nokRelationship ?? ""}
              className={CONTROL}
            >
              {NOK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nok_phone" className={LABEL}>
              Phone
            </Label>
            <PhoneInput id="nok_phone" name="nok_phone" defaultValue={defaults.nokPhone ?? ""} />
          </div>
        </div>
      </section>

      {/* Save sits in the pinned bar rather than under three long sections,
          so it is reachable from anywhere in the form on a phone. The bar is
          inside the <form>, so the submit still belongs to it. */}
      <BottomActionBar>
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center md:gap-3">
          {/* The "Saved." live region stays mounted whatever happens, so a
              failed save followed by a good one still announces. */}
          <div className="min-w-0 md:flex-1">
            {state.error ? (
              <p role="alert" className="text-destructive text-body-s ncd-reveal">
                {state.error}
              </p>
            ) : null}
            <span aria-live="polite" className="text-muted-foreground text-body-s">
              {state.ok ? "Saved." : ""}
            </span>
          </div>
          <Button type="submit" size="lg" className="w-full rounded-full md:w-auto">
            Save changes
          </Button>
        </div>
      </BottomActionBar>
      <BottomActionBarSpacer />
    </form>
  );
}

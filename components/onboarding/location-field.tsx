"use client";

import type { PlaceOption } from "@/lib/onboarding/types";
import { useCallback, useEffect, useState } from "react";
import { LocateFixedIcon } from "lucide-react";
import { useController, useFormContext } from "react-hook-form";

import {
  getPlaceAction,
  resolvePlaceAction,
  searchPlacesAction,
} from "@/app/signup/_actions/lookup";
import { LOCATION } from "@/content/onboarding";
import districts from "@/data/geo/uganda-districts.json";
import { cn } from "@/lib/utils";
import { FieldError, fieldId, TextField, useFieldError } from "./fields";
import { ChosenCard, SearchField } from "./search-field";

/*
 * The location field (§5.5, ADR 0121): one search over sub-counties and districts, or "Use my
 * location" — asked only on tap, resolved on our own server, never kept (LOC-7). The region is
 * shown, never chosen (LOC-1). The district list ships with the page, so a district can be picked
 * offline (LOC-8).
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const LOCAL: PlaceOption[] = (districts as [string, string, string][]).map(
  ([code, name, region]) => {
    const label = name === "Kampala" ? "Kampala" : `${name} District`;
    return { code, name: label, label, path: `${region} region`, level: "district", region };
  },
);
const localSearch = (q: string) => {
  const n = norm(q)
    .replace(/\bdistrict\b/, "")
    .trim();
  return n.length < 2 ? [] : LOCAL.filter((p) => norm(p.name).startsWith(n)).slice(0, 8);
};

type Note = { tone: "info" | "warn"; text: string } | null;

export function LocationField({
  name = "place",
  label = LOCATION.label,
  village,
  districtOnly,
  noLocate,
}: {
  name?: string;
  label?: string;
  /** Show "Village or cell (optional)" once a place is chosen. */
  village?: string;
  districtOnly?: boolean;
  /** Search only: at the desk, "my location" is the clinic's, not the patient's home (ADR 0475). */
  noLocate?: boolean;
}) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const error = useFieldError(name);
  const [chosen, setChosen] = useState<PlaceOption | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [locating, setLocating] = useState(false);
  const [online, setOnline] = useState(true);
  const id = fieldId(name);

  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  // A restored draft holds only the code — fetch its label once.
  useEffect(() => {
    if (field.value && !chosen) void getPlaceAction(field.value).then((p) => p && setChosen(p));
  }, [field.value, chosen]);

  const search = useCallback(
    async (q: string) => {
      if (districtOnly || !navigator.onLine) return localSearch(q);
      try {
        return await searchPlacesAction(q);
      } catch {
        return localSearch(q);
      }
    },
    [districtOnly],
  );

  const pick = (p: PlaceOption, n: Note = null) => {
    setChosen(p);
    setNote(n);
    field.onChange(p.code);
    field.onBlur();
  };

  const useLocation = () => {
    if (!("geolocation" in navigator)) return setNote({ tone: "warn", text: LOCATION.denied });
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const r = await resolvePlaceAction({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }).catch(() => ({ ok: false as const, reason: "busy" as const }));
        setLocating(false);
        if (r.ok)
          pick(r.place, {
            tone: r.precision === "district" ? "warn" : "info",
            text:
              r.precision === "district"
                ? LOCATION.districtOnly
                : LOCATION.found(Math.round(pos.coords.accuracy)),
          });
        else {
          setNote({ tone: "warn", text: LOCATION[r.reason] });
          document.getElementById(id)?.focus();
        }
      },
      () => {
        setLocating(false);
        setNote({ tone: "warn", text: LOCATION.denied });
        document.getElementById(id)?.focus();
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-field={name}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {chosen || districtOnly ? (
          <label htmlFor={id} className="text-body-s text-foreground font-medium">
            {label}
          </label>
        ) : null}
        {chosen ? (
          <ChosenCard
            onChange={() => {
              setChosen(null);
              setNote(null);
              field.onChange("");
            }}
          >
            <p className="text-body-m text-foreground font-medium">{chosen.label}</p>
            <p className="text-body-s text-muted-foreground">
              {chosen.level === "district" ? chosen.path : `${chosen.region} region`}
            </p>
          </ChosenCard>
        ) : (
          <>
            {!districtOnly ? (
              <div className="flex flex-col gap-1">
                {noLocate ? null : (
                  <>
                    <button
                      type="button"
                      onClick={useLocation}
                      disabled={locating || !online}
                      className="tap text-body-m inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-md border border-teal-600 px-4 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/40"
                    >
                      <LocateFixedIcon aria-hidden className="size-4" />
                      {locating ? LOCATION.locating : LOCATION.useMyLocation}
                    </button>
                    <p className="text-body-s text-muted-foreground">{LOCATION.useHint}</p>
                    <p
                      aria-hidden
                      className="text-body-s text-muted-foreground mt-3 flex items-center gap-3 before:h-px before:w-6 before:bg-gray-200 after:h-px after:flex-1 after:bg-gray-200 dark:before:bg-gray-700 dark:after:bg-gray-700"
                    >
                      {LOCATION.or}
                    </p>
                  </>
                )}
                <label htmlFor={id} className="text-body-s text-foreground mt-2 font-medium">
                  {LOCATION.searchLabel}
                </label>
              </div>
            ) : null}
            <SearchField<PlaceOption>
              id={id}
              placeholder={LOCATION.placeholder}
              search={search}
              optionKey={(o) => o.code}
              optionText={(o) => `${o.name}, ${o.path}`}
              renderOption={(o) => (
                <span className="flex flex-col">
                  <span className="text-body-m text-foreground">{o.name}</span>
                  <span className="text-body-s text-muted-foreground">{o.path}</span>
                </span>
              )}
              onSelect={(o) => pick(o)}
              describedBy={error ? `${id}-error` : undefined}
              invalid={!!error}
            />
          </>
        )}
        {note ? (
          <p
            role="status"
            className={cn(
              "text-body-s",
              note.tone === "warn" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground",
            )}
          >
            {note.text}
          </p>
        ) : null}
        {!online && !chosen ? (
          <p className="text-body-s text-muted-foreground">{LOCATION.offline}</p>
        ) : null}
        <FieldError name={name} />
      </div>
      {village && chosen ? (
        <TextField
          name={village}
          label={LOCATION.village}
          hint={LOCATION.villageHint}
          optional
          autoCapitalize="words"
          maxLength={200}
        />
      ) : null}
    </div>
  );
}

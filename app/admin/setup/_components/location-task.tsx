"use client";

import type { StepState } from "../_lib/rules";
import { useState, useTransition } from "react";
import { MapPinIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SETUP } from "@/content/onboarding";
import { CHECKLIST } from "@/content/onboarding-setup";
import { setFacilityLocationAction } from "../checklist-actions";
import { formatDay, FormStatus } from "./ui";

const L = CHECKLIST.location;

/**
 * Facility location (§5.10): this device's position, taken at the facility. The server keeps it
 * only when it is within 200 m and inside the facility's district. No map (out of scope).
 */
export function LocationTask({
  hospitalId,
  saved,
}: {
  hospitalId: string;
  saved: { accuracyM: number; atIso: string | null } | null;
}) {
  const [state, setState] = useState<StepState & { accuracyM?: number }>({});
  const [locating, setLocating] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = locating || pending;

  function locate() {
    if (!("geolocation" in navigator)) return setState({ error: L.unsupported });
    setState({});
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        startTransition(async () => {
          setState(
            await setFacilityLocationAction({
              hospitalId,
              lat: coords.latitude,
              lng: coords.longitude,
              accuracyM: coords.accuracy,
            }),
          );
        });
      },
      (err) => {
        setLocating(false);
        setState({ error: err.code === err.PERMISSION_DENIED ? L.denied : L.unavailable });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-s text-muted-foreground">{SETUP.locationLead}</p>
      {saved && !state.ok ? (
        <p className="text-body-s text-foreground">
          {saved.atIso
            ? L.savedOn(saved.accuracyM, formatDay(saved.atIso))
            : SETUP.locationSaved(saved.accuracyM)}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="min-h-11"
          onClick={locate}
          disabled={busy}
        >
          <MapPinIcon aria-hidden className="size-4" />
          {busy ? L.locating : SETUP.locationUse}
        </Button>
      </div>
      <FormStatus
        state={state}
        okText={state.accuracyM !== undefined ? SETUP.locationSaved(state.accuracyM) : undefined}
      />
    </div>
  );
}

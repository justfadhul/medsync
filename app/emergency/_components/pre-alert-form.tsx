"use client";

import type { PreArrivalInput } from "../actions";
import type { LatLng } from "@/lib/emergency/nearest";
import type { PreAlertFacility } from "@/lib/emergency/queries";
import type { EtaBand, TransportMode } from "@/supabase/functions/_shared/pre-arrival";
import type { SubmissionAudience, Tier } from "@/supabase/functions/_shared/symptom-catalog/types";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BabyIcon,
  BandageIcon,
  BoneIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleDotIcon,
  DropletIcon,
  EyeIcon,
  GaugeIcon,
  HandIcon,
  HeartIcon,
  MapPinIcon,
  MicIcon,
  PhoneIcon,
  ThermometerIcon,
  WindIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orderFacilities } from "@/lib/emergency/nearest";
import { readPendingCatalogDraft } from "@/lib/patient/pending-symptoms";
import { cn } from "@/lib/utils";
import {
  composeFacilitySms,
  ETA_BAND_LABEL,
  ETA_BANDS,
  TRANSPORT_MODES,
} from "@/supabase/functions/_shared/pre-arrival";
import { smsHref as smsLink, telHref, writeStoredPreArrival } from "../_lib/client";
import { createPreArrivalAction } from "../actions";

/**
 * E2 — the pre-alert form (PRD MS-PRD-SYM-001 §8.3; ADR 0098 rulings 6, 9),
 * rendered on the ONE Emergency page beside the numbers. Every field is
 * pre-filled so Send is one tap once a hospital is chosen. "What's
 * happening" is the tile grid from E1 (the danger-sign strip plus the next
 * emergency items) with a select for the rest. Nearest is computed
 * HERE from the cached facility list — a location leaves the phone only on
 * the explicit per-alert toggle, and only for a facility that runs its own
 * ambulance. Offline or unreachable: the alert queues, resends when the
 * connection returns, and the SMS fallback is offered meanwhile. 403
 * `call_only` and 429 `rate_limited` keep the call button up (§8.7).
 * The Send button is the file's only red.
 */
export interface EItem {
  key: string;
  label: string;
  stroke: boolean;
  isolation: boolean;
}

/** A "What's happening" tile: the strip's items plus the next emergency items, with an icon. */
export interface Tile {
  key: string;
  label: string;
  icon: string;
}

/** PRD §8.3 defaults — tests/emergency/web-pathway pins these. */
export const E2_DEFAULTS = {
  what: "Not sure",
  onset: "now",
  transport: "boda",
  eta: "15_30",
  shareLocation: false,
} as const;

type Who = "me" | "child" | "other";
type ChildBand = Extract<SubmissionAudience, `child_${string}`>;
type Onset = "now" | "hour" | "hours" | "day";

const ONSET: { key: Onset; label: string; agoMs: number }[] = [
  { key: "now", label: "Just now", agoMs: 0 },
  { key: "hour", label: "Less than an hour ago", agoMs: 30 * 60_000 },
  { key: "hours", label: "A few hours ago", agoMs: 3 * 3_600_000 },
  { key: "day", label: "Yesterday or earlier", agoMs: 24 * 3_600_000 },
];
const TRANSPORT_LABEL: Record<TransportMode, string> = {
  boda: "Boda",
  car: "Car",
  taxi: "Taxi",
  ambulance: "Ambulance",
  walking: "Walking",
};
const CHILD_BANDS: { key: ChildBand; label: string }[] = [
  { key: "child_u2m", label: "Under 2 months" },
  { key: "child_2m_5y", label: "2 months to 5 years" },
  { key: "child_5_12", label: "5 to 12 years" },
];

/** Catalog icon keys → Lucide (the phone resolves the same keys to Ionicons). */
const TILE_ICON: Record<string, LucideIcon> = {
  lungs: WindIcon,
  heart: HeartIcon,
  brain: BrainIcon,
  thermometer: ThermometerIcon,
  bandage: BandageIcon,
  child: BabyIcon,
  gauge: GaugeIcon,
  eye: EyeIcon,
  throat: MicIcon,
  droplet: DropletIcon,
  bone: BoneIcon,
  hand: HandIcon,
  mind: BrainIcon,
  belly: CircleDotIcon,
};

const DEVICE_KEY = "medsync:device-id";
function deviceHash(): string {
  try {
    const have = window.localStorage.getItem(DEVICE_KEY);
    if (have) return have;
    const id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** "When were they last normal?" as a clock time today (or yesterday if that is still ahead). */
function lastNormalIso(hhmm: string): string | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return undefined;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d.toISOString();
}

/** Clock reads live here, outside the component, so its handlers stay pure to the compiler. */
const nowMs = () => Date.now();
const agoIso = (ms: number) => new Date(nowMs() - ms).toISOString();

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "queued" }
  | { kind: "failed"; message: string; callOnly: boolean };

export function PreAlertForm({
  facilities,
  ownHospitalId,
  signedIn,
  eItems,
  tiles,
  initialItems,
  submissionId,
}: {
  facilities: PreAlertFacility[];
  ownHospitalId: string | null;
  signedIn: boolean;
  eItems: EItem[];
  tiles: Tile[];
  initialItems: string[];
  submissionId: string | null;
}) {
  const router = useRouter();
  const byKey = useMemo(() => new Map(eItems.map((i) => [i.key, i])), [eItems]);

  // The catalog's draft (sessionStorage) stands in when E1 passed nothing —
  // read once in the initialisers, the booking wizard's own pattern. Only an
  // EMERGENCY draft: a routine report from earlier is not this alert, and
  // must not lend it its tier or its submission.
  const [draft] = useState(() => {
    if (initialItems.length > 0 || submissionId) return null;
    const d = readPendingCatalogDraft();
    return d?.tier === "E" ? d : null;
  });
  const [items, setItems] = useState<string[]>(() =>
    (initialItems.length > 0 ? initialItems : (draft?.items ?? [])).filter((k) => byKey.has(k)),
  );
  const submission = submissionId ?? draft?.submissionId ?? null;
  const tier: Tier = draft?.tier ?? "E";
  const [who, setWho] = useState<Who>(() =>
    draft && draft.audience !== "adult" && draft.audience !== "pregnant"
      ? "child"
      : signedIn
        ? "me"
        : "other",
  );
  const [childBand, setChildBand] = useState<ChildBand>(() =>
    draft && draft.audience !== "adult" && draft.audience !== "pregnant"
      ? draft.audience
      : "child_2m_5y",
  );
  const [pregnant, setPregnant] = useState(draft?.audience === "pregnant");

  const [here, setHere] = useState<LatLng | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locationAsked, setLocationAsked] = useState(false);
  const ordered = useMemo(
    () => orderFacilities(facilities, here, ownHospitalId),
    [facilities, here, ownHospitalId],
  );
  const [facilityId, setFacilityId] = useState<string | null>(
    () => ordered.find((o) => o.facility.preAlertEnabled)?.facility.id ?? null,
  );
  const facility = facilities.find((f) => f.id === facilityId) ?? null;

  const [onset, setOnset] = useState<Onset>(E2_DEFAULTS.onset);
  const [lastNormal, setLastNormal] = useState("");
  const [transport, setTransport] = useState<TransportMode>(E2_DEFAULTS.transport);
  const [eta, setEta] = useState<EtaBand>(E2_DEFAULTS.eta);
  const [callback, setCallback] = useState("");
  const [shareLocation, setShareLocation] = useState<boolean>(E2_DEFAULTS.shareLocation);
  const [state, setState] = useState<SendState>({ kind: "idle" });

  // The tiles, plus anything chosen that is not among them (a catalog pick,
  // a select pick) so every choice is visible and un-tickable in one place.
  const tileRows: Tile[] = [
    ...tiles,
    ...items
      .filter((k) => !tiles.some((tl) => tl.key === k))
      .map((k) => ({ key: k, label: byKey.get(k)?.label ?? k, icon: "alert" })),
  ];
  const toggleItem = (k: string) =>
    setItems((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const stroke = items.some((k) => byKey.get(k)?.stroke);
  const isolation = items.some((k) => byKey.get(k)?.isolation);
  const audience: SubmissionAudience =
    who === "child" ? childBand : pregnant ? "pregnant" : "adult";

  /** `then` always fires — with null when the device refuses — so a Send never stalls on location. */
  function askLocation(then?: (p: LatLng | null) => void) {
    setLocationAsked(true);
    if (!("geolocation" in navigator)) {
      setLocationNote("Location is not available on this device — sorted by name.");
      then?.(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setHere(p);
        setLocationNote(null);
        then?.(p);
      },
      () => {
        setLocationNote("Couldn't get your location — sorted by name.");
        then?.(null);
      },
      { timeout: 8_000, maximumAge: 60_000 },
    );
  }

  function buildInput(position: LatLng | null): PreArrivalInput | string {
    if (!facility) return "Choose a hospital that takes pre-alerts, or call one.";
    const phone = callback.trim();
    if (!signedIn && !phone) return "Enter a number the hospital can call back.";
    const onsetAgo = ONSET.find((o) => o.key === onset)?.agoMs ?? 0;
    return {
      facility_id: facility.id,
      ...(submission ? { submission_id: submission } : {}),
      subject: {
        audience,
        // "Someone else" who is an adult: the age band marks the reporter as
        // not the subject (the function keys "me" off adult + no band).
        ...(who === "other" && audience === "adult" ? { age_band: "adult" } : {}),
        ...(pregnant ? { pregnant: true } : {}),
      },
      red_flags: items,
      tier,
      isolation_flag: isolation,
      onset_at: agoIso(onsetAgo),
      ...(stroke && lastNormal ? { last_known_well_at: lastNormalIso(lastNormal) } : {}),
      transport_mode: transport,
      eta_band: eta,
      ...(phone ? { callback_phone: phone } : {}),
      ...(shareLocation && position
        ? { share_location: { lat: position.latitude, lng: position.longitude } }
        : {}),
      device_hash: deviceHash(),
    };
  }

  async function send(input: PreArrivalInput) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      queue(input);
      return;
    }
    setState({ kind: "sending" });
    let result: Awaited<ReturnType<typeof createPreArrivalAction>>;
    try {
      result = await createPreArrivalAction(input);
    } catch {
      // Offline → queued for the reconnect. Online and the server failed →
      // say so; "queued" would promise a retry nothing will make.
      if (typeof navigator !== "undefined" && navigator.onLine === false) queue(input);
      else
        setState({
          kind: "failed",
          message: "We couldn't send this. Try again, or call — calling always works.",
          callOnly: false,
        });
      return;
    }
    if (!result.ok) {
      if (result.status === 0) {
        queue(input);
        return;
      }
      const callOnly = result.code === "call_only" || result.code === "rate_limited";
      setState({
        kind: "failed",
        message: callOnly ? `${result.message} Calling always works.` : result.message,
        callOnly,
      });
      return;
    }
    writeStoredPreArrival(result.data.pre_arrival_id, {
      token: result.data.token,
      sentAt: nowMs(),
      smsBody: result.data.sms_fallback_body,
    });
    router.push(`/emergency/status?id=${encodeURIComponent(result.data.pre_arrival_id)}`);
  }

  function queue(input: PreArrivalInput) {
    setState({ kind: "queued" });
    // ponytail: one in-memory retry on reconnect; a persisted outbox if a
    // reload between the two ever matters.
    window.addEventListener("online", () => void send(input), { once: true });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const built = buildInput(here);
    if (typeof built === "string") {
      setState({ kind: "failed", message: built, callOnly: false });
      return;
    }
    if (shareLocation && !here) {
      // Explicit toggle, first use: fetch the position for this one alert;
      // refused or unavailable, the alert still goes — without it.
      askLocation((p) => {
        const withPos = buildInput(p);
        if (typeof withPos !== "string") void send(withPos);
      });
      return;
    }
    void send(built);
  }

  const smsHref =
    facility?.emergencySmsNumber && state.kind !== "idle" && state.kind !== "sending"
      ? smsLink(
          facility.emergencySmsNumber,
          composeFacilitySms({
            tier,
            dangerSign: items[0] ? (byKey.get(items[0])?.label ?? null) : null,
            etaBand: eta,
            transport,
            callback: callback.trim() || "the app (no number given)",
          }),
        )
      : null;
  const busy = state.kind === "sending";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" aria-busy={busy}>
      {/* Hospital */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground text-body-m mb-2 font-medium">Which hospital</legend>
        {!locationAsked ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => askLocation()}
            className="w-full sm:w-fit"
          >
            <MapPinIcon aria-hidden />
            Use my location to sort hospitals
          </Button>
        ) : locationNote ? (
          <p className="text-muted-foreground text-body-s">{locationNote}</p>
        ) : null}
        {ordered.length === 0 ? (
          <p className="text-muted-foreground text-body-s">
            No hospital takes pre-alerts yet. Please call one of the emergency numbers.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map(({ facility: f, distanceKm, isOwn }) =>
              f.preAlertEnabled ? (
                <li key={f.id}>
                  <label
                    className={cn(
                      "border-border bg-card flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
                      "has-checked:bg-foreground has-checked:text-background has-checked:border-foreground has-focus-visible:shadow-focus",
                    )}
                  >
                    <input
                      type="radio"
                      name="facility"
                      value={f.id}
                      checked={facilityId === f.id}
                      onChange={() => setFacilityId(f.id)}
                      className="sr-only"
                    />
                    <span className="text-body-m min-w-0 flex-1 truncate font-medium">
                      {f.name}
                    </span>
                    <span className="text-body-s shrink-0 opacity-80">
                      {isOwn ? "Your hospital" : distanceKm !== null ? `${distanceKm} km` : ""}
                    </span>
                  </label>
                </li>
              ) : (
                <li
                  key={f.id}
                  className="border-border bg-muted flex min-h-12 items-center gap-3 rounded-xl border border-dashed px-3 py-2"
                >
                  <span className="text-body-m min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-muted-foreground text-body-s shrink-0">Call only</span>
                  {f.emergencyPhone ? (
                    <a
                      href={telHref(f.emergencyPhone)}
                      className={cn(
                        buttonVariants({ variant: "secondary", size: "sm" }),
                        "min-h-11",
                      )}
                    >
                      <PhoneIcon aria-hidden />
                      <span className="tabular font-mono">{f.emergencyPhone}</span>
                    </a>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
      </fieldset>

      {/* Who */}
      <Chips<Who>
        legend="Who is it for"
        value={who}
        onChange={setWho}
        options={[
          { key: "me", label: "Me" },
          { key: "child", label: "A child" },
          { key: "other", label: "Someone else" },
        ]}
      />
      {who === "child" ? (
        <Chips<ChildBand>
          legend="How old is the child"
          value={childBand}
          onChange={setChildBand}
          options={CHILD_BANDS}
        />
      ) : (
        <label className="text-body-s text-foreground inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={pregnant}
            onChange={(e) => setPregnant(e.target.checked)}
            className="accent-primary size-5"
          />
          Pregnant, or gave birth in the last 6 weeks
        </label>
      )}

      {/* What — the tiles (E1's strip), then anything chosen beyond them, then the rest by select. */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-foreground text-body-m mb-2 font-medium">
          What&rsquo;s happening{" "}
          <span className="text-muted-foreground font-normal">
            ({items.length === 0 ? `${E2_DEFAULTS.what} — tap any` : "tap to change"})
          </span>
        </legend>
        <ul className="grid grid-cols-2 gap-2" aria-label="Danger signs">
          {tileRows.map((tile) => {
            const Icon = TILE_ICON[tile.icon] ?? CircleAlertIcon;
            const chosen = items.includes(tile.key);
            return (
              <li key={tile.key}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => toggleItem(tile.key)}
                  className={cn(
                    "focus-visible:shadow-focus flex min-h-14 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left outline-none select-none",
                    chosen
                      ? "bg-foreground text-background border-foreground"
                      : "border-border bg-card text-foreground hover:bg-muted",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                  <span className="text-body-s leading-snug">{tile.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col">
          <Label htmlFor="add-sign">Another danger sign</Label>
          <select
            id="add-sign"
            value=""
            onChange={(e) => {
              const k = e.target.value;
              if (k && !items.includes(k)) setItems((xs) => [...xs, k]);
            }}
            className="border-input bg-card text-foreground text-body-s min-h-11 rounded-sm border px-2.5"
          >
            <option value="">Choose…</option>
            {eItems
              .filter((i) => !items.includes(i.key) && !tiles.some((tl) => tl.key === i.key))
              .map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
          </select>
        </div>
      </fieldset>

      {/* When */}
      <Chips<Onset>
        legend="When it started"
        value={onset}
        onChange={setOnset}
        options={ONSET.map(({ key, label }) => ({ key, label }))}
      />
      {stroke ? (
        <div className="flex flex-col">
          <Label htmlFor="last-normal">When were they last normal?</Label>
          <Input
            id="last-normal"
            type="time"
            value={lastNormal}
            onChange={(e) => setLastNormal(e.target.value)}
            className="min-h-11 max-w-40"
          />
        </div>
      ) : null}

      {/* Transport, ETA */}
      <Chips<TransportMode>
        legend="Getting there by"
        value={transport}
        onChange={setTransport}
        options={TRANSPORT_MODES.map((k) => ({ key: k, label: TRANSPORT_LABEL[k] }))}
      />
      <Chips<EtaBand>
        legend="Arriving in"
        value={eta}
        onChange={setEta}
        options={ETA_BANDS.map((k) => ({ key: k, label: ETA_BAND_LABEL[k] }))}
      />

      {/* Callback */}
      <div className="flex flex-col">
        <Label htmlFor="callback">
          Number the hospital can call back{signedIn ? "" : " (required)"}
        </Label>
        <Input
          id="callback"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required={!signedIn}
          value={callback}
          onChange={(e) => setCallback(e.target.value)}
          placeholder="07XXXXXXXX"
          className="min-h-11"
        />
        {signedIn ? (
          <p className="text-muted-foreground text-caption mt-1">
            Leave blank to use the number on your account.
          </p>
        ) : null}
      </div>

      {facility?.ambulanceNumber ? (
        <label className="text-body-s text-foreground inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={shareLocation}
            onChange={(e) => setShareLocation(e.target.checked)}
            className="accent-primary size-5"
          />
          Share my location with this hospital (it runs an ambulance)
        </label>
      ) : null}

      {state.kind === "failed" ? (
        <p role="alert" className="text-status-caution-fg text-body-s">
          {state.message}
        </p>
      ) : null}
      {state.kind === "queued" ? (
        <p role="status" className="text-status-caution-fg text-body-s">
          Queued — you seem to be offline. We&rsquo;ll send it when the connection returns. Call the
          hospital, or send the text below from your own phone.
        </p>
      ) : null}

      {/* On a phone the actions dock to the bottom edge so Send is never a
          scroll away; from md up they sit in the flow. The pill is hidden on
          this route, so nothing overlaps. */}
      <div
        className={cn(
          "flex flex-col gap-2",
          "border-border bg-background/95 supports-backdrop-filter:bg-background/80 sticky bottom-0 z-10 -mx-4 border-t px-4 pt-3 supports-backdrop-filter:backdrop-blur sm:-mx-6 sm:px-6",
          "pb-[max(env(safe-area-inset-bottom),0.75rem)]",
          "md:static md:m-0 md:border-0 md:bg-transparent md:p-0",
        )}
      >
        {state.kind === "failed" && state.callOnly ? null : (
          <Button
            type="submit"
            variant="emergency"
            size="lg"
            disabled={busy || !facility}
            className="min-h-14 w-full rounded-xl"
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        )}
        {facility?.emergencyPhone ? (
          <a
            href={telHref(facility.emergencyPhone)}
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "min-h-12 w-full rounded-xl",
            )}
          >
            <PhoneIcon aria-hidden />
            Call {facility.name}
            <span className="tabular font-mono">{facility.emergencyPhone}</span>
          </a>
        ) : null}
        {smsHref ? (
          <a
            href={smsHref}
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "min-h-12 w-full rounded-xl",
            )}
          >
            Send it as a text instead
          </a>
        ) : null}
      </div>
    </form>
  );
}

/** Single-choice chips: chosen = ink, the repo's selection language. */
function Chips<K extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: ReactNode;
  value: K;
  onChange: (k: K) => void;
  options: { key: K; label: string }[];
}) {
  return (
    <fieldset>
      <legend className="text-foreground text-body-m mb-2 font-medium">{legend}</legend>
      {/* Toggle buttons, not a radiogroup: each is its own tab stop and the
          fieldset's legend names the group — no arrow-key contract to break. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {options.map((o) => {
          const chosen = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={chosen}
              onClick={() => onChange(o.key)}
              className={cn(
                "text-body-s focus-visible:shadow-focus min-h-11 rounded-full px-4 font-medium outline-none",
                "w-full sm:w-auto",
                chosen
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground hover:bg-foreground/10",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

import type { ReadingRow, TrackingGlance } from "@/lib/patient/self-tracking";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { loadBookingSymptoms } from "@/lib/catalog/symptoms";
import { catalogRenderMode } from "@/lib/emergency/feature";
import { fetchCatalogVersionStatus } from "@/lib/emergency/queries";
import { fetchAppointments, fetchLiveIntakeToday } from "@/lib/patient/appointments";
import { fetchDiscovery } from "@/lib/patient/discover";
import { requirePatientScope } from "@/lib/patient/scope";
import {
  fetchTrackingGlance,
  formatReadingValue,
  formatReadingWhen,
  listRecentReadings,
  READING_KIND_LABEL,
} from "@/lib/patient/self-tracking";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import {
  CATALOG,
  CATALOG_CHECKSUM,
} from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import {
  dangerSigns,
  t,
  visibleItems,
} from "@/supabase/functions/_shared/symptom-catalog/classify";
import { QUICK_PICK_CODES } from "@/supabase/functions/_shared/symptoms";
import { ComingUp } from "./_components/coming-up";
import { DiscoverySearch } from "./_components/discovery-search";
import { PatientDoors } from "./_components/doors";
import { PatientPageHeader } from "./_components/page-header";
import { SectionHead } from "./_components/section-head";
import { SymptomQuickPick } from "./_components/symptom-quick-pick";
import { TintedRow } from "./_components/tinted-row";
import { Watermark } from "./symptoms/_components/watermark";

export const metadata: Metadata = { title: "Home · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The patient home, in one reading order: safety, access, then today.
 *
 *   main column   the greeting, "What's wrong?" (or the shortlist), "Get seen"
 *   right column  "Coming up", today's doses, recent readings
 *   below main    discovery, only when the hospital has something to show
 *
 * Symptoms come before the doors so a new or worsening problem meets the
 * catalog before the booking wizard. The source order is the phone's order —
 * greeting, symptoms, what is in motion, the doors, doses, readings,
 * discovery — and the wide layout only moves the right column beside the
 * main one, so focus order never leaves reading order.
 *
 * Nothing on the page is decoration: information sits on neutral cards, teal
 * is only ever something to press, and each action appears once. The hero,
 * the eyebrow, "Quick actions" and the visits list left with the redesign;
 * "Coming up" and "See your visits" cover what they carried.
 */
export default async function PatientHome() {
  const scope = await requirePatientScope();
  // A new patient's home is the hospital directory until they choose one:
  // MedSync Book starts with "where", not with a vitals log.
  if (!scope.primaryHospitalId) redirect("/patient/hospitals");
  const hospitalId = scope.primaryHospitalId;
  // One clock read: the ticket's day, the arrival gate and the 24-hour
  // confirmation window must agree about "now".
  const now = new Date();

  const [upcoming, ticket, glance, readings, discovery, catalogue, catalogStatus] =
    await Promise.all([
      // The two glances of what is in motion fail to "absent", never to an
      // error screen: home must survive a scheduling outage. Visits count
      // from the start of the clinic's day, not from now: a clinic-day
      // booking starts when the session does, and its arrival window opens
      // after that — so a patient arriving in their window keeps today's
      // visit, and its "I have arrived", in view.
      fetchAppointments(
        scope.userId,
        "upcoming-active",
        1,
        startOfLocalDay(now, DEFAULT_TIME_ZONE),
      ).catch(() => []),
      fetchLiveIntakeToday(scope.userId, hospitalId, now).catch(() => null),
      fetchTrackingGlance(scope.userId),
      listRecentReadings(scope.userId, 3),
      // ADR 0085 §4. A browse section is a convenience, never the screen.
      fetchDiscovery(hospitalId, scope.userId).catch(() => ({ lines: [], providers: [] })),
      // ADR 0096: the shortlist's words come from the catalogue, never from code.
      loadBookingSymptoms().catch(() => []),
      // ADR 0098 Gate CS: a database before migration 0066 reads as "not signed".
      fetchCatalogVersionStatus(CATALOG.version, CATALOG_CHECKSUM).catch(() => null),
    ]);
  // `off` keeps the ADR 0096 shortlist exactly as shipped (ruling 2).
  const catalogMode = catalogRenderMode(catalogStatus?.signed === true);
  // The shared list's order, skipping any code the catalogue no longer carries.
  const quickPicks = QUICK_PICK_CODES.flatMap((code) => {
    const row = catalogue.find((r) => r.code === code);
    return row ? [{ code: row.code, display: row.display }] : [];
  });

  const firstName = scope.fullName?.split(" ")[0];
  const visit = upcoming[0] ?? null;
  const hasDiscovery = discovery.lines.length > 0 || discovery.providers.length > 0;

  return (
    // Bottom padding clears the fixed Emergency pill at rest: above the tab
    // bar on a phone, bottom-right on a desktop. `auto_1fr`: when the right
    // column (spanning both rows) is the taller, row 2 takes the overhang, so
    // discovery stays under the doors instead of below a blank band.
    <div className="grid gap-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-12 @5xl/page:grid-cols-[minmax(0,1fr)_20rem] @5xl/page:grid-rows-[auto_1fr] @5xl/page:gap-x-8">
      <div className="flex min-w-0 flex-col gap-6">
        <PatientPageHeader
          title={firstName ? `Hello, ${firstName}.` : "Hello."}
          description={
            // No name, no sentence: a placeholder would read "Your hospital
            // is your hospital". Only reachable if the row went mid-request.
            scope.primaryHospitalName ? (
              <>
                {/* The hospital's page is one tap from its name — the card that
                  used to say "change it here" said it a fourth time. The
                  padding makes a 44px target without moving the line. */}
                <Link
                  href="/patient/hospitals"
                  className="-my-3 inline-block py-3 text-teal-700 underline underline-offset-4"
                >
                  {scope.primaryHospitalName}
                </Link>
                {" is your hospital. Track how you're doing and see your visits."}
              </>
            ) : undefined
          }
        />

        {catalogMode !== "off" ? (
          <CatalogEntry watermark={catalogMode === "draft_watermarked"} />
        ) : quickPicks.length > 0 ? (
          <SymptomQuickPick options={quickPicks} />
        ) : null}

        {/* On a phone, what is in motion sits between the symptoms and the
            doors; with nothing in motion it is not there at all. */}
        {ticket || visit ? (
          <ComingUp
            id="coming-up-main"
            ticket={ticket}
            visit={visit}
            now={now}
            className="flex @5xl/page:hidden"
          />
        ) : null}

        <section aria-labelledby="get-seen" className="flex flex-col gap-3">
          <h2 id="get-seen" className="text-heading-s">
            Get seen
          </h2>
          <PatientDoors />
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-6 @5xl/page:col-start-2 @5xl/page:row-span-2 @5xl/page:row-start-1">
        <ComingUp
          id="coming-up"
          ticket={ticket}
          visit={visit}
          now={now}
          className="hidden @5xl/page:flex"
        />
        <TodaysDoses doses={glance.todaySlots} />
        <RecentReadings readings={readings} now={now} />
      </div>

      {/* The clinics this hospital runs and who a patient could pick, behind
          one search box (ADR 0085 §4 on what may be shown). */}
      {hasDiscovery ? (
        <div className="min-w-0 @5xl/page:col-start-1">
          <DiscoverySearch lines={discovery.lines} providers={discovery.providers} />
        </div>
      ) : null}
    </div>
  );
}

/* ── Sections ──────────────────────────────────────────────────── */

/**
 * The catalog's door on the home (ADR 0098): the adult danger signs as links
 * that land on /patient/symptoms with the sign already chosen — so the
 * interrupt fires on arrival — then the primary way in. Compact rows on a
 * neutral card, amber only in the icon (CSO, 2026-09-23): the same four
 * signs, order, words and targets as the landing's strip, quiet enough that
 * a patient who comes daily to log a reading does not learn to skip them.
 * Rendered on the server, so the catalog never ships in this page's bundle.
 */
function CatalogEntry({ watermark }: { watermark: boolean }) {
  const signs = dangerSigns(CATALOG, "adult").slice(0, 4);
  const allCount = visibleItems(CATALOG, "adult").filter((i) => i.tier === "E").length;
  return (
    <section aria-labelledby="whats-wrong" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="whats-wrong" className="text-heading-s">
          What&rsquo;s wrong?
        </h2>
        <p className="text-muted-foreground text-body-s">
          Tell us what you feel or see, and we will say how soon to be seen.
        </p>
      </div>
      {/* Mandatory while unsigned (ruling 2), and read aloud. A dashed rule
          and ink, not an amber fill: amber is the icon's job on this page. */}
      {watermark ? (
        <Watermark className="border-status-caution-fg text-foreground border border-dashed bg-transparent" />
      ) : null}
      <ul aria-label={t(CATALOG, "strip.title")} className="grid gap-2 @2xl/page:grid-cols-2">
        {signs.map((it) => (
          <li key={it.key} className="min-w-0">
            <Link
              href={`/patient/symptoms?item=${encodeURIComponent(it.key)}`}
              className="tap bg-card border-border text-foreground text-body-s md:hover:bg-muted flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 leading-tight"
            >
              <TriangleAlertIcon aria-hidden className="text-status-caution-fg size-4 shrink-0" />
              <span className="min-w-0 flex-1">{t(CATALOG, it.labelKey)}</span>
              <span className="sr-only">, {t(CATALOG, "tier.E")}</span>
              <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link href="/patient/symptoms" className={cn(buttonVariants({ size: "lg" }), "min-h-12")}>
          What&rsquo;s wrong? Tell us
        </Link>
        <Link
          href="/patient/symptoms?list=danger"
          className="text-body-s inline-flex min-h-11 items-center text-teal-700 underline-offset-4 hover:underline"
        >
          {t(CATALOG, "strip.all")} ({allCount})
        </Link>
      </div>
    </section>
  );
}

function TodaysDoses({ doses }: { doses: TrackingGlance["todaySlots"] }) {
  return (
    <section aria-labelledby="todays-doses" className="flex flex-col gap-3">
      <SectionHead
        id="todays-doses"
        title="Today's doses"
        linkHref="/patient/track/medications"
        linkLabel="All medicines"
      />
      <ul>
        {doses.total > 0 ? (
          <TintedRow
            tint="neutral"
            iconKey="pill"
            title="Doses today"
            subtitle={doseSubtitle(doses)}
            href="/patient/track/doses"
            className={ROW}
            trailing={
              <span className="text-foreground text-body-m font-mono tabular-nums">
                {doses.taken}/{doses.total}
              </span>
            }
          />
        ) : (
          <TintedRow
            tint="neutral"
            iconKey="pill"
            title="Nothing scheduled today"
            subtitle="Add a medicine and its times to see them here"
            href="/patient/track/medications"
            className={ROW}
          />
        )}
      </ul>
    </section>
  );
}

/** Self-tracking is the patient's own: the one line under it says so, and nothing implies a reader. */
function RecentReadings({ readings, now }: { readings: ReadingRow[]; now: Date }) {
  return (
    <section aria-labelledby="recent-readings" className="flex flex-col gap-3">
      <SectionHead
        id="recent-readings"
        title="Recent readings"
        linkHref="/patient/track"
        linkLabel="See readings"
      />
      {readings.length === 0 ? (
        <p className="text-muted-foreground text-body-s">
          Nothing logged yet. A glucose, blood-pressure or weight reading takes a moment.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {readings.map((reading) => (
            <ReadingRowItem key={reading.id} reading={reading} now={now} />
          ))}
        </ul>
      )}
      <Link
        href="/patient/track/log"
        className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "min-h-11 w-full")}
      >
        Log a reading
      </Link>
      <p className="text-muted-foreground text-caption">Only you can see this.</p>
    </section>
  );
}

/**
 * The right column's row: a neutral card, never a tint (tint is recognition,
 * and this is information). `py-1`: with a trailing count the row's link
 * stretches to the content box, which must stay at least 44px tall. In a
 * 20rem column the row's lines wrap rather than clip: "Add a medicine and
 * its times…" is the row's only instruction.
 */
const ROW = "bg-card border-border min-h-14 border py-1 [&_.truncate]:whitespace-normal";

function ReadingRowItem({ reading, now }: { reading: ReadingRow; now: Date }) {
  const value = formatReadingValue(reading);

  return (
    <li className="bg-card border-border flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2.5">
      <span className="min-w-0">
        <span className="text-muted-foreground text-body-s block">
          {READING_KIND_LABEL[reading.kind] ?? "Reading"}
        </span>
        {/* A note or a symptom has no numeric value, and an empty mono slot
            reads as a missing number rather than a written entry — so the
            prose stands in for it, clipped by the row, not by a slice. */}
        {value ? (
          <span className="text-foreground text-body-m block font-mono tabular-nums">{value}</span>
        ) : reading.note ? (
          <span className="text-foreground text-body-m block truncate">{reading.note}</span>
        ) : reading.severity !== null ? (
          <span className="text-foreground text-body-m block">
            Severity <span className="font-mono tabular-nums">{reading.severity}</span> of 5
          </span>
        ) : (
          <span className="text-muted-foreground text-body-m block">No value recorded</span>
        )}
      </span>
      <time
        dateTime={reading.recordedAtIso}
        className="text-muted-foreground text-caption shrink-0 font-mono tabular-nums"
      >
        {formatReadingWhen(reading.recordedAtIso, now)}
      </time>
    </li>
  );
}

/* ── Format helpers ────────────────────────────────────────────── */

/**
 * Never "all taken" when slots are still unrecorded: `next` is only the
 * earliest slot still within its grace window, so a day with a missed
 * 08:00 and nothing else due has no next dose and is not complete either.
 * Naming the state is the timeline's job — this line only points at it.
 */
function doseSubtitle(doses: TrackingGlance["todaySlots"]): string {
  if (doses.next) return `Next · ${doses.next.name} at ${doses.next.timeLabel}`;
  if (doses.taken >= doses.total) return "Everything recorded for today";
  return "Some doses have no entry yet";
}

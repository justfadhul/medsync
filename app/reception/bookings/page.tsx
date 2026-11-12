import type { LineOption } from "@/app/patient/book/_lib/booking";
import type { DeskBooking } from "@/lib/reception/bookings";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { findDeskBookings } from "@/lib/reception/bookings";
import { requireReceptionScope } from "@/lib/reception/scope";
import { fetchLines } from "@/lib/scheduling/booking-options";
import { MOVABLE_STATUSES } from "@/supabase/functions/_shared/booking-change";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/supabase/functions/_shared/slots";
import { BookingRow } from "./_components/booking-row";

export const metadata: Metadata = { title: "Bookings · Reception · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

/**
 * Cancel or move a booking (ADR 0473). Found by the two codes the desk is
 * read out — the six-character booking code or the patient code — at this
 * hospital only. Moves stay in the same clinic and pass the same rules a
 * patient booking passes; the server checks all of it again.
 */
export default async function ReceptionBookingsPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const scope = await requireReceptionScope();
  const query = (q ?? "").trim().slice(0, 40);
  const now = new Date();

  const bookings = await findDeskBookings({ hospitalId: scope.hospitalId, query });
  const anyMovable = bookings.some((b) =>
    (MOVABLE_STATUSES as readonly string[]).includes(b.status),
  );
  // The same offer the Book page shows, read only when something can move.
  const lines = anyMovable ? await fetchLines(scope.hospitalId, null, now, false) : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href="/reception"
        className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out group inline-flex w-fit items-center gap-1 transition-colors duration-150"
      >
        <ArrowLeftIcon
          className="ease-expo-out size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Today
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-plum-icon ring-plum-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Bookings
        </span>
        <h1 className="font-display text-display-s text-foreground">Cancel or move a booking</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
          Find it by the six-character booking code or the patient code. A move stays in the same
          clinic and gets a new code; the patient is told by SMS and in the app either way.
        </p>
      </header>

      <form className="group relative" role="search" action="/reception/bookings">
        <label htmlFor="desk-bookings-q" className="sr-only">
          Booking code or patient code
        </label>
        <span
          aria-hidden
          className="text-muted-foreground group-focus-within:text-brand-600 ease-expo-out pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 transition-colors duration-150"
        >
          <SearchIcon className="size-4" />
        </span>
        <Input
          id="desk-bookings-q"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Booking code, or patient code"
          className="text-body-s min-h-11 w-full pr-3 pl-9 font-mono"
          minLength={3}
          // The page IS this search, and the caller is on the line.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </form>

      {query.length >= 3 ? (
        <section aria-labelledby="bookings-heading" className="flex flex-col gap-2">
          <h2
            id="bookings-heading"
            className="text-muted-foreground text-overline font-mono uppercase"
          >
            From today on · {bookings.length} {bookings.length === 1 ? "booking" : "bookings"}
          </h2>
          {bookings.length === 0 ? (
            <p className="text-muted-foreground text-body-s">
              No booking from today on at {scope.hospitalName} matches &ldquo;{query}&rdquo;. Check
              the code with the caller; a past or already-cancelled visit is not listed.
            </p>
          ) : (
            <ul className="stagger-children flex flex-col gap-2">
              {bookings.map((b) => (
                <BookingRow
                  key={b.id}
                  booking={b}
                  moveLine={moveLineFor(b, lines)}
                  nowIso={now.toISOString()}
                  todayIso={localDateKey(now, DEFAULT_TIME_ZONE)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Where this booking may move: the same clinic-day line (its own day left
 * out), or for a timed booking a timed line of the same department that takes
 * its reason. Null when it cannot move or nothing is open. Video stays off:
 * a move keeps the visit's type.
 */
function moveLineFor(b: DeskBooking, lines: ReadonlyArray<LineOption>): LineOption | null {
  if (!(MOVABLE_STATUSES as readonly string[]).includes(b.status)) return null;
  if (b.sessionId) {
    const line = lines.find((l) => l.id === b.serviceLineId && l.capacityMode === "session");
    const sessions = line?.sessions.filter((s) => s.id !== b.sessionId) ?? [];
    return line && sessions.length > 0 ? { ...line, sessions } : null;
  }
  const line = lines.find(
    (l) =>
      l.capacityMode === "slot" &&
      l.departmentId === b.departmentId &&
      l.reasonCodes.includes(b.reason),
  );
  const clinicians = (line?.clinicians ?? [])
    .filter((c) => Object.keys(c.slotsByDate).length > 0)
    .map((c) => ({ ...c, allowVirtual: false }));
  return line && clinicians.length > 0 ? { ...line, clinicians } : null;
}

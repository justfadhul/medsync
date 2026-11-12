import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_LABEL } from "@patient-core/visits";
import {
  clockOf,
  dayKeyOf,
  dayNumberOf,
  directionsUrl,
  initialsOf,
  monthShortOf,
  partOf,
  shortDayOf,
  visitControls,
  weekdayOf,
} from "@patient-core/visits-calendar";
import { MessageCircleIcon, NavigationIcon } from "lucide-react";
import { z } from "zod";

import { Avatar, Band, buttonClass, Card, ICON, Note, Pill } from "@/components/tide/kit";
import { PageHeader } from "@/components/tide/shell";
import { VisitTicket } from "@/components/tide/visits-ticket";
import { VISITS_COPY as C } from "@/content/patient/visits";
import { patientFlag } from "@/lib/patient-web/flags";
import { loadVisit } from "@/lib/patient-web/visits-data";
import { requirePatientScope } from "@/lib/patient/scope";
import { cancellationSentence } from "@/supabase/functions/_shared/cancel-reasons";
import { reasonTitle } from "../_lib/reason";
import { RetryButton } from "../../_components/home-bits";
import { VisitActions } from "./_components/visit-actions";

export const metadata: Metadata = { title: "Visit" };
export const dynamic = "force-dynamic";

const back = { href: "/patient/visits", label: C.back };

/**
 * One visit (the phone's app/(app)/visits/[id].tsx, board TVisit/DVisit): the navy band with the day tile, who
 * you will see, the ticket, the notices, getting there, and I'm coming / I'm here, Move it and Cancel. A
 * household member's visit is logistics only: no action is offered. No place number, no map drawn (none
 * exists on the web yet); the message button only with `mobileChat` on (ADR 0342 §4).
 */
export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requirePatientScope();
  const visit = z.string().uuid().safeParse(id).success
    ? await loadVisit(scope.userId, id).catch(() => "failed" as const)
    : null;

  if (visit === "failed" || visit === null)
    return (
      <>
        <PageHeader back={back} title={C.yourVisitTitle} />
        <div className="flex max-w-2xl flex-col items-start gap-3">
          <Note>{visit ? C.visitFailed : C.visitMissing}</Note>
          {visit ? <RetryButton /> : null}
        </div>
      </>
    );

  const now = new Date();
  const controls = visitControls(visit, now);
  const title = reasonTitle(visit);
  const key = dayKeyOf(visit.startsAtIso);
  const ended = cancellationSentence(visit.status, visit.cancelledReason);
  const status = STATUS_LABEL[visit.status] ?? "";
  const place = [status, visit.bookingCode ? C.code(visit.bookingCode) : null]
    .filter(Boolean)
    .join(" · ");
  // A doctor's slot has a time (ADR 0403); a place in a clinic day has a part of the day only.
  const slot = visit.sessionId === null;
  const live = !ended && visit.status !== "completed" && visit.status !== "no_show";
  const maps = directionsUrl(visit.hospitalPin);

  return (
    <>
      <PageHeader back={back} title={title} />
      <div className="flex max-w-2xl flex-col gap-5">
        <Band className="flex items-start gap-3.5 pr-0">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Pill tone="glass" className="self-start">
              <span aria-hidden className="bg-pw-area-visits size-2 rounded-full" />
              {visit.forMember ? C.bandFor(visit.forMember) : C.bandDept(visit.departmentName)}
            </Pill>
            {place ? <p className="text-pw-on-band-2 text-[17px] font-medium">{place}</p> : null}
            <p className="text-pw-on-band-2 text-[15px]">{slot ? C.slotNote : C.honest}</p>
          </div>
          <div
            role="img"
            aria-label={shortDayOf(key)}
            className="bg-pw-surface text-pw-ink grid h-[84px] w-[72px] shrink-0 place-items-center content-center rounded-l-[20px]"
          >
            <span className="text-[30px] leading-[34px] font-bold">{dayNumberOf(key)}</span>
            <span className="text-pw-ink-2 text-sm">{weekdayOf(key)}</span>
          </div>
        </Band>

        <Card className="shadow-pw-float flex items-center gap-3">
          <Avatar initials={initialsOf(visit.clinicianName)} label={visit.clinicianName} />
          <div className="min-w-0 flex-1">
            <p className="text-xl leading-[26px] font-semibold">{visit.clinicianName}</p>
            <p className="text-pw-ink-2 text-[15px]">{C.yourClinician}</p>
          </div>
          {patientFlag("mobileChat") ? (
            <Link
              href="/patient/care/messages"
              aria-label={C.message}
              className="bg-pw-accent text-pw-on-accent focus-visible:outline-pw-focus grid size-12 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <MessageCircleIcon className="size-5" {...ICON} />
            </Link>
          ) : null}
        </Card>

        {live ? (
          <VisitTicket
            hospitalName={visit.hospitalName}
            day={dayNumberOf(key)}
            dayLine={`${weekdayOf(key)} · ${monthShortOf(key)}`.toUpperCase()}
            sessionLine={slot ? clockOf(visit.startsAtIso) : partOf(visit.startsAtIso)}
            slot={slot}
            status={status}
            details={[
              { label: C.ticket.clinic, value: visit.departmentName },
              { label: C.ticket.see, value: visit.clinicianName },
              {
                label: C.ticket.time,
                value: slot
                  ? C.ticket.arriveEarly(clockOf(visit.startsAtIso))
                  : C.ticket.notPromised,
              },
            ]}
            // The fee quoted at booking (ADR 0092); none quoted means no strip, never a guess. The ticket's
            // `feeLabel` is money words, never the stored cadre or line name.
            fee={visit.quotedFeeUgx ?? undefined}
            code={visit.bookingCode}
          />
        ) : null}

        <VisitActions
          visitId={visit.id}
          controls={controls}
          live={live}
          answered={visit.confirmedByPatientAtIso !== null}
        />

        {ended ? <Note>{ended}</Note> : null}
        {visit.forMember ? <Note>{C.householdLine(visit.forMember)}</Note> : null}

        <section
          id="getting-there"
          aria-labelledby="getting-there-h"
          className="flex scroll-mt-20 flex-col gap-2"
        >
          <h2 id="getting-there-h" className="text-lg leading-6 font-semibold">
            {C.gettingThere}
          </h2>
          <p className="text-pw-ink-2 text-[17px]">{`${visit.hospitalName} · ${visit.departmentName}`}</p>
          <p className="text-pw-ink-3 text-[13px] font-medium">
            {visit.bookingCode ? C.showCode(visit.bookingCode) : C.showNumber}
          </p>
          {maps ? (
            <a
              href={maps}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("soft", "l") + " self-start"}
            >
              <NavigationIcon className="size-5" {...ICON} />
              {C.directionsInMaps}
            </a>
          ) : (
            <p className="text-pw-ink-3 text-[13px] font-medium">{C.noPin(visit.hospitalName)}</p>
          )}
        </section>
      </div>
    </>
  );
}

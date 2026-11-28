import type { VisitRow } from "@/lib/patient-web/visits-data";
import Link from "next/link";
import { ticketView } from "@patient-core/ticket-view";
import { kampalaStamp, visitMoney } from "@patient-core/visit-money";
import { stageOf } from "@patient-core/visit-stages";
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

import { Avatar, Band, buttonClass, Card, ICON, Note, Pill } from "@/components/tide/kit";
import { VisitDayWeb } from "@/components/tide/v2-visit-web";
import { VisitTicket } from "@/components/tide/visits-ticket";
import { VISITS_COPY as C } from "@/content/patient/visits";
import { VISITS_WEB_COPY as V } from "@/content/patient/visits-web";
import { patientFlag } from "@/lib/patient-web/flags";
import { loadPayStatus, loadQuestions, loadVisitMoney, myMobile } from "@/lib/patient-web/visit-v2";
import { addQuestionAction, markQuestionAction } from "@/lib/patient-web/visit-v2-actions";
import { fetchRebookingOffers } from "@/lib/patient/waitlist";
import { cancellationSentence } from "@/supabase/functions/_shared/cancel-reasons";
import { reasonTitle } from "../_lib/reason";
import { VisitActions } from "../[id]/_components/visit-actions";
import { VisitMoneyCard } from "../[id]/_components/visit-money";

/**
 * One visit inside Visits (the owner's three-page redesign): the day, what it is for and its status word, then
 * the body the old visit page had, unchanged: with `appV2Web` the sideways ticket, quick actions, stages,
 * Questions for the doctor and the money card; otherwise the band, the clinician, the ticket and getting there.
 * Move, cancel and confirm are the booking slice's own. A household member's visit is logistics only.
 */
export async function VisitDetail({ visit, userId }: { visit: VisitRow; userId: string }) {
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
  const head = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-pw-ink-3 text-[13px] font-bold">
          {shortDayOf(key)} · {slot ? clockOf(visit.startsAtIso) : partOf(visit.startsAtIso)}
        </span>
        <h2 className="text-[24px] leading-[30px] font-semibold">{title}</h2>
        <span className="text-pw-ink-3 text-[13px]">
          {visit.forMember ?? V.you} · {visit.departmentName} · {visit.hospitalName}
        </span>
      </div>
      {status ? (
        <span className="bg-pw-surface-2 text-pw-ink-2 shrink-0 rounded-[4px] px-2 py-1 text-[12px] font-bold">
          {status}
        </span>
      ) : null}
    </div>
  );
  // The clinic cancelled the day: the next equivalent day its message offered, one tap away (Gate E).
  const rebook =
    visit.cancelledReason === "session_cancelled"
      ? ((await fetchRebookingOffers([visit.id]).catch(() => null))?.get(visit.id) ?? null)
      : null;

  const actions = (
    <VisitActions
      visitId={visit.id}
      controls={controls}
      live={live}
      answered={visit.confirmedByPatientAtIso !== null}
      rebook={
        visit.cancelledReason === "session_cancelled"
          ? rebook && {
              sessionId: rebook.nextSessionId,
              day: shortDayOf(dayKeyOf(rebook.nextSessionStartsAtIso)),
            }
          : undefined
      }
    />
  );

  // Patient app v2 (W3), behind appV2Web: the sideways ticket, quick actions, stages and Questions for the
  // doctor; the move, cancel and confirm controls are the booking slice's own, unchanged.
  if (patientFlag("appV2Web")) {
    const [pay, questions, rows, msisdn] = await Promise.all([
      loadPayStatus([visit.id]).catch(() => new Map()),
      loadQuestions(visit.id).catch(() => []),
      loadVisitMoney(visit.id, visit.hospitalId).catch(() => null),
      myMobile().catch(() => null),
    ]);
    // Step 6 (P2 to P5): what the visit owes, its receipts and any refund, from the patient's own rows.
    const money = rows
      ? visitMoney({
          appointmentStatus: visit.status,
          startsAtIso: visit.startsAtIso,
          ...rows,
          meUserId: userId,
          patientUserId: visit.forMember ? `member:${visit.forMember}` : userId,
          hospitalName: visit.hospitalName,
          now: new Date(),
        })
      : null;
    const ticket = ticketView(visit, pay.get(visit.id), "You");
    return (
      <>
        {head}
        <div className="flex flex-col gap-6">
          <VisitDayWeb
            ticket={ticket}
            stage={stageOf(visit.status, null)}
            stageTimes={[null, null, null, null, null]}
            questions={questions}
            nurseNote={null}
            directionsHref={maps}
            smsText={`Tether: your code is ${ticket.code}. Show it at the desk.`}
            addQuestion={addQuestionAction.bind(null, visit.id)}
            markQuestion={markQuestionAction}
          />
          {money ? (
            <div className="max-w-2xl">
              <VisitMoneyCard
                appointmentId={visit.id}
                money={money}
                msisdn={msisdn}
                cutoffLabel={money.cancelRule ? kampalaStamp(money.cancelRule.cutoffIso) : null}
              />
            </div>
          ) : null}
          <div className="max-w-2xl">{actions}</div>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="flex max-w-2xl flex-col gap-5">
        <Band className="flex items-start gap-3.5 pr-0">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Pill tone="glass" className="self-start">
              <span aria-hidden className="bg-pw-area-visits size-2 rounded-full" />
              {visit.forMember ? C.bandFor(visit.forMember) : C.bandDept(visit.departmentName)}
            </Pill>
            {place ? <p className="text-pw-on-band-2 text-[17px] font-medium">{place}</p> : null}
            {live ? (
              <p className="text-pw-on-band-2 text-[15px]">{slot ? C.slotNote : C.honest}</p>
            ) : null}
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

        {ended ? <Note>{ended}</Note> : null}
        <VisitActions
          visitId={visit.id}
          controls={controls}
          live={live}
          answered={visit.confirmedByPatientAtIso !== null}
          rebook={
            visit.cancelledReason === "session_cancelled"
              ? rebook && {
                  sessionId: rebook.nextSessionId,
                  day: shortDayOf(dayKeyOf(rebook.nextSessionStartsAtIso)),
                }
              : undefined
          }
        />

        {visit.forMember ? <Note>{C.householdLine(visit.forMember)}</Note> : null}

        {live ? (
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
        ) : null}
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { SmartphoneIcon } from "lucide-react";

import { PrescribeButton } from "@/components/clerking/plan/prescribe-session";
import { buttonVariants } from "@/components/ui/button";
import { LAB2 } from "@/content/lab-phase-2";
import { ncdPerson } from "@/db/schema/ncd-registry";
import { prescribeV2LiveFor } from "@/lib/emr/feature";
import { ncdLabFeedLiveFor } from "@/lib/lab/feature";
import { labFeedFor, visitOutsideResults } from "@/lib/ncd/lab-feed-read";
import { can } from "@/lib/ncdreg/context";
import { withNcd } from "@/lib/ncdreg/db";
import { REVIEW_LABELS } from "@/lib/ncdreg/read/derive";
import { visitView } from "@/lib/ncdreg/read/views";
import { requireNcdScope } from "@/lib/ncdreg/scope";
import { ConditionTags, fmtDate, fmtDateTime, Num, Page, StageLabel } from "../../_components/kit";
import { ClinicianPart } from "./_components/clinician-part";
import { FromTheLab } from "./_components/from-the-lab";
import { NursePart } from "./_components/nurse-part";
import { Trajectory } from "./_components/trajectory";

export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = {
  scheduled: "Scheduled visit",
  unscheduled: "Unscheduled visit",
  refill_only: "Refill only",
  remote: "Remote visit",
};

/** Visit capture (§11.3 item 4, B1–B9): one screen, nurse part and clinician part, no wizard. */
export default async function VisitPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { ctx } = await requireNcdScope();
  const { visitId } = await params;
  const v = await visitView(ctx, visitId);
  if (!v) notFound();
  const { person: pv, visit } = v;
  const regs = pv.modules.map(({ reg, module }) => ({ registrationId: reg.id, module }));
  const glucose = regs.some((r) => r.module.visit_fields.some((f) => f.code === "glucose"));
  const hba1c = regs.some((r) => r.module.visit_fields.some((f) => f.code === "hba1c"));
  const id = pv.identity;
  // Lab Phase 2 §5.9: with ncdLabFeed off, nothing below reads the lab and the page is as before.
  const live = ncdLabFeedLiveFor(ctx.facilityId);
  const [feed, outside] = live
    ? await Promise.all([
        labFeedFor(ctx.facilityId, visit.personId, new Date()),
        visitOutsideResults(ctx.facilityId, visit.id),
      ])
    : [null, []];
  const labA1c = feed?.fields.hba1c?.kind === "filled" ? feed.fields.hba1c.result : null;
  // Kit F1 "NCD clinic": real prescriptions need the person's patient record (a provisional person
  // cannot be prescribed for) and an open visit, which the action finds; the cadre is checked there.
  const patientUserId = prescribeV2LiveFor(ctx.facilityId)
    ? ((
        await withNcd(ctx, "app", (tx) =>
          tx
            .select({ id: ncdPerson.patientUserId })
            .from(ncdPerson)
            .where(eq(ncdPerson.id, visit.personId)),
        )
      )[0]?.id ?? null)
    : null;
  return (
    <Page>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-overline text-muted-foreground uppercase">
            {TYPE[visit.type] ?? visit.type} · {fmtDate(visit.date)}
          </p>
          <h1 className="font-display text-display-s">
            <Link href={`/ncd/patients/${visit.personId}`} className="hover:underline">
              {id.name}
            </Link>
          </h1>
          <p className="text-body-s text-ink-600 flex flex-wrap items-center gap-2">
            <Num>{id.registryNumber}</Num> · {id.sex === "female" ? "F" : "M"} · {id.age} y{" "}
            <ConditionTags
              conditions={pv.modules.map(({ module: m }) => ({ code: m.code, label: m.label }))}
            />
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StageLabel stage={visit.stage as "waiting"} />
          <Link
            href={`/ncd/visit/${visit.id}/nurse`}
            className={buttonVariants({ variant: "secondary" })}
          >
            <SmartphoneIcon aria-hidden /> Phone view
          </Link>
        </div>
      </header>

      <section aria-labelledby="traj-h" className="border-border rounded-xl border p-4">
        <h2 id="traj-h" className="text-heading-s mb-3">
          Where this patient is heading
        </h2>
        <Trajectory
          visits={pv.trajectory.filter((t) => t.id !== visit.id)}
          rows={{ glucose, hba1c }}
          kidney={pv.kidney}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="meas-h" className="border-border rounded-xl border p-4">
            <h2 id="meas-h" className="text-heading-s mb-3">
              Measurements
            </h2>
            <NursePart
              visitId={visit.id}
              personId={visit.personId}
              initial={{ weightKg: visit.weightKg, bp: visit.bp, glucose: visit.glucose }}
              heightCm={v.heightCm}
              glucose={glucose}
              glucoseUnit={v.glucoseUnit}
              closed={visit.status === "closed"}
            />
          </section>
          {feed ? (
            <FromTheLab
              feed={feed}
              outside={outside}
              visitId={visit.id}
              today={ctx.today}
              timeZone={ctx.timeZone}
              canWrite={can(ctx, "clinician_visit_write") && visit.status !== "closed"}
            />
          ) : null}
          <section aria-labelledby="rev-h" className="border-border rounded-xl border p-4">
            <h2 id="rev-h" className="text-heading-s mb-2">
              Review items
            </h2>
            <ul className="flex flex-col gap-1.5">
              {pv.reviews.map((r) => (
                <li
                  key={r.component}
                  className="text-body-s flex items-center justify-between gap-3"
                >
                  <span>{REVIEW_LABELS[r.component]}</span>
                  <span className="text-ink-600 flex items-center gap-2">
                    {r.last ? `last ${fmtDate(r.last)}` : "never recorded"}
                    {r.due ? (
                      <span className="border-ink-300 text-ink-800 rounded-md border px-2 text-[12px]">
                        due
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
              {!pv.reviews.length ? (
                <li className="text-caption text-muted-foreground">
                  No review components for these conditions.
                </li>
              ) : null}
            </ul>
          </section>
        </div>
        <section aria-labelledby="clin-h" className="border-border rounded-xl border p-4">
          <h2 id="clin-h" className="text-heading-s mb-3">
            Clinician entries
          </h2>
          {patientUserId ? (
            <div className="mb-4">
              <PrescribeButton surface="doctor" patientUserId={patientUserId} place="ncd" />
            </div>
          ) : null}
          <ClinicianPart
            visitId={visit.id}
            personId={visit.personId}
            visitDate={visit.date}
            visitType={visit.type}
            stage={visit.stage}
            regs={regs}
            initial={{
              medicines: visit.medicines,
              medicinesOther: visit.medicinesOther,
              confirmedUnchanged: visit.medicinesConfirmedUnchanged,
              missedDoses: visit.missedDoses,
              hypoglycaemia: visit.hypoglycaemia,
              medicinesObtained: visit.medicinesObtained,
              notObtainedReason: visit.notObtainedReason,
              hba1c: visit.hba1c,
              nextAppointmentDate: visit.nextAppointmentDate,
              disposition: visit.disposition,
              observations: visit.observations,
              clinicianSaved: !!visit.clinicianSavedAt,
            }}
            carried={v.carried}
            intervalsWeeks={v.intervalsWeeks}
            extraMedicines={v.extraMedicines}
            nurse={{
              weight: visit.weightKg != null,
              bp: visit.visitBp != null,
              glucose: visit.glucose != null,
            }}
            labFeed={live}
            labHba1c={
              labA1c
                ? {
                    value: `${labA1c.value} ${labA1c.unit}`,
                    source: LAB2.ncd.filled(
                      labA1c.method === "lab" ? "Lab" : "Bedside",
                      fmtDateTime(labA1c.releasedAt, ctx.timeZone),
                    ),
                  }
                : null
            }
          />
        </section>
      </div>
    </Page>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { Tag } from "@/components/medsync/tag";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { db } from "@/db";
import { careRequestResponseVersions as crrv } from "@/db/schema/care-requests";
import { hospitals } from "@/db/schema/hospitals";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { CsoSignTimes } from "./_components/cso-sign-times";

const C = CARE_REQUEST_COPY.times;
export const metadata: Metadata = { title: C.metaCso };
export const dynamic = "force-dynamic";

/** Request response times the hospital admin has signed, waiting for the CSO's countersignature (D4). */
export default async function CareRequestSignoffsPage() {
  const state = await getAuthState();
  if (!state.user || !state.roles.includes("superadmin")) redirect("/admin");
  const waiting = await db
    .select()
    .from(crrv)
    .where(and(eq(crrv.status, "draft"), isNotNull(crrv.adminSignedBy)))
    .orderBy(desc(crrv.createdAt))
    .limit(100);
  const hs = waiting.length
    ? await db
        .select({ id: hospitals.id, name: hospitals.name })
        .from(hospitals)
        .where(inArray(hospitals.id, [...new Set(waiting.map((v) => v.hospitalId))]))
    : [];
  const us = waiting.length
    ? await db
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .where(inArray(users.id, [...new Set(waiting.map((v) => v.adminSignedBy!))]))
    : [];
  const hospital = new Map(hs.map((h) => [h.id, h.name]));
  const person = new Map(us.map((u) => [u.id, u.name]));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading-m">{C.csoTitle}</h1>
      </header>
      {waiting.length === 0 ? (
        <p className="text-body-s text-muted-foreground">{C.csoNone}</p>
      ) : null}
      {waiting.map((v) => (
        <section key={v.id} className="border-border flex flex-col gap-3 rounded-lg border p-4">
          <p className="text-body-s flex flex-wrap items-center gap-2">
            <Tag hue="slate">{C.waitingForCso}</Tag>
            <span className="font-medium">{hospital.get(v.hospitalId) ?? C.hospital}</span>
            <span className="text-muted-foreground">{C.version(v.version)}</span>
          </p>
          <dl className="text-body-s grid gap-x-6 gap-y-1 sm:grid-cols-[18rem_1fr]">
            <dt className="text-muted-foreground">{CARE_REQUEST_COPY.times.reviewNow}</dt>
            <dd className="font-mono tabular-nums">
              {v.reviewNowAcceptMin} {C.unit}
            </dd>
            <dt className="text-muted-foreground">{C.review1h}</dt>
            <dd className="font-mono tabular-nums">
              {v.review1hAcceptMin} {C.unit}
            </dd>
            <dt className="text-muted-foreground">{C.consultUrgent}</dt>
            <dd className="font-mono tabular-nums">
              {v.consultUrgentAcceptMin} {C.unit}
            </dd>
            <dt className="text-muted-foreground">{C.routine}</dt>
            <dd className="font-mono tabular-nums">
              {v.routineReplyMin} {C.unit}
            </dd>
            <dt className="text-muted-foreground">{C.sourceLabel}</dt>
            <dd>{v.source}</dd>
            <dt className="text-muted-foreground">{C.signedByAdmin}</dt>
            <dd>{person.get(v.adminSignedBy!) ?? C.staff}</dd>
          </dl>
          <CsoSignTimes
            hospitalId={v.hospitalId}
            versionId={v.id}
            times={{
              reviewNowAcceptMin: v.reviewNowAcceptMin,
              review1hAcceptMin: v.review1hAcceptMin,
              consultUrgentAcceptMin: v.consultUrgentAcceptMin,
              routineReplyMin: v.routineReplyMin,
            }}
            sameAsAdmin={v.adminSignedBy === state.user!.id}
          />
        </section>
      ))}
    </div>
  );
}

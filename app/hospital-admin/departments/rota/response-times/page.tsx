import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { Tag } from "@/components/medsync/tag";
import { ResponseTimesForm } from "@/components/requests/response-times-form";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { db } from "@/db";
import { careRequestResponseVersions as crrv } from "@/db/schema/care-requests";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { saveTimesDraftAction, signTimesAsAdminAction } from "./actions";

const C = CARE_REQUEST_COPY.times;
export const metadata: Metadata = { title: C.metaAdmin };
export const dynamic = "force-dynamic";

const times = (v: typeof crrv.$inferSelect) => ({
  reviewNowAcceptMin: v.reviewNowAcceptMin,
  review1hAcceptMin: v.review1hAcceptMin,
  consultUrgentAcceptMin: v.consultUrgentAcceptMin,
  routineReplyMin: v.routineReplyMin,
});

/** The hospital admin's response times for requests (D4): the signed set, and a draft to save and sign. */
export default async function ResponseTimesPage() {
  const scope = await requireHospitalAdminScope();
  const rows = await db
    .select()
    .from(crrv)
    .where(eq(crrv.hospitalId, scope.hospitalId))
    .orderBy(desc(crrv.version));
  const signed = rows.find((v) => v.status === "signed");
  const draft = rows.find((v) => v.status === "draft");
  const waiting = draft?.adminSignedBy ? draft : null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-display-s text-foreground">{C.title}</h1>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="text-heading-s">{C.inForce}</h2>
        {signed ? (
          <p className="text-body-s font-mono tabular-nums">
            {signed.reviewNowAcceptMin} / {signed.review1hAcceptMin} /{" "}
            {signed.consultUrgentAcceptMin} / {signed.routineReplyMin} {C.unit}
          </p>
        ) : (
          <p className="text-body-s text-muted-foreground">{C.none}</p>
        )}
      </section>
      {waiting ? (
        <p className="text-body-s flex items-center gap-2">
          <Tag hue="slate">{C.waitingForCso}</Tag>
          <span className="font-mono tabular-nums">
            {waiting.reviewNowAcceptMin} / {waiting.review1hAcceptMin} /{" "}
            {waiting.consultUrgentAcceptMin} / {waiting.routineReplyMin} {C.unit}
          </span>
        </p>
      ) : (
        <ResponseTimesForm
          draft={draft ? { id: draft.id, times: times(draft), source: draft.source } : null}
          onSave={saveTimesDraftAction}
          onSign={(versionId, t) => signTimesAsAdminAction({ versionId, ...t })}
        />
      )}
    </div>
  );
}

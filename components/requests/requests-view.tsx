"use client";

import type { RequestDetail, RequestRow } from "@/lib/emr/read/requests";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { ago } from "@/lib/workspace/words";
import { kindWords, RequestDialog, StateTags } from "./request-dialog";

/**
 * The request lists (ADR 0537): Asked of you, For your department, Sent by you. Each row reads the
 * patient and ward, from whom, the question's first line, its age and its state, with one action,
 * Open, which shows the request (`?request=<id>`). A restricted request without a chart basis is
 * never named. `?view=department` scrolls to the second list.
 */

const P = CARE_REQUEST_COPY.page;
type Surface = "doctor" | "clinician";
type ListId = keyof typeof P.sections;

function RequestLine({
  row,
  list,
  now,
  base,
}: {
  row: RequestRow;
  list: ListId;
  now: number;
  base: string;
}) {
  const place = [row.patientName ?? P.hiddenPatient, row.mrn, row.wardName].filter(Boolean);
  return (
    <li className="border-border bg-card flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-body-m text-foreground">{place.join(" · ")}</span>
          <StateTags row={row} />
        </div>
        <span className="text-caption text-muted-foreground">
          {kindWords(row)} ·{" "}
          {list === "sent"
            ? P.to(row.departmentName)
            : P.from(row.requesterName ?? CARE_REQUEST_COPY.read.someone, row.requesterCadre)}{" "}
          · {P.asked(ago(now - row.askedAtMs))}
        </span>
        {row.questionFirstLine ? (
          <p className="text-body-s text-foreground truncate">{row.questionFirstLine}</p>
        ) : null}
      </div>
      <Link
        href={`${base}?request=${row.id}${list === "department" ? "&view=department" : ""}`}
        scroll={false}
        className="border-border bg-card text-label hover:bg-muted inline-flex min-h-9 shrink-0 items-center self-start rounded-full border px-4 sm:self-center"
      >
        {P.open}
      </Link>
    </li>
  );
}

export function RequestsView({
  surface,
  asked,
  department,
  sent,
  now,
  detail = null,
  departments = [],
}: {
  surface: Surface;
  asked: RequestRow[];
  department: RequestRow[];
  sent: RequestRow[];
  now: number;
  /** The request named by `?request=`, when the viewer may read it. */
  detail?: RequestDetail | null;
  departments?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const view = useSearchParams().get("view");
  const base = `/${surface}/requests`;

  useEffect(() => {
    if (view === "department") document.getElementById("department")?.scrollIntoView();
  }, [view]);

  const lists: [ListId, RequestRow[]][] = [
    ["asked", asked],
    ["department", department],
    ["sent", sent],
  ];

  return (
    <div className="flex flex-col gap-8">
      {lists.map(([id, rows]) => (
        <section
          key={id}
          id={id}
          aria-labelledby={`${id}-title`}
          className="flex scroll-mt-20 flex-col gap-3"
        >
          <h2 id={`${id}-title`} className="text-heading-s text-foreground">
            {P.sections[id]}
          </h2>
          {rows.length ? (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <RequestLine key={r.id} row={r} list={id} now={now} base={base} />
              ))}
            </ul>
          ) : (
            <p className="text-body-s text-muted-foreground">{P.empty[id]}</p>
          )}
        </section>
      ))}
      {detail ? (
        <RequestDialog
          key={detail.id}
          detail={detail}
          surface={surface}
          now={now}
          departments={departments}
          onClose={() => router.replace(view ? `${base}?view=${view}` : base, { scroll: false })}
        />
      ) : null}
    </div>
  );
}

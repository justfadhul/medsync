"use client";

import type { EuListData } from "@/components/wards/board/eu-list";
import type { BoardData } from "@/lib/wards/board";

import { BedBoard } from "@/components/wards/board/bed-board";

const no = async () => ({
  ok: false as const,
  error: "Bed changes are made by the ward's nurses.",
});
// The doctor reads the board; nothing here acts on a bed (mayAct is off, the actions are never called).
const ACTIONS = {
  setState: no,
  assign: no,
  release: no,
  allocate: no,
  confirmArrival: no,
  releaseAdmission: no,
};
const LINKS = {
  crumbs: [{ label: "Doctor", href: "/doctor" }],
  board: (id: string) => `/doctor/eu?ward=${id}`,
  layout: null,
};

/** The EU board for a doctor: the plan always, the list only for the EU doctor on duty (`eu` set). */
export function DoctorEuBoard({
  data,
  hospitalId,
  eu = null,
}: {
  data: BoardData;
  hospitalId: string;
  eu?: { data: EuListData; nowMs: number; triageSystem: string | null } | null;
}) {
  return (
    <BedBoard
      data={data}
      hospitalId={hospitalId}
      mayAct={false}
      actions={ACTIONS}
      links={LINKS}
      fit="frame"
      eu={eu ? { ...eu, links: { resus: () => "/doctor/resus" } } : undefined}
    />
  );
}

"use client";

import type { EuListData } from "@/components/wards/board/eu-list";
import type { BoardData } from "@/lib/wards/board";

import { BedBoard } from "@/components/wards/board/bed-board";
import {
  nurseAllocateAdmissionBed,
  nurseAssignBed,
  nurseConfirmArrival,
  nurseMoveEuSpace,
  nurseReleaseAdmissionBed,
  nurseReleaseBed,
  nurseSetBedState,
} from "./actions";

const ACTIONS = {
  setState: nurseSetBedState,
  assign: nurseAssignBed,
  release: nurseReleaseBed,
  allocate: nurseAllocateAdmissionBed,
  confirmArrival: nurseConfirmArrival,
  releaseAdmission: nurseReleaseAdmissionBed,
  moveEu: nurseMoveEuSpace,
};
const LINKS = {
  crumbs: [{ label: "Nursing", href: "/nurse" }],
  board: (id: string) => `/nurse/beds?ward=${id}`,
  layout: null,
};

/** Every ward listed here is one the nurse works on, so they may act on it (the server re-checks). */
export function NurseBoardClient({
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
      mayAct
      actions={ACTIONS}
      links={LINKS}
      eu={eu ? { ...eu, links: { resus: (id) => `/nurse/resus/${id}` } } : undefined}
    />
  );
}

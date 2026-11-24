"use client";

import type { BoardData } from "@/lib/wards/board";

import { BedBoard } from "@/components/wards/board/bed-board";
import {
  nurseAllocateAdmissionBed,
  nurseAssignBed,
  nurseConfirmArrival,
  nurseReleaseAdmissionBed,
  nurseMoveEuSpace,
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
export function NurseBoardClient({ data, hospitalId }: { data: BoardData; hospitalId: string }) {
  return <BedBoard data={data} hospitalId={hospitalId} mayAct actions={ACTIONS} links={LINKS} />;
}

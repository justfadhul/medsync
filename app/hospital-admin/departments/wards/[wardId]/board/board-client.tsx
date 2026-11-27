"use client";

import type { EuListData } from "@/components/wards/board/eu-list";
import type { BoardData } from "@/lib/wards/board";

import { BedBoard } from "@/components/wards/board/bed-board";
import { WARDS } from "@/content/hospital-admin/wards";
import {
  adminAllocateAdmissionBed,
  adminAssignBed,
  adminConfirmArrival,
  adminMoveEuSpace,
  adminReleaseAdmissionBed,
  adminReleaseBed,
  adminSetBedState,
} from "../actions";

const HUB = "/hospital-admin/departments";

const ACTIONS = {
  setState: adminSetBedState,
  assign: adminAssignBed,
  release: adminReleaseBed,
  allocate: adminAllocateAdmissionBed,
  confirmArrival: adminConfirmArrival,
  releaseAdmission: adminReleaseAdmissionBed,
  moveEu: adminMoveEuSpace,
};
const LINKS = {
  crumbs: [{ label: WARDS.builder.crumb, href: `${HUB}/wards` }],
  board: (id: string) => `${HUB}/wards/${id}/board`,
  layout: (id: string) => `${HUB}/wards/${id}/layout`,
};

/** The live bed board in the admin frame (phase 2 of ADR 0520): the same board, filling the frame's page. */
export function BoardClient({
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
      fit="frame"
      // The admin has no resus desk: the list shows no resus link.
      eu={eu ? { ...eu, links: { resus: () => null } } : undefined}
    />
  );
}

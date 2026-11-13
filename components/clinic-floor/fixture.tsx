"use client";

import type { Role } from "@/lib/clinic-floor/fixture";
import { useMemo } from "react";

import { busyMorning, firstRun } from "@/lib/clinic-floor/fixture";
import { ClinicFloor } from "./floor";
import { fixturePort } from "./port";

/** The floor on fixture data: the port answers locally and writes nothing. */
export function FloorFixture({
  role,
  scenario,
}: {
  role: Role;
  scenario: "first" | "offline" | null;
}) {
  const data = useMemo(
    () => (scenario === "first" ? firstRun(role) : busyMorning(role)),
    [role, scenario],
  );
  return (
    <ClinicFloor
      key={`${role}${scenario}`}
      data={data}
      port={fixturePort}
      offline={scenario === "offline"}
    />
  );
}

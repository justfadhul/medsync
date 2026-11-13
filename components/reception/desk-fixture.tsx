"use client";

import type { DeskData } from "@/lib/reception/desk/fixture";
import { useMemo } from "react";

import { Desk } from "./desk";
import { fixturePort } from "./port";

/** The desk on fixture data: the port answers locally and writes nothing. */
export function DeskFixture({ data }: { data: DeskData }) {
  const port = useMemo(() => fixturePort(data.demoIdentity ?? {}), [data.demoIdentity]);
  return <Desk data={data} port={port} />;
}

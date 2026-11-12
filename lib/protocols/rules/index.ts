import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { ChartVersion } from "@/lib/protocols/engine/types";

import art from "./art";
import dka from "./dka";
import hhs from "./hhs";
import htn from "./htn";
import hyperk from "./hyperk";
import mgso4 from "./mgso4";
import nac from "./nac";
import op from "./op";
import se from "./se";
import ssi from "./ssi";
import { stepsModule } from "./steps";

/**
 * One rule module a protocol (prescribing kit P4/P5): the prototype's `PC.<id>.build(K)`. A module
 * reads every number from its version (`seed`, `rules`); `check` names what the version lacks, and
 * then the chart cannot run. A protocol with no module of its own (the builder's) charts its steps.
 */
export interface RuleModule {
  id: string;
  short: (v: ChartVersion) => string;
  check: (v: ChartVersion) => string | null;
  build: (K: Kit) => Built;
}

export const RULE_MODULES: Readonly<Record<string, RuleModule>> = {
  dka,
  hhs,
  hyperk,
  htn,
  mgso4,
  art,
  se,
  op,
  nac,
  ssi,
};

export function moduleFor(v: ChartVersion): RuleModule {
  const id = (v.rules as { module?: string | null } | null)?.module;
  return (id && RULE_MODULES[id]) || stepsModule;
}

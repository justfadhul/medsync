import type { RuleModule } from "./index";

import { stepsModule } from "./steps";

/**
 * A P4 stub: the protocol charts its version's step list (doses, times, checks, bands from the
 * version) until P5 ports its full rule sheet into its own module. It refuses a version written for
 * another module.
 */
export function stub(id: string): RuleModule {
  return {
    ...stepsModule,
    id,
    check: (v) =>
      (v.rules as { module?: string | null } | null)?.module === id
        ? stepsModule.check(v)
        : `This version is not a ${id} protocol.`,
  };
}

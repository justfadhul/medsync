/**
 * Ids that tie a stepper tab to the panel it controls.
 *
 * They live apart from the component because aria-controls and aria-labelledby
 * both take a space-separated list of ids, so an id must never contain a space.
 * Generate the prefix with useId and pass the same value to both ends.
 */

/** The id of the tab for a step. */
export function stepTabId(idPrefix: string, n: number): string {
  return `${idPrefix}-tab-${n}`;
}

/** The id of the panel that tab controls. */
export function stepPanelId(idPrefix: string, n: number): string {
  return `${idPrefix}-panel-${n}`;
}

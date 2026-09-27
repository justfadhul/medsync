# ADR 0136 — Results: versioned reports, acknowledgement, critical communication

**Status:** Accepted — 2026-09-26. GATE A D-EMR-06, D-EMR-07, D-EMR-08, E8. No critical definition is signed yet, so MedSync flags nothing critical in production.

## Context

`encounter_orders`/`encounter_results` and the `/lab` enter/release actions existed (0050/51, `LAB_RESULTS_LIVE`), but there was no acknowledgement, release was not transactional, and "abnormal" was treated as "critical" (R3, partly refuted: the order–result link existed).

## Decision

1. **Orders evolve** (`encounter_orders.lifecycle`): existing rows are `legacy` and keep their mutable status; new orders are `events` and move only through immutable `encounter_order_events` (placed, collected, received, rejected). **Specimens** (`specimens`, `specimen_events`) need two identifiers and carry the fasting chip. A property test holds "nothing ordered disappears" over 400 seeds.
2. **Versioned `diagnostic_reports`.** Result values are `clinical_observations` rows with `report_id`. `/lab` under `EMR_V1` is re-pointed: enter = a preliminary report, release = a final version, amend = a new version — each one transaction (`lib/emr/write/results.ts`). Legacy `encounter_results` are projected read-only.
3. **Acknowledgement per report version** (`result_acknowledgements`): the orderer or their cover acknowledges; an amendment needs re-acknowledgement. Only events-lifecycle orders enter Results to review; legacy `resulted` orders never do.
4. **Critical results.** `critical_result_communications` records who told whom, how, when, and the read-back. MedSync flags a value critical **only from a signed REF-CRIT entry** (`lib/emr/reference/critical.ts`, all `pending_cso`). The laboratory's own flag is shown as text. The escalation timer shows no number until REF-CRIT-TIMEFRAME is signed: a shipped time frame answers `timeframe_not_signed`.
5. **Lanes [H]:** Critical results after Resus, Results to review after In progress, To co-sign after it (hotkeys 8, 9, 0; 1–7 unchanged), added as `LaneId` + `LANES` + FW-2 branch + loader. The 400-seed flow property test stays green.
6. **Red on the value only.** `components/emr/status-word.tsx` is the one place a critical value turns red, and only when the payload says critical; everything awaiting is amber.

## Consequences

- Scenarios A1 and A3 green: A3 ran with a TEST-signed entry (flag, communication, lane, acknowledgement clears it; TEST-signed and elapsed → escalate).
- **Fixed at gate STOP 4:** the chart styled a critical value as critical only when its context was complete, so a critical glucose with an unknown fasting state would have lost its alarm. Missing context never hides an alarm now (test added).
- Tests: 442 orders, 76 results; UI 41 orders + results tests; `/doctor/results` batch acknowledgement.
- **Before switching `EMR_V1` on:** `/lab` lists only events-lifecycle orders, so drain legacy in-flight orders first.
- **Open for the CSO:** a covering clinician sees "Restricted result" with a lock and can still acknowledge it.
- **Not built:** any signed critical limit or time frame; the nurse chart's orders panel.

## Alternatives considered

- **Keep abnormal ≡ critical** — alarms without a signed definition train people to ignore red.
- **Acknowledge per order** — an amended result would pass silently.

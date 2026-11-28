---
name: feedback-centred-popups
description: "Owner rule (2026-09-26): every pop-up is a centred landscape dialog (EditorDialog), never a side sheet or drawer"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 722bf4f9-1246-49d3-8449-3b25771c25dc
  modified: 2026-09-26T14:15:37.983Z
---

Every pop-up in MedSync is a centred, landscape card, `components/medsync/editor-dialog.tsx` (`EditorDialog`). This covers detail panels, editors, catalogues and forms that open over a page.

- Use `wide` with sections side by side for panels, and `medium` for short forms.
- Nothing slides in from an edge. The phone navigation menu is the only exception.

**Why:** the owner saw the Departments & services hub's right-side panels and said to remove them, and to make it a rule that pop-ups are only centred, in landscape, "just like how we've been doing for the previous things" (the scheduling console and the doctor and clinician schedules already used EditorDialog).

**How to apply:**

- Never reach for `SheetContent` with a side for new UI. Use EditorDialog with the Sheet's header, body and footer pieces.
- It's recorded in ADR 0161, DESIGN-medsync.md ("Pop-ups") and AGENTS.md.
- The side sheets that remain (Staff, the superadmin console, the doctor workspace's panel and triage sheets, responsive-sheet) move to the card when next touched.

Related: [[services-hub-build-state]] [[medsync-owner-rules]]

"use client";

import type { WardFields } from "./inspector";
import type { RowSettings } from "./palette";
import type { Lens, PlanGhost } from "@/components/wards/plan/plan-view";
import type { LayoutEditorData } from "@/lib/wards/data";
import type { ItemKind, ItemRef, Tool } from "@/lib/wards/editor";
import type { History } from "@/lib/wards/history";
import type { Preset } from "@/lib/wards/presets";
import type {
  DividerKind,
  LayoutBed,
  LayoutFixture,
  Rect,
  Rotation,
  WardLayout,
} from "@/supabase/functions/_shared/ward-layout";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Grid3x3Icon, Redo2Icon, Undo2Icon, XIcon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Tag } from "@/components/medsync/tag";
import { ViewSwitcher } from "@/components/medsync/view-switcher";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  SheetBody,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CELL, planAspect, PlanView } from "@/components/wards/plan/plan-view";
import { PlanZoomControls, PlanZoomFrame, usePlanZoom } from "@/components/wards/plan/plan-zoom";
import { WardHeader } from "@/components/wards/ward-header";
import { WARDS } from "@/content/hospital-admin/wards";
import { cn } from "@/lib/utils";
import { layoutChecks } from "@/lib/wards/checks";
import {
  addDivider,
  findItem,
  findRoom,
  ghostRect,
  itemsInBox,
  moveMany,
  moveTo,
  nudge,
  place,
  positionOf,
  remove,
  removeMany,
  resizeRoom,
  rotate,
  rotateEach,
  rotateTo,
  rotationFromDrag,
  sameRef,
  selectAll,
  setDividerEnd,
  toggleRef,
  unionRefs,
} from "@/lib/wards/editor";
import {
  canRedo,
  canUndo,
  commit,
  historyInit,
  redo,
  replace,
  settle,
  undo,
} from "@/lib/wards/history";
import { isMacPlatform, planKeyAction, rootKeyAction, shortcutWords } from "@/lib/wards/keys";
import { presetsFor } from "@/lib/wards/presets";
import { reconcile } from "@/lib/wards/reconcile";
import {
  bedRect,
  emptyLayout,
  fixtureRect,
  FLOOR_DEFAULT,
  renumberBeds,
  rowOfBeds,
  snapDivider,
} from "@/supabase/functions/_shared/ward-layout";
import { CautionNote } from "../ui";
import { GroupInspector, SelectionInspector, WardInspector } from "./inspector";
import { ItemsList } from "./items-list";
import { Palette } from "./palette";
import { PublishDialog } from "./publish-dialog";

/* ─── the contract with the page ────────────────────────────────────── */

export type SaveDraftResult =
  | { ok: true; revision: number }
  | { ok: false; error: string; conflict: boolean };
export type PublishResult =
  | { ok: true; bedCount: number; version: number }
  | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

export interface EditorActions {
  saveDraft: (
    wardId: string,
    document: WardLayout,
    baseRevision: number | null,
  ) => Promise<SaveDraftResult>;
  publish: (wardId: string, acceptedWarnings: string[]) => Promise<PublishResult>;
  startFromRegister: (wardId: string) => Promise<SimpleResult>;
  discardDraft: (wardId: string) => Promise<SimpleResult>;
  saveWard: (
    wardId: string,
    fields: {
      name: string;
      department_id: string;
      ward_type: string | null;
      sex: string | null;
      age_group: string | null;
      place_id: string | null;
      bed_count: number;
    },
  ) => Promise<SimpleResult>;
}

export interface EditorLinks {
  hub: string;
  wards: string;
  /** The breadcrumb before the ward's name; the default is Hospital admin › Departments & services › Wards. */
  crumbs?: { label: string; href?: string }[];
  layout: (wardId: string) => string;
  board: (wardId: string) => string;
  newWard: string;
}

const noSubscribe = () => () => {};

/** The draft saves this long after the last change (the prompt's 2 s). */
export const AUTOSAVE_MS = 2000;

/* ─── state ─────────────────────────────────────────────────────────── */

interface State {
  h: History<WardLayout> | null;
  /** What is selected: one item, several (a box or Shift+click), or none. */
  sel: ItemRef[];
  tool: Tool;
  anchor: { x: number; y: number } | null;
  hover: { fx: number; fy: number } | null;
  lens: Lens;
  grid: boolean;
  view: "plan" | "items";
  row: RowSettings;
}

type Action =
  | { type: "edit"; doc: WardLayout; select?: ItemRef | ItemRef[] | null }
  | { type: "transient"; doc: WardLayout }
  | { type: "settle"; before: WardLayout }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: WardLayout | null }
  | { type: "select"; ref: ItemRef | null }
  | { type: "selectMany"; refs: ItemRef[] }
  | { type: "toggle"; ref: ItemRef }
  | { type: "tool"; tool: Tool }
  | { type: "anchor"; at: { x: number; y: number } | null }
  | { type: "hover"; at: { fx: number; fy: number } | null }
  | { type: "lens"; lens: Lens }
  | { type: "grid" }
  | { type: "view"; view: "plan" | "items" }
  | { type: "row"; row: RowSettings };

const asSel = (x: ItemRef | ItemRef[] | null): ItemRef[] => (!x ? [] : Array.isArray(x) ? x : [x]);

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "edit":
      if (!s.h) return s;
      return {
        ...s,
        h: commit(s.h, a.doc),
        sel: a.select === undefined ? s.sel : asSel(a.select),
      };
    case "transient":
      return s.h ? { ...s, h: replace(s.h, a.doc) } : s;
    case "settle":
      return s.h ? { ...s, h: settle(s.h, a.before) } : s;
    case "undo":
      return s.h && canUndo(s.h) ? { ...s, h: undo(s.h), sel: [] } : s;
    case "redo":
      return s.h && canRedo(s.h) ? { ...s, h: redo(s.h), sel: [] } : s;
    case "reset":
      return {
        ...s,
        h: a.doc ? historyInit(a.doc) : null,
        sel: [],
        tool: "select",
        anchor: null,
        hover: null,
      };
    case "select":
      return { ...s, sel: asSel(a.ref) };
    case "selectMany":
      return { ...s, sel: a.refs };
    case "toggle":
      return { ...s, sel: toggleRef(s.sel, a.ref) };
    case "tool":
      return {
        ...s,
        tool: a.tool,
        anchor: null,
        hover: null,
        sel: a.tool === "select" ? s.sel : [],
      };
    case "anchor":
      return { ...s, anchor: a.at };
    case "hover":
      return { ...s, hover: a.at };
    case "lens":
      return { ...s, lens: a.lens };
    case "grid":
      return { ...s, grid: !s.grid };
    case "view":
      return { ...s, view: a.view };
    case "row":
      return { ...s, row: a.row };
  }
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saved"; at: string }
  | { kind: "saving" }
  | { kind: "published"; at: string; beds: number }
  | { kind: "error"; message: string; conflict: boolean };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });

const LENSES: { value: Lens; label: string }[] = [
  { value: "none", label: "Plan" },
  { value: "o2", label: "Oxygen" },
  { value: "suction", label: "Suction" },
  { value: "monitor", label: "Monitors" },
  { value: "out", label: "Out of service" },
];

/* ─── the editor ────────────────────────────────────────────────────── */

export function WardEditor({
  data,
  actions,
  links,
  initial,
  fit = "screen",
}: {
  data: LayoutEditorData;
  actions: EditorActions;
  links: EditorLinks;
  /** Where the editor opens (the styleguide fixtures use it; the page doesn't). */
  initial?: { selected?: ItemRef | null; view?: "plan" | "items"; lens?: Lens; tool?: Tool };
  /** `frame`: fill the admin frame's page (phase 2 of ADR 0520) instead of the screen under a 3rem top bar. */
  fit?: "screen" | "frame";
}) {
  const router = useRouter();
  const wardId = data.ward.id;
  const [state, dispatch] = useReducer(
    reducer,
    data.doc,
    (doc): State => ({
      h: doc ? historyInit(doc) : null,
      sel: asSel(initial?.selected ?? null),
      tool: initial?.tool ?? "select",
      anchor: null,
      hover: null,
      lens: initial?.lens ?? "none",
      grid: true,
      view: initial?.view ?? "plan",
      row: { n: 6, gap: 2, face: "top", curtains: true, o2: false },
    }),
  );
  const doc = state.h?.present ?? null;
  // Only what still exists (an undo can take an item away); one item is "selected", with handles.
  const selection = doc ? state.sel.filter((r) => findItem(doc, r)) : [];
  const selected = selection.length === 1 ? selection[0]! : null;

  /* ── saving: what renders comes from state; the refs only serve the async save ── */
  const [savedDoc, setSavedDoc] = useState<WardLayout | null>(data.doc);
  const [hasDraft, setHasDraft] = useState(!!data.draft);
  const [save, setSave] = useState<SaveState>(
    data.draft ? { kind: "saved", at: data.draft.savedAt } : { kind: "idle" },
  );
  const unsaved = !!doc && doc !== savedDoc;
  const live = useRef({ doc, savedDoc, revision: data.draft?.revision ?? null });
  useEffect(() => {
    live.current.doc = doc;
    live.current.savedDoc = savedDoc;
  });
  const inFlight = useRef<Promise<boolean> | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const sent = live.current.doc;
    if (!sent || sent === live.current.savedDoc) return true;
    setSave({ kind: "saving" });
    const p = actions.saveDraft(wardId, sent, live.current.revision).then((r) => {
      if (r.ok) {
        live.current.revision = r.revision;
        live.current.savedDoc = sent;
        setSavedDoc(sent);
        setHasDraft(true);
        setSave({ kind: "saved", at: new Date().toISOString() });
        return true;
      }
      setSave({ kind: "error", message: r.error, conflict: r.conflict });
      return false;
    });
    inFlight.current = p;
    const ok = await p;
    inFlight.current = null;
    return ok;
  }, [actions, wardId]);

  // The draft saves 2 s after the last change; a conflict stops autosave until the page reloads.
  const conflicted = save.kind === "error" && save.conflict;
  useEffect(() => {
    if (!doc || doc === savedDoc || conflicted) return;
    const t = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [doc, savedDoc, conflicted, flush]);

  // A publish, a start from the register or a discard: once the server's data arrives, take its
  // document as the new start (adjusting state while rendering, not in an effect).
  const [adopt, setAdopt] = useState(false);
  const [seen, setSeen] = useState(data);
  if (seen !== data) {
    setSeen(data);
    if (adopt) {
      setAdopt(false);
      setSavedDoc(data.doc);
      setHasDraft(!!data.draft);
      dispatch({ type: "reset", doc: data.doc });
    }
  }
  useEffect(() => {
    if (seen === data && !adopt) live.current.revision ??= data.draft?.revision ?? null;
  }, [seen, data, adopt]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  /* ── leaving with unsaved changes asks first ── */
  const [leaving, setLeaving] = useState<string | null>(null);
  const onNavigate = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!unsaved && save.kind !== "saving") return;
    e.preventDefault();
    setLeaving(href);
  };

  /* ── the plan ── */
  const edit = (next: WardLayout, select?: ItemRef | null) =>
    dispatch({ type: "edit", doc: next, select });
  const svgRef = useRef<SVGSVGElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const zoom = usePlanZoom();
  const drag = useRef<{
    ref: ItemRef;
    mode: "move" | "resize" | "end1" | "end2" | "rotate" | "group";
    ox: number;
    oy: number;
    before: WardLayout;
    moved: boolean;
    /** Rotate: the item's middle (cells), the pointer's angle about it, and its rotation, at the start. */
    pivot?: { cx: number; cy: number; a0: number; rot0: Rotation };
    /** Group: everything that moves together. */
    refs?: ItemRef[];
  } | null>(null);
  /** A box being drawn across empty floor, and what was selected before it (Shift adds to it). */
  const boxDrag = useRef<{ x0: number; y0: number; base: ItemRef[] } | null>(null);
  const [box, setBox] = useState<Rect | null>(null);

  const toCell = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { fx: p.x / CELL, fy: p.y / CELL };
  };

  const placeAt = (cell: { x: number; y: number }, line: { x: number; y: number }) => {
    if (!doc) return;
    const tool = state.tool;
    if (tool === "select") return;
    if (tool === "row") {
      const r = rowOfBeds(doc, { ...state.row, x: cell.x, y: cell.y });
      if (r.beds.length)
        edit(
          { ...doc, beds: [...doc.beds, ...r.beds], dividers: [...doc.dividers, ...r.dividers] },
          null,
        );
      dispatch({ type: "tool", tool: "select" });
      return;
    }
    if (tool.startsWith("divider:")) {
      const kind = tool.slice(8) as DividerKind;
      if (!state.anchor) return dispatch({ type: "anchor", at: line });
      const end = snapDivider(state.anchor, line);
      const r = addDivider(doc, kind, state.anchor, { x: end.x2, y: end.y2 });
      dispatch({ type: "anchor", at: null });
      if (r) edit(r.doc, r.ref);
      return;
    }
    const r = place(doc, tool as Parameters<typeof place>[1], cell, line);
    edit(r.doc, r.ref);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!doc || e.button !== 0) return;
    planRef.current?.focus({ preventScroll: true });
    const p = toCell(e);
    if (!p) return;
    const el = e.target as Element;
    const handle = el.closest("[data-handle]")?.getAttribute("data-handle");
    if (handle && selected && state.tool === "select") {
      let pivot: NonNullable<typeof drag.current>["pivot"];
      if (handle === "rotate") {
        const item =
          selected.kind === "bed"
            ? doc.beds.find((b) => b.key === selected.key)
            : doc.fixtures.find((f) => f.key === selected.key);
        if (!item) return;
        const r =
          selected.kind === "bed" ? bedRect(item as LayoutBed) : fixtureRect(item as LayoutFixture);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        pivot = { cx, cy, a0: Math.atan2(p.fy - cy, p.fx - cx), rot0: item.rot };
      }
      drag.current = {
        ref: selected,
        mode: handle as "resize" | "end1" | "end2" | "rotate",
        ox: 0,
        oy: 0,
        before: doc,
        moved: false,
        pivot,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (state.tool === "select") {
      const raw = el.closest("[data-ref]")?.getAttribute("data-ref");
      if (!raw) {
        // Empty floor: draw a box. Shift keeps what is selected and adds to it.
        boxDrag.current = { x0: p.fx, y0: p.fy, base: e.shiftKey ? selection : [] };
        if (!e.shiftKey) dispatch({ type: "select", ref: null });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const [kind, key] = raw.split(":") as [ItemKind, string];
      const ref = { kind, key };
      // Shift+click adds the item to the selection, or takes it out.
      if (e.shiftKey) return dispatch({ type: "toggle", ref });
      // Dragging one of several selected items moves them all.
      if (selection.length > 1 && selection.some((r) => sameRef(r, ref))) {
        drag.current = {
          ref,
          mode: "group",
          ox: p.fx,
          oy: p.fy,
          before: doc,
          moved: false,
          refs: selection,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      dispatch({ type: "select", ref });
      const pos = positionOf(doc, ref)!;
      drag.current = {
        ref,
        mode: "move",
        ox: p.fx - pos.x,
        oy: p.fy - pos.y,
        before: doc,
        moved: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    placeAt(
      { x: Math.floor(p.fx), y: Math.floor(p.fy) },
      { x: Math.round(p.fx), y: Math.round(p.fy) },
    );
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = toCell(e);
    if (!p || !doc) return;
    const b = boxDrag.current;
    if (b) {
      // A box only once the pointer has really moved (a click on empty floor just clears).
      if (Math.abs(p.fx - b.x0) < 0.25 && Math.abs(p.fy - b.y0) < 0.25 && !box) return;
      const r = {
        x: Math.min(b.x0, p.fx),
        y: Math.min(b.y0, p.fy),
        w: Math.abs(p.fx - b.x0),
        h: Math.abs(p.fy - b.y0),
      };
      setBox(r);
      dispatch({ type: "selectMany", refs: unionRefs(b.base, itemsInBox(doc, r)) });
      return;
    }
    const d = drag.current;
    if (d) {
      let next: WardLayout;
      if (d.mode === "move")
        next = moveTo(d.before, d.ref, Math.round(p.fx - d.ox), Math.round(p.fy - d.oy));
      else if (d.mode === "group" && d.refs)
        next = moveMany(d.before, d.refs, Math.round(p.fx - d.ox), Math.round(p.fy - d.oy));
      else if (d.mode === "rotate" && d.pivot) {
        const a = Math.atan2(p.fy - d.pivot.cy, p.fx - d.pivot.cx);
        next = rotateTo(d.before, d.ref, rotationFromDrag(d.pivot.rot0, d.pivot.a0, a));
      } else if (d.mode === "resize") {
        const r = findRoom(d.before, d.ref.key)!;
        next = resizeRoom(d.before, d.ref.key, Math.round(p.fx) - r.x, Math.round(p.fy) - r.y);
      } else
        next = setDividerEnd(d.before, d.ref.key, d.mode === "end1" ? 1 : 2, {
          x: Math.round(p.fx),
          y: Math.round(p.fy),
        });
      if (next !== doc) {
        d.moved = true;
        dispatch({ type: "transient", doc: next });
      }
      return;
    }
    if (state.tool !== "select") {
      const h = state.hover;
      if (
        !h ||
        Math.round(h.fx * 2) !== Math.round(p.fx * 2) ||
        Math.round(h.fy * 2) !== Math.round(p.fy * 2)
      )
        dispatch({ type: "hover", at: p });
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (boxDrag.current) {
      boxDrag.current = null;
      setBox(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) dispatch({ type: "settle", before: d.before });
  };

  /* ── keys (ADR 0195): on the root and the plan, never global ── */
  const mac = useSyncExternalStore(
    noSubscribe,
    () => isMacPlatform(navigator.platform || navigator.userAgent || ""),
    () => false,
  );
  const words = shortcutWords(mac);

  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const act = rootKeyAction(e, { live: false });
    if (!act) return;
    e.preventDefault();
    dispatch({ type: act });
  };

  const onPlanKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!doc) return;
    const act = planKeyAction(e, {
      live: false,
      selected: selection.length > 0,
      armed: state.tool !== "select",
    });
    if (!act) return;
    e.preventDefault();
    if (act.type === "zoom") return zoom.step(act.dir);
    if (act.type === "pan") return zoom.pan(act.dx, act.dy);
    if (act.type === "escape") {
      dispatch({ type: "tool", tool: "select" });
      dispatch({ type: "select", ref: null });
      return;
    }
    if (act.type === "place") {
      const cx = Math.floor(doc.floor.w / 2);
      const cy = Math.floor(doc.floor.h / 2);
      if (state.tool.startsWith("divider:")) {
        const r = addDivider(
          doc,
          state.tool.slice(8) as DividerKind,
          { x: cx - 2, y: cy },
          { x: cx + 2, y: cy },
        );
        if (r) edit(r.doc, r.ref);
      } else if (state.tool === "row") placeAt({ x: 2, y: cy - 2 }, { x: 2, y: cy - 2 });
      else placeAt({ x: cx - 1, y: cy - 2 }, { x: cx, y: cy });
      return;
    }
    if (act.type === "selectAll") return dispatch({ type: "selectMany", refs: selectAll(doc) });
    if (!selection.length) return;
    if (selected) {
      if (act.type === "rotate") edit(rotate(doc, selected));
      else if (act.type === "remove") edit(remove(doc, selected), null);
      else edit(nudge(doc, selected, act.dx, act.dy));
      return;
    }
    if (act.type === "rotate") edit(rotateEach(doc, selection));
    else if (act.type === "remove") edit(removeMany(doc, selection), null);
    else edit(moveMany(doc, selection, act.dx, act.dy));
  };

  /* ── derived ── */
  const checks = useMemo(
    () => (doc ? layoutChecks(doc, data.ward.wardType) : []),
    [doc, data.ward.wardType],
  );
  const presets = useMemo(() => presetsFor(doc?.floor ?? FLOOR_DEFAULT), [doc?.floor]);
  const ghost: PlanGhost | null = useMemo(() => {
    if (!doc || !state.hover || state.tool === "select") return null;
    const cell = { x: Math.floor(state.hover.fx), y: Math.floor(state.hover.fy) };
    const line = { x: Math.round(state.hover.fx), y: Math.round(state.hover.fy) };
    if (state.tool === "row") {
      const r = rowOfBeds(doc, { ...state.row, x: cell.x, y: cell.y });
      return { rects: r.beds.map((b) => bedRect(b)), face: state.row.face };
    }
    if (state.tool.startsWith("divider:")) {
      if (!state.anchor) return { rects: [], point: line };
      const end = snapDivider(state.anchor, line);
      return {
        rects: [],
        line: { x1: state.anchor.x, y1: state.anchor.y, x2: end.x2, y2: end.y2 },
      };
    }
    if (state.tool === "door") return { rects: [], point: line };
    const r = ghostRect(state.tool, cell, doc.floor);
    return r ? { rects: [r] } : null;
  }, [doc, state.hover, state.tool, state.anchor, state.row]);

  /* ── ward details (straight to the server, not part of undo) ── */
  const [wardError, setWardError] = useState<string | null>(null);
  const saveWard = async (patch: Partial<WardFields>) => {
    setWardError(null);
    const w = data.ward;
    const r = await actions.saveWard(wardId, {
      name: patch.name ?? w.name,
      department_id: (patch.departmentId ?? w.departmentId) as string,
      ward_type: patch.wardType !== undefined ? patch.wardType : w.wardType,
      sex: patch.sex !== undefined ? patch.sex : w.sex,
      age_group: w.ageGroup,
      place_id: w.placeId,
      bed_count: w.bedCount,
    });
    if (!r.ok) setWardError(r.error);
    else router.refresh();
  };

  /* ── publish ── */
  const [publishOpen, setPublishOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const outcome = useMemo(
    () =>
      doc && publishOpen
        ? reconcile({ doc, register: data.register, occupiedBedIds: data.occupiedBedIds })
        : ({ ok: false, refusal: "" } as const),
    [doc, publishOpen, data.register, data.occupiedBedIds],
  );
  const openPublish = async () => {
    setPublishError(null);
    setPublishOpen(true);
    await flush();
  };
  const doPublish = async (warnings: string[]) => {
    setPublishing(true);
    setPublishError(null);
    const saved = await flush();
    if (!saved) {
      setPublishing(false);
      return setPublishError("The draft couldn't be saved, so it wasn't published.");
    }
    const r = await actions.publish(wardId, warnings);
    setPublishing(false);
    if (!r.ok) return setPublishError(r.error);
    setPublishOpen(false);
    setAdopt(true);
    live.current.revision = null;
    setSave({ kind: "published", at: new Date().toISOString(), beds: r.bedCount });
    router.refresh();
  };

  /* ── start and discard ── */
  const [startError, setStartError] = useState<string | null>(null);
  const startFromRegister = async () => {
    setStartError(null);
    const r = await actions.startFromRegister(wardId);
    if (!r.ok) return setStartError(r.error);
    setAdopt(true);
    live.current.revision = null;
    setSave({ kind: "saved", at: new Date().toISOString() });
    router.refresh();
  };
  const startFrom = (p: Preset | null) => {
    const next = p ? p.build() : emptyLayout(FLOOR_DEFAULT);
    setSavedDoc(null);
    dispatch({ type: "reset", doc: next });
  };
  const discard = async () => {
    const r = await actions.discardDraft(wardId);
    if (!r.ok) return setSave({ kind: "error", message: r.error, conflict: false });
    setAdopt(true);
    live.current.revision = null;
    setSave({ kind: "idle" });
    router.refresh();
  };

  /* ── words ── */
  const saveNote =
    save.kind === "saving"
      ? "Saving…"
      : save.kind === "error"
        ? `Not saved: ${save.message}`
        : unsaved
          ? "Unsaved changes"
          : save.kind === "published"
            ? `Published ${clock(save.at)} · ${save.beds} ${save.beds === 1 ? "bed" : "beds"}`
            : save.kind === "saved"
              ? `Draft saved ${clock(save.at)}`
              : data.published
                ? `Published ${clock(data.published.publishedAt)} · version ${data.published.version}`
                : doc
                  ? "Not saved yet"
                  : "";
  const selectedItem = selected && doc ? findItem(doc, selected) : null;
  const hint =
    state.tool === "select"
      ? selection.length > 1
        ? `${selection.length} items selected: drag one to move them together, or act on them from the right. Shift+click adds or removes; Escape clears.`
        : selectedItem
          ? "Drag to move, or its round handle to rotate. Shift+click to select more; Escape clears."
          : "Choose something to edit it, drag across empty floor to select several, or pick from the palette to place."
      : state.tool === "row"
        ? "Set the row on the left, then click where the first bed goes."
        : state.tool.startsWith("divider:")
          ? state.anchor
            ? "Click where the divider ends. It snaps straight across or down."
            : "Click where the divider starts, on a grid line."
          : "Click the plan to place. Escape, or Select, to stop placing.";

  const tabs = data.tabs.map((t) => ({
    id: t.id,
    name: t.name,
    sub: `${t.sex ? `${t.sex[0]!.toUpperCase()}${t.sex.slice(1)} · ` : ""}${t.bedCount} ${t.bedCount === 1 ? "bed" : "beds"}`,
    href: links.layout(t.id),
    current: t.id === wardId,
  }));
  const inService = doc?.beds.filter((b) => b.status === "in") ?? [];
  // The publishing bar (phase 2 of ADR 0520): where the plan stands, and what the checks say.
  const B = WARDS.builder;
  const isDraft = hasDraft || unsaved;
  const published = !!data.published || save.kind === "published";
  const stopping = checks.filter((c) => !c.ok && c.blocking).length;
  const worth = checks.filter((c) => !c.ok && !c.blocking).length;
  const checkNote = stopping
    ? B.checks.stop(stopping)
    : worth
      ? B.checks.worth(worth)
      : B.checks.clean;
  const stat = (n: string, label: string) => (
    <span className="text-caption text-muted-foreground inline-flex items-baseline gap-1.5 font-normal">
      <span className="text-foreground font-mono text-[14px] font-medium tabular-nums">{n}</span>
      {label}
    </span>
  );

  return (
    <div
      className={cn(
        "flex flex-col outline-none",
        fit === "frame" ? "h-full min-h-[560px]" : "h-[calc(100svh-3rem)] min-h-[640px]",
      )}
      onKeyDown={onRootKey}
    >
      <WardHeader
        crumbs={[
          ...(links.crumbs ?? [
            { label: "Hospital admin", href: "/hospital-admin" },
            { label: "Departments & services", href: links.hub },
            { label: "Wards", href: links.wards },
          ]),
          { label: data.ward.name },
        ]}
        title="Ward layout"
        tag={<Tag>{published ? (isDraft ? B.tag.draft : B.tag.published) : B.tag.never}</Tag>}
        mode="build"
        buildHref={links.layout(wardId)}
        liveHref={data.published ? links.board(wardId) : null}
        liveWaits="Publish the layout first"
        tabs={tabs}
        newWardHref={links.newWard}
        onNavigate={onNavigate}
        right={
          doc ? (
            <>
              <span className="flex flex-col items-start text-left sm:items-end sm:text-right">
                <span className="text-caption text-foreground font-medium">{checkNote}</span>
                <span
                  className={cn(
                    "text-caption font-normal",
                    save.kind === "error" ? "text-status-caution-fg-aa" : "text-ink-600",
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {saveNote}
                </span>
              </span>
              {hasDraft && !conflicted ? (
                discarding ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-foreground max-w-60 font-normal">
                      {B.discardAsk}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDiscarding(false);
                        void discard();
                      }}
                    >
                      {B.discardYes}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDiscarding(false)}>
                      {B.discardNo}
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" onClick={() => setDiscarding(true)}>
                    {B.discard}
                  </Button>
                )
              ) : null}
              {conflicted ? (
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  {B.reload}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => void flush()}
                  disabled={!unsaved || save.kind === "saving"}
                >
                  {B.save}
                </Button>
              )}
              <Button
                onClick={() => void openPublish()}
                disabled={conflicted}
                data-tour="wt-w-publish"
                title={stopping ? B.checks.stop(stopping) : undefined}
              >
                {B.publish}
              </Button>
            </>
          ) : null
        }
      />

      {doc ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[200px_minmax(0,1fr)_264px] xl:overflow-hidden 2xl:grid-cols-[216px_minmax(0,1fr)_288px]">
          <aside
            aria-label="Palette"
            data-tour="wt-w-pal"
            className="border-border bg-card order-3 overflow-y-auto border-t p-3 pb-24 xl:order-1 xl:border-t-0 xl:border-r"
          >
            <Palette
              tool={state.tool}
              onArm={(tool) => dispatch({ type: "tool", tool })}
              row={state.row}
              onRow={(row) => dispatch({ type: "row", row })}
              presets={presets}
              onPreset={(p) => edit(p.build(), null)}
              wardType={data.ward.wardType}
            />
          </aside>

          <main className="order-1 flex min-h-[520px] min-w-0 flex-col xl:order-2 xl:min-h-0">
            <div className="border-border bg-card flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5">
              <ViewSwitcher
                label="Plan or items"
                value={state.view}
                onChange={(view) => dispatch({ type: "view", view })}
                options={[
                  { value: "plan", label: "Floor plan" },
                  { value: "items", label: "Items list" },
                ]}
              />
              {state.view === "plan" ? (
                <span className="flex items-center gap-2">
                  <span className="text-caption text-muted-foreground font-normal">Show</span>
                  <ViewSwitcher
                    label="Highlight on the plan"
                    value={state.lens}
                    onChange={(lens) => dispatch({ type: "lens", lens })}
                    options={LENSES}
                  />
                </span>
              ) : null}
              {state.view === "plan" ? (
                <p
                  className="text-caption text-ink-600 min-w-[16rem] flex-1 font-normal"
                  aria-live="polite"
                >
                  {hint}
                </p>
              ) : null}
              <span className="ml-auto flex items-center gap-1.5">
                {state.view === "plan" ? (
                  <PlanZoomControls z={zoom} keysHint wheelHint={words.zoomWheel} />
                ) : null}
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Undo"
                  title={words.undoTitle}
                  disabled={!state.h || !canUndo(state.h)}
                  onClick={() => dispatch({ type: "undo" })}
                >
                  <Undo2Icon aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Redo"
                  title={words.redoTitle}
                  disabled={!state.h || !canRedo(state.h)}
                  onClick={() => dispatch({ type: "redo" })}
                >
                  <Redo2Icon aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Grid"
                  aria-pressed={state.grid}
                  title="Grid"
                  onClick={() => dispatch({ type: "grid" })}
                >
                  <Grid3x3Icon aria-hidden />
                </Button>
              </span>
            </div>

            {state.view === "plan" ? (
              <div className="bg-ink-100 flex min-h-0 flex-1 flex-col gap-1.5 p-3">
                <div
                  ref={planRef}
                  tabIndex={0}
                  data-tour="wt-w-plan"
                  onKeyDown={onPlanKey}
                  aria-label={`Floor plan of ${data.ward.name}, ${doc.beds.length} ${doc.beds.length === 1 ? "bed" : "beds"}. Arrow keys nudge the selection; R rotates; Delete removes; Enter places the item chosen in the palette.`}
                  className="focus-visible:outline-ring flex min-h-[280px] flex-1 flex-col rounded-md outline-offset-2 focus-visible:outline-2"
                >
                  <PlanZoomFrame z={zoom} aspect={planAspect(doc.floor)} className="flex-1">
                    <PlanView
                      doc={doc}
                      mode="build"
                      label={`Floor plan of ${data.ward.name}`}
                      grid={state.grid}
                      lens={state.lens}
                      selected={selected}
                      selection={selection}
                      marquee={box}
                      ghost={ghost}
                      handles={state.tool === "select"}
                      placing={state.tool !== "select"}
                      svgRef={svgRef}
                      className="h-full w-full"
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerLeave={() => dispatch({ type: "hover", at: null })}
                    />
                  </PlanZoomFrame>
                </div>
                <div className="text-caption text-muted-foreground flex flex-wrap justify-between gap-2 font-normal">
                  <span>
                    1 square = 0.5 m · floor {doc.floor.w / 2} × {doc.floor.h / 2} m
                  </span>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Kbd>R</Kbd> rotates · <Kbd>Delete</Kbd> removes · arrows nudge ·{" "}
                    <Kbd>{words.undo}</Kbd> undoes · <Kbd>+</Kbd> <Kbd>−</Kbd> zoom
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-ink-100 min-h-0 flex-1 overflow-auto p-3">
                <ItemsList
                  doc={doc}
                  selection={selection}
                  onChange={(d) => edit(d)}
                  onSelect={(ref) => dispatch({ type: "select", ref })}
                  onToggle={(ref) => dispatch({ type: "toggle", ref })}
                />
              </div>
            )}

            <div className="border-border bg-card flex min-h-10 flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-3 py-1.5">
              {stat(String(doc.beds.length), "beds on the plan")}
              {stat(String(inService.length), "in service")}
              {stat(String(doc.rooms.filter((r) => r.kind !== "bay").length), "single rooms")}
              {stat(
                `${inService.filter((b) => b.services.includes("o2")).length}/${inService.length}`,
                "with wall oxygen",
              )}
              {stat(
                `${inService.filter((b) => b.services.includes("suction")).length}/${inService.length}`,
                "with suction",
              )}
              {doc.beds.length !== data.ward.bedCount ? (
                <CautionNote className="ml-auto">
                  The plan has {doc.beds.length} {doc.beds.length === 1 ? "bed" : "beds"}; the ward
                  is registered with {data.ward.bedCount}. Publishing updates the registered count.
                </CautionNote>
              ) : null}
            </div>
          </main>

          <aside
            aria-label="Inspector"
            data-tour="wt-w-insp"
            className="border-border bg-card order-2 overflow-y-auto border-t p-3 xl:order-3 xl:border-t-0 xl:border-l xl:pb-24"
          >
            {selection.length > 1 ? (
              <GroupInspector
                doc={doc}
                selection={selection}
                onChange={(d, keep) => edit(d, keep ? undefined : null)}
                onClear={() => dispatch({ type: "select", ref: null })}
              />
            ) : selected ? (
              <SelectionInspector
                doc={doc}
                selected={selected}
                onChange={(d) => edit(d)}
                onSelect={(ref) => dispatch({ type: "select", ref })}
                wardType={data.ward.wardType}
              />
            ) : (
              <WardInspector
                doc={doc}
                onChange={(d) => edit(d)}
                ward={{
                  name: data.ward.name,
                  departmentId: data.ward.departmentId,
                  wardType: data.ward.wardType,
                  sex: data.ward.sex,
                }}
                departments={data.departments}
                onSaveWard={(p) => void saveWard(p)}
                wardError={wardError}
                checks={checks}
                onRenumber={() => edit(renumberBeds(doc))}
                onDiscardDraft={hasDraft ? () => void discard() : null}
              />
            )}
          </aside>
        </div>
      ) : (
        <StartPanel
          wardName={data.ward.name}
          registerBeds={data.register.filter((b) => !b.archivedAt).length}
          presets={presetsFor(FLOOR_DEFAULT)}
          onRegister={() => void startFromRegister()}
          onPreset={startFrom}
          error={startError}
        />
      )}

      {doc && publishOpen ? (
        <PublishDialog
          open
          onClose={() => setPublishOpen(false)}
          wardName={data.ward.name}
          bedCountNow={data.ward.bedCount}
          checks={checks}
          outcome={outcome}
          pending={publishing}
          error={publishError}
          onPublish={(w) => void doPublish(w)}
        />
      ) : null}

      <EditorDialog
        open={leaving !== null}
        onOpenChange={(o) => !o && setLeaving(null)}
        width="medium"
      >
        <SheetHeader className="relative pr-14">
          <SheetTitle>Leave with unsaved changes?</SheetTitle>
          <SheetDescription>
            The last changes to this layout haven&rsquo;t reached the draft yet.
          </SheetDescription>
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Close"
                className="absolute top-4 right-4"
              />
            }
          >
            <XIcon className="size-4" />
          </SheetClose>
        </SheetHeader>
        <SheetBody>
          <p className="text-body-s text-ink-700">Save them to the draft first, or leave them.</p>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={() => setLeaving(null)}>
            Stay
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const href = leaving!;
              setLeaving(null);
              router.push(href);
            }}
          >
            Leave without saving
          </Button>
          <Button
            onClick={async () => {
              const href = leaving!;
              if (await flush()) {
                setLeaving(null);
                router.push(href);
              } else setLeaving(null);
            }}
          >
            Save and leave
          </Button>
        </SheetFooter>
      </EditorDialog>
    </div>
  );
}

/* ─── a ward with no layout yet ─────────────────────────────────────── */

function StartPanel({
  wardName,
  registerBeds,
  presets,
  onRegister,
  onPreset,
  error,
}: {
  wardName: string;
  registerBeds: number;
  presets: Preset[];
  onRegister: () => void;
  onPreset: (p: Preset | null) => void;
  error: string | null;
}) {
  return (
    <div className="bg-ink-100 flex flex-1 items-start justify-center overflow-y-auto p-6">
      <section
        aria-labelledby="start-title"
        data-tour="wt-w-start"
        className="bg-card shadow-card flex w-full max-w-2xl flex-col gap-5 rounded-lg p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 id="start-title" className="text-heading-m text-foreground">
            {wardName} has no layout yet
          </h2>
          <p className="text-body-s text-ink-600">
            Lay the ward out as it stands: beds, walls, rooms and what is at each bed. Nothing
            changes for anyone until you publish.
          </p>
        </div>
        {registerBeds ? (
          <div className="border-border flex flex-col gap-2 rounded-lg border p-4">
            <h3 className="text-heading-s text-foreground">Start from the register</h3>
            <p className="text-body-s text-ink-600">
              {`The ${registerBeds} ${registerBeds === 1 ? "bed" : "beds"} already in this ward’s register are laid out in rows, keeping their numbers, so nothing is lost. Then move them to where they stand.`}
            </p>
            <Button className="self-start" onClick={onRegister}>
              Start from the register
            </Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 className="text-heading-s text-foreground">
            {registerBeds ? "Or start from a layout" : "Start from a layout"}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPreset(p)}
                className="border-border hover:bg-ink-50 focus-visible:shadow-focus flex flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left outline-none"
              >
                <span className="text-label text-foreground">{p.name}</span>
                <span className="text-caption text-muted-foreground font-normal">{p.sub}</span>
              </button>
            ))}
          </div>
        </div>
        {error ? <CautionNote alert>{error}</CautionNote> : null}
      </section>
    </div>
  );
}

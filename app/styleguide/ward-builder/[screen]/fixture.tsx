"use client";

import type { Screen } from "./page";
import type { EditorActions } from "@/components/wards/editor/ward-editor";

import { BedBoard } from "@/components/wards/board/bed-board";
import { WardEditor } from "@/components/wards/editor/ward-editor";
import { presetsFor } from "@/lib/wards/presets";
import {
  baysDoc,
  bedUuid,
  BOARD_NOW,
  boardData,
  editorData,
  euListData,
  FLOOR,
  FX,
  openWardDoc,
} from "@/tests/wards/fixtures";

const ok = async () => ({ ok: true as const });
const ACTIONS: EditorActions = {
  saveDraft: async () => ({ ok: true, revision: 8 }),
  publish: async () => ({ ok: true, bedCount: 18, version: 2 }),
  startFromRegister: ok,
  discardDraft: ok,
  saveWard: ok,
};
const BOARD_ACTIONS = {
  setState: ok,
  assign: ok,
  release: ok,
  allocate: ok,
  confirmArrival: ok,
  releaseAdmission: ok,
};
const BOARD_LINKS = {
  crumbs: [
    { label: "Hospital admin", href: "#" },
    { label: "Wards", href: "#" },
  ],
  board: () => "#",
  layout: () => "#",
};
const NURSE_LINKS = { crumbs: [{ label: "Nursing", href: "#" }], board: () => "#", layout: null };

const LINKS = {
  hub: "#",
  wards: "#",
  layout: () => "#",
  board: () => "#",
  newWard: "#",
};

export function FixtureWardBuilder({ screen }: { screen: Screen }) {
  const [open, bays, hdu, empty] = presetsFor(FLOOR).map((p) => p.build());
  switch (screen) {
    case "layout-open":
      return <WardEditor data={editorData(openWardDoc())} actions={ACTIONS} links={LINKS} />;
    case "layout-bays":
      return (
        <WardEditor
          data={editorData(baysDoc(), {
            ward: { ...editorData(null).ward, name: "Medical Ward 2", sex: "female", bedCount: 12 },
          })}
          actions={ACTIONS}
          links={LINKS}
        />
      );
    case "layout-hdu":
      return (
        <WardEditor
          data={editorData(hdu!, {
            ward: {
              ...editorData(null).ward,
              name: "Medical HDU",
              wardType: "hdu",
              sex: "mixed",
              bedCount: 6,
            },
          })}
          actions={ACTIONS}
          links={LINKS}
        />
      );
    case "layout-empty":
      return (
        <WardEditor
          data={editorData(empty!, { ward: { ...editorData(null).ward, bedCount: 0 } })}
          actions={ACTIONS}
          links={LINKS}
        />
      );
    case "layout-bed":
      return (
        <WardEditor
          data={editorData(openWardDoc())}
          actions={ACTIONS}
          links={LINKS}
          initial={{ selected: { kind: "bed", key: "b5" } }}
        />
      );
    case "layout-room":
      return (
        <WardEditor
          data={editorData(baysDoc())}
          actions={ACTIONS}
          links={LINKS}
          initial={{ selected: { kind: "room", key: "r1" } }}
        />
      );
    case "layout-items":
      return (
        <WardEditor
          data={editorData(openWardDoc())}
          actions={ACTIONS}
          links={LINKS}
          initial={{ view: "items", selected: { kind: "bed", key: "b3" } }}
        />
      );
    case "layout-lens":
      return (
        <WardEditor
          data={editorData(openWardDoc())}
          actions={ACTIONS}
          links={LINKS}
          initial={{ lens: "o2" }}
        />
      );
    case "layout-start":
      return (
        <WardEditor
          data={editorData(null, {
            register: Array.from({ length: 20 }, (_, i) => ({
              id: bedUuid(i + 1),
              label: `Bed ${i + 1}`,
              bedType: null,
              closedAt: null,
              closedReason: null,
              archivedAt: null,
              layoutX: null,
              layoutY: null,
              rotation: null,
              roomKey: null,
              services: [],
            })),
          })}
          actions={ACTIONS}
          links={LINKS}
        />
      );
    case "board":
      return (
        <BedBoard
          data={boardData()}
          hospitalId={FX.hospital}
          mayAct
          actions={BOARD_ACTIONS}
          links={NURSE_LINKS}
          live={false}
        />
      );
    case "board-bed":
      return (
        <BedBoard
          data={boardData(baysDoc())}
          hospitalId={FX.hospital}
          mayAct
          actions={BOARD_ACTIONS}
          links={NURSE_LINKS}
          live={false}
          initialSelected="b2"
        />
      );
    case "board-admin":
      return (
        <BedBoard
          data={boardData(openWardDoc(), "mrn")}
          hospitalId={FX.hospital}
          mayAct
          actions={BOARD_ACTIONS}
          links={BOARD_LINKS}
          live={false}
          initialSelected="b1"
        />
      );
    case "board-arriving":
      return (
        <BedBoard
          data={boardData()}
          hospitalId={FX.hospital}
          mayAct
          actions={BOARD_ACTIONS}
          links={NURSE_LINKS}
          live={false}
          initialSelected="b7"
        />
      );
    case "board-eu-plan":
    case "board-eu-list":
    case "board-eu-list-nonames":
      return (
        <BedBoard
          data={boardData()}
          hospitalId={FX.hospital}
          mayAct
          actions={BOARD_ACTIONS}
          links={NURSE_LINKS}
          live={false}
          eu={{
            data: euListData(screen !== "board-eu-list-nonames"),
            nowMs: BOARD_NOW,
            links: { resus: (id) => `/nurse/resus/${id}` },
            triageSystem: "sats",
            initialView: screen === "board-eu-plan" ? "plan" : "list",
          }}
        />
      );
    default:
      void open;
      void bays;
      return null;
  }
}

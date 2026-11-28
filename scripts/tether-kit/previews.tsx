"use client";

import type { Density } from "@/components/tether-kit";
import type { ReactNode } from "react";
import { CalendarPlusIcon, EllipsisIcon, SirenIcon, XIcon } from "lucide-react";

import {
  Band,
  Button,
  Card,
  ICON,
  IconButton,
  KitRoot,
  StatusTag,
  Tag,
} from "@/components/tether-kit";

/**
 * The live previews in the Tether Tide design system (D-TK-08). Each shows the part at patient density and at
 * desk density. Rows are examples: no real patients, no doses. Built into a browser bundle by
 * scripts/tether-kit/build-previews.mjs; never imported by the app.
 */

function Pair({ children }: { children: (density: Density) => ReactNode }) {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2">
      {(["patient", "desk"] as const).map((d) => (
        <KitRoot key={d} density={d} className="flex min-w-0 flex-col gap-3 rounded-[18px] p-4">
          <span className="text-pw-ink-3 text-xs font-semibold tracking-[0.06em] uppercase">
            {d === "patient" ? "Patient" : "Desk"}
          </span>
          {children(d)}
        </KitRoot>
      ))}
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-start gap-2">{children}</div>
);

function ButtonDemo() {
  return (
    <Pair>
      {() => (
        <>
          <Row>
            <Button tone="accent">Book a visit</Button>
            <Button>Save reading</Button>
          </Row>
          <Row>
            <Button tone="soft" size="m">
              Keep draft
            </Button>
            <Button tone="outline" size="m">
              <CalendarPlusIcon {...ICON} />
              Add to calendar
            </Button>
            <Button tone="quiet" size="m">
              Change
            </Button>
          </Row>
          <Row>
            <Button tone="danger" size="m">
              <SirenIcon {...ICON} />
              Help
            </Button>
            <Button size="m" busy>
              Sending
            </Button>
          </Row>
          <Button size="m" disabledReason="Sign the discharge summary first.">
            Discharge
          </Button>
        </>
      )}
    </Pair>
  );
}

function IconButtonDemo() {
  return (
    <Pair>
      {() => (
        <Row>
          <IconButton label="Close" icon={<XIcon {...ICON} />} />
          <IconButton label="More" tone="outline" icon={<EllipsisIcon {...ICON} />} />
        </Row>
      )}
    </Pair>
  );
}

function TagDemo() {
  return (
    <Pair>
      {() => (
        <>
          <Row>
            <Tag area="visits">Visits</Tag>
            <Tag area="readings">Readings</Tag>
            <Tag tone="accent">New</Tag>
            <Tag tone="navy">Member</Tag>
            <Tag tone="outline">Outpatients</Tag>
          </Row>
          <Row>
            <StatusTag tone="stable">In your range</StatusTag>
            <StatusTag tone="caution">Above your target</StatusTag>
            <StatusTag tone="critical">Danger</StatusTag>
          </Row>
          <Row>
            <StatusTag tone="pending">Waiting for the clinic</StatusTag>
            <StatusTag tone="info">Changed since printing</StatusTag>
          </Row>
        </>
      )}
    </Pair>
  );
}

function SurfaceDemo() {
  return (
    <Pair>
      {() => (
        <>
          <Card>
            <div className="flex flex-col gap-1">
              <Tag area="visits" className="self-start">
                Visits
              </Tag>
              <span className="mt-2 text-lg font-semibold">Outpatients · Morning</span>
              <span className="text-pw-ink-2 text-[15px]">Thu 4 Dec · Example clinic</span>
            </div>
          </Card>
          <Band>
            <div className="flex flex-col gap-1">
              <span className="text-pw-on-band-2 text-xs font-semibold tracking-[0.06em] uppercase">
                Ticket
              </span>
              <span className="font-mono text-2xl font-semibold tracking-[0.08em]">K7M-42Q</span>
              <span className="text-pw-on-band-2 text-sm">Illustrative code</span>
            </div>
          </Band>
        </>
      )}
    </Pair>
  );
}

export const demos = {
  Button: ButtonDemo,
  IconButton: IconButtonDemo,
  Tag: TagDemo,
  Card: SurfaceDemo,
};

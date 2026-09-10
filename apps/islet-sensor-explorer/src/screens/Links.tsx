import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AbbreviationNote } from "@/components/links/AbbreviationNote";
import {
  CADENCE_STEPS,
  loopCycles,
  normaliseStepIndex,
  stepDwellMs,
  stepFiresOnCycle,
} from "@/components/links/cadence";
import { InsulinBanner } from "@/components/links/InsulinBanner";
import { linkKey } from "@/components/links/labels";
import { LinkLegend } from "@/components/links/LinkLegend";
import { LinkList } from "@/components/links/LinkList";
import { LinkMap } from "@/components/links/LinkMap";
import { LinkTransport } from "@/components/links/LinkTransport";
import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { LINKS } from "@/content/sensor";
import { bracketCode, findScreen } from "@/lib/content";
import { buildLayout, LINKS_LAYOUT, routeLinks } from "@/lib/graph";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { ScreenPlaceholder } from "@/screens/ScreenPlaceholder";
import { useExplorerStore } from "@/store/explorer";

const SCREEN_PATH = "/links";

/**
 * Screen [02], who talks to whom.
 *
 * The same nodes as the Parts screen, drawn plainly, with every link the
 * content holds routed between them and coloured by signal path. The lines are
 * the interactive thing: hovering or focusing one says what travels, how, and
 * how often. The transport walks the links in cadence order, and that order is
 * derived from each link's own cadence string in components/links/cadence.ts.
 *
 * Below the large breakpoint the picture is replaced by a stacked list of all
 * eighteen links, which carries the same information rather than less of it.
 */
export function Links() {
  const screen = findScreen(SCREEN_PATH);
  const reduced = useReducedMotion();
  const headings = useId();

  const layout = useMemo(() => buildLayout(LINKS_LAYOUT), []);
  const routed = useMemo(() => routeLinks(layout, LINKS), [layout]);

  const steps = CADENCE_STEPS;
  const dwell = useMemo(() => stepDwellMs(steps), [steps]);
  const cyclesInLoop = useMemo(() => loopCycles(steps), [steps]);

  const playing = useExplorerStore((state) => state.playing);
  const cycleIndex = useExplorerStore((state) => state.cycleIndex);
  const play = useExplorerStore((state) => state.play);
  const pause = useExplorerStore((state) => state.pause);
  const stepForward = useExplorerStore((state) => state.stepForward);
  const stepBack = useExplorerStore((state) => state.stepBack);
  const resetPlayback = useExplorerStore((state) => state.reset);

  const stepIndex = normaliseStepIndex(cycleIndex, steps.length);
  const step = steps[stepIndex];

  // Which measurement cycle the sequence is on. The store counts steps, so the
  // cycle is counted here: it moves on when the sequence comes round again.
  const [cycleNumber, setCycleNumber] = useState(1);
  const previousStep = useRef(stepIndex);

  useEffect(() => {
    const previous = previousStep.current;
    if (previous === stepIndex) return;
    const last = steps.length - 1;
    if (previous === last && stepIndex === 0) {
      setCycleNumber((current) => (current % cyclesInLoop) + 1);
    } else if (previous === 0 && stepIndex === last) {
      setCycleNumber((current) => ((current - 2 + cyclesInLoop) % cyclesInLoop) + 1);
    }
    previousStep.current = stepIndex;
  }, [cyclesInLoop, stepIndex, steps.length]);

  // Playback. Never starts on its own, and never runs at all when the reader
  // has asked for less motion.
  useEffect(() => {
    if (!playing || reduced) return;
    const timer = window.setInterval(() => stepForward(), dwell);
    return () => window.clearInterval(timer);
  }, [dwell, playing, reduced, stepForward]);

  useEffect(() => {
    if (reduced && playing) pause();
  }, [pause, playing, reduced]);

  const activeKeys = useMemo(
    () => new Set((step?.links ?? []).map((link) => linkKey(link))),
    [step],
  );

  if (!screen || !step) return <ScreenPlaceholder path={SCREEN_PATH} />;

  const fires = stepFiresOnCycle(step, cycleNumber);
  const packetLinks = fires ? step.links : [];
  const leadLink = step.links[0];

  const handleReset = () => {
    resetPlayback();
    setCycleNumber(1);
    previousStep.current = 0;
  };

  return (
    <div className="stagger-children flex w-full min-w-0 flex-col gap-8">
      <header className="flex max-w-prose flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l text-gray-600">{screen.blurb}</p>
      </header>

      <InsulinBanner />

      <AbbreviationNote className="max-w-prose" />

      <LinkTransport
        steps={steps}
        step={step}
        cycleNumber={cycleNumber}
        cyclesInLoop={cyclesInLoop}
        playing={playing}
        reduced={reduced}
        onPlay={play}
        onPause={pause}
        onStepBack={stepBack}
        onStepForward={stepForward}
        onReset={handleReset}
        headingId={`${headings}-transport`}
      />

      <section aria-labelledby={`${headings}-map`} className="hidden min-w-0 lg:block">
        <h2 id={`${headings}-map`} className="sr-only">
          The link map
        </h2>
        <Card>
          <LinkMap
            layout={layout}
            routed={routed}
            title="Link map"
            description={`All ${LINKS.length} links, routed between the parts and coloured by signal path. Hover or focus a line to read what it carries.`}
            activeKeys={activeKeys}
            packetLinks={packetLinks}
            packetSeed={`${stepIndex}-${cycleNumber}`}
            reduced={reduced}
          />
        </Card>
      </section>

      <LinkList
        activeKeys={activeKeys}
        leadKey={leadLink ? linkKey(leadLink) : null}
        stepIndex={stepIndex}
        reduced={reduced}
        headingId={`${headings}-list`}
        className="lg:hidden"
      />

      <LinkLegend headingId={`${headings}-legend`} />
    </div>
  );
}

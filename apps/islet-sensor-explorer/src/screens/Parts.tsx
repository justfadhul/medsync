import { useId } from "react";

import { PathLegend } from "@/components/diagram/PathLegend";
import { PartDetail } from "@/components/parts/PartDetail";
import { nodeTitle } from "@/components/parts/parts-data";
import { PartsList } from "@/components/parts/PartsList";
import { PartsMap } from "@/components/parts/PartsMap";
import { PartsToolbar } from "@/components/parts/PartsToolbar";
import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { bracketCode, findScreen } from "@/lib/content";
import { nodeById } from "@/lib/nodes";
import { ScreenPlaceholder } from "@/screens/ScreenPlaceholder";
import { useExplorerStore } from "@/store/explorer";

/**
 * Screen [01]: the component map.
 *
 * The map on a wide screen and the stacked list on a narrow one are the same
 * content twice, not one content truncated. Both read the one selection in the
 * store, so a part opened in the list is the part the panel shows.
 */
export function Parts() {
  const screen = findScreen("/parts");
  const panelId = `${useId()}-part-panel`;

  const selectedPartId = useExplorerStore((state) => state.selectedPartId);
  const activePaths = useExplorerStore((state) => state.activePaths);
  const togglePart = useExplorerStore((state) => state.togglePart);
  const setSelectedPart = useExplorerStore((state) => state.setSelectedPart);
  const togglePath = useExplorerStore((state) => state.togglePath);
  const resetPaths = useExplorerStore((state) => state.resetPaths);

  if (!screen) return <ScreenPlaceholder path="/parts" />;

  const selected = selectedPartId === null ? null : (nodeById(selectedPartId) ?? null);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className="stagger-children flex max-w-prose flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l text-gray-600">{screen.blurb}</p>
      </header>

      <PartsToolbar
        activePaths={activePaths}
        onTogglePath={togglePath}
        onShowAll={resetPaths}
        className="border-y border-gray-200 py-4"
      />

      <div className="flex min-w-0 flex-col gap-8 lg:flex-row lg:items-start lg:gap-8">
        <PartsMap
          selectedId={selectedPartId}
          activePaths={activePaths}
          onToggleNode={togglePart}
          onClearSelection={() => setSelectedPart(null)}
          className="hidden min-w-0 flex-1 lg:block"
        />

        {/* Below the large breakpoint the map is replaced, not shrunk. The
            legend travels with it, so the insulin line is stated in words at
            every width. */}
        <div className="flex min-w-0 flex-col gap-6 lg:hidden">
          <PathLegend className="rounded-lg border border-gray-200 p-4" />
          <PartsList
            selectedId={selectedPartId}
            activePaths={activePaths}
            onToggleNode={togglePart}
            onSelectPart={setSelectedPart}
          />
        </div>

        <section
          aria-labelledby={panelId}
          aria-live="polite"
          className="hidden lg:sticky lg:top-20 lg:block lg:w-85 lg:shrink-0"
        >
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-4">
              <h2 id={panelId} className="text-heading-s text-gray-900">
                {selected ? nodeTitle(selected) : "Select a part"}
              </h2>

              {selected ? (
                <PartDetail part={selected} onSelectPart={setSelectedPart} />
              ) : (
                <p className="text-body-s text-gray-600">
                  Select a part on the map to read where it lives, what it does and what it says.
                  The parts it talks to are highlighted with it.
                </p>
              )}
            </div>

            <PathLegend className="border-t border-gray-200 pt-4" />
          </Card>
        </section>
      </div>
    </div>
  );
}

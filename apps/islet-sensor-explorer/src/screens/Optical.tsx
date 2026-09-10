import { OpticalFigure } from "@/components/sensor/OpticalFigure";
import { StoryScreen } from "@/components/sensor/StoryScreen";
import { OPTICAL_STORY, PARTS } from "@/content/sensor";

const TIP = PARTS.find((part) => part.id === OPTICAL_STORY.tipPartId);
const MODULE = PARTS.find((part) => part.id === OPTICAL_STORY.modulePartId);

/** [03] Optical sensor: how a flash and a glow become a glucose value. */
export function Optical() {
  return (
    <StoryScreen
      story={OPTICAL_STORY}
      path="/optical"
      figureCaption="The drawing is schematic. Distances, sizes and the shape of the tip are not to scale."
      renderFigure={({ step, reduced, titleId, descId, labelFor }) => (
        <OpticalFigure
          step={step}
          reduced={reduced}
          moduleName={MODULE?.name ?? ""}
          tipName={TIP?.name ?? ""}
          flashLabel={labelFor(OPTICAL_STORY.modulePartId, OPTICAL_STORY.tipPartId)}
          glowLabel={labelFor(OPTICAL_STORY.tipPartId, OPTICAL_STORY.modulePartId)}
          titleId={titleId}
          descId={descId}
        />
      )}
    />
  );
}

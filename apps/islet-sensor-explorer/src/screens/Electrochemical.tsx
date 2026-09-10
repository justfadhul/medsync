import { ElectrochemicalFigure } from "@/components/sensor/ElectrochemicalFigure";
import { StoryScreen } from "@/components/sensor/StoryScreen";
import { ELECTROCHEMICAL_STORY, PARTS } from "@/content/sensor";

const TIP = PARTS.find((part) => part.id === ELECTROCHEMICAL_STORY.tipPartId);

/** The interferent this screen lets the reader switch on, named from content. */
const INTERFERENT = ELECTROCHEMICAL_STORY.fooledBy[0];

/** [04] Electrochemical sensor: how glucose becomes a current. */
export function Electrochemical() {
  return (
    <StoryScreen
      story={ELECTROCHEMICAL_STORY}
      path="/electrochemical"
      figureCaption="The drawing is schematic. Layer thicknesses and the number of molecules are not to scale."
      renderFigure={({ step, reduced, demoOn, titleId, descId, labelFor }) => (
        <ElectrochemicalFigure
          step={step}
          reduced={reduced}
          interferent={demoOn}
          interferentName={INTERFERENT?.name ?? ""}
          tipName={TIP?.name ?? ""}
          biasLabel={labelFor(ELECTROCHEMICAL_STORY.modulePartId, ELECTROCHEMICAL_STORY.tipPartId)}
          currentLabel={labelFor(
            ELECTROCHEMICAL_STORY.tipPartId,
            ELECTROCHEMICAL_STORY.modulePartId,
          )}
          titleId={titleId}
          descId={descId}
        />
      )}
    />
  );
}

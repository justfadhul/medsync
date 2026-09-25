import { EndVisitButton } from "@/app/doctor/schedule/_components/end-visit";
import { Pill } from "@/components/ui/pill";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

/**
 * The visit's lifecycle in the encounter top bar (ADR 0101 R3): the End visit
 * control while the encounter is running, the time it ended once it has.
 * Planned and cancelled encounters show nothing here — the heading already
 * names the state, and neither can be ended.
 *
 * The time is the hospital's clock, not the server's: on a UTC host a visit
 * closed at 14:05 in Kampala would otherwise read 11:05.
 */
export function VisitStatus({
  encounterId,
  state,
  endedAt,
}: {
  encounterId: string;
  state: string;
  endedAt: Date | null;
}) {
  if (state === "in_progress") return <EndVisitButton encounterId={encounterId} />;
  if (state !== "completed") return null;
  const at = endedAt?.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_TIME_ZONE,
  });
  return <Pill>{at ? `Completed · ${at}` : "Completed"}</Pill>;
}

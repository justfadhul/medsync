import { hospitalClock } from "@/lib/workspace/clock";

const clock = hospitalClock();

/** The panel's and banners' times: "10:31" today, "5 Jun 10:31" before (the hospital's clock). */
export const when = clock.whenAt;

/** The same calendar day at the hospital. */
export const sameDay = clock.sameDay;

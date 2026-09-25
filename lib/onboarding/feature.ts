import "server-only";

import { cookies } from "next/headers";

/**
 * Onboarding v2 flag (D18). `ONBOARDING_V2=1` turns v2 on for everyone. Until then a browser can
 * opt in on its own at /signup/preview (a cookie), so v2 can be seen in production while the old
 * forms stay the default. Off by default.
 */
export const PREVIEW_COOKIE = "medsync_onboarding_v2";

export const onboardingV2ForEveryone = () => process.env.ONBOARDING_V2?.trim() === "1";

export async function onboardingV2(): Promise<boolean> {
  if (onboardingV2ForEveryone()) return true;
  return (await cookies()).get(PREVIEW_COOKIE)?.value === "1";
}

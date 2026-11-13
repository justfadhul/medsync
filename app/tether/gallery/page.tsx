import type { Metadata } from "next";

import { Chrome } from "@/components/landing/tether/chrome";
import { ToastDemo } from "./toast-demo";

export const metadata: Metadata = {
  title: "Tether landing gallery",
  robots: { index: false, follow: false },
};

/**
 * The landing page's harness (brief §5.2): each component's states with fixtures only, in both themes at 1440 and
 * 390 through scripts/landing/scenarios.mjs. Removed with the flag at Step 7. Harness labels are not visitor copy.
 */
export default function TetherGallery() {
  return (
    <div id="top">
      <Chrome preAlert={false} />
      <main className="mx-auto flex max-w-[1080px] flex-col gap-8 px-5 py-16">
        <h1 className="text-[40px] leading-[44px] font-medium tracking-[-0.035em]">Gallery</h1>
        <section aria-labelledby="g-toast" className="flex flex-col items-start gap-3">
          <h2 id="g-toast" className="text-xl font-semibold">
            Toast
          </h2>
          <ToastDemo />
        </section>
      </main>
    </div>
  );
}

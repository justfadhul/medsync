import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "@/app/(auth)/sign-in/form";
import { AuthHead, AuthPage, JoinPanel } from "@/components/landing/tether/auth";
import { AUTH, NAV } from "@/content/tether-landing/copy";

/** `/sign-in` while LANDING_TETHER is on (ADR 0498): the hospital app's sign-in in the Tether look, beside the ways to join. */
export const metadata: Metadata = { title: { absolute: `${AUTH.title} · ${NAV.brand}` } };

export default function TetherSignInPage() {
  return (
    <AuthPage wide>
      <div className="grid grid-cols-[minmax(0,440px)_minmax(0,1fr)] items-start gap-18 max-[960px]:grid-cols-1 max-[960px]:gap-10">
        <div className="pt-6 max-[960px]:max-w-[440px] max-[960px]:pt-0">
          {/* useSearchParams needs Suspense to bound the dynamic boundary. */}
          <Suspense
            fallback={
              <AuthHead title={AUTH.title} lead={AUTH.lead}>
                {null}
              </AuthHead>
            }
          >
            <SignInForm look="tether" />
          </Suspense>
        </div>
        <JoinPanel />
      </div>
    </AuthPage>
  );
}

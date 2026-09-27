import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "You are offline",
  robots: { index: false, follow: false },
};

/**
 * The one page the service worker keeps (ADR 0088: "no PWA offline beyond
 * the shell"). Served only when a navigation fails; nothing on it is live,
 * so nothing on it can be stale. Static and unauthenticated by design.
 */
export default function OfflinePage() {
  return (
    <main className="bg-background mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 py-8 sm:px-6">
      <h1 className="font-display text-display-s text-foreground">You are offline</h1>
      <p className="text-muted-foreground text-body-m leading-relaxed">
        MedSync needs a connection to show your visits or book a day. Your booking code is in the
        text message we sent you, and the hospital can find your booking at the desk.
      </p>
      <p className="text-foreground text-body-m leading-relaxed">
        If you are very sick now, do not wait for this page. Go to the hospital&rsquo;s emergency
        entrance.
      </p>
      <a
        href="/patient"
        className="text-primary text-body-s w-fit underline-offset-4 hover:underline"
      >
        Try again
      </a>
    </main>
  );
}

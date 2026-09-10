import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";

/** Shown for any address that does not match one of the nine screens. */
export function NotFound() {
  return (
    <div className="mx-auto flex max-w-prose flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span className="text-caption tabular font-mono text-gray-500">404</span>
        <h1 className="font-display text-heading-l text-gray-900">Page not found</h1>
        <p className="text-body-l text-gray-600">
          That address does not match any screen in this explorer.
        </p>
      </header>

      <Card tone="muted">
        <p className="text-body-s text-gray-600">
          Use the screen list, or{" "}
          <Link to="/" className="text-teal-700 underline underline-offset-2">
            go to the overview
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}

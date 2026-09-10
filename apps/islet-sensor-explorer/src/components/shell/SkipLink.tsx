/** The first focusable element on the page. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="focus:text-body-s sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-60 focus:rounded-md focus:border focus:border-teal-100 focus:bg-teal-50 focus:px-3 focus:py-2 focus:font-medium focus:text-teal-700"
    >
      Skip to content
    </a>
  );
}

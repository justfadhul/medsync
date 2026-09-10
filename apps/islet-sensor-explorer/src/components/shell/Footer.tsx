import { META } from "@/content/sensor";
import { asText } from "@/lib/content";

/** Renders META.footer verbatim, with the programme line above it. */
export function Footer() {
  const strapline = asText(META.strapline);

  return (
    <footer className="border-t border-gray-200 bg-gray-50 px-4 py-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <p className="text-body-s text-gray-600">
          {asText(META.programme)}
          {strapline ? `. ${strapline}` : ""}
        </p>
        <p className="text-body-s max-w-prose text-gray-500">{asText(META.footer)}</p>
        <p className="text-caption tabular font-mono text-gray-500">{asText(META.documentCode)}</p>
      </div>
    </footer>
  );
}

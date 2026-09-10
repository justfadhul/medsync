import { Button } from "@/components/ui/Button";
import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { META } from "@/content/sensor";
import { asText } from "@/lib/content";
import { useTheme } from "@/lib/use-theme";

export interface HeaderProps {
  onOpenSources: () => void;
}

/** Programme name, document code, theme choice and the sources drawer trigger. */
export function Header({ onOpenSources }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <header className="glass sticky top-0 z-40 h-14 border-b border-gray-200">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 flex-col justify-center leading-tight">
          <span className="text-body-s lg:text-body-m truncate font-medium text-gray-900">
            {asText(META.programme)}
          </span>
          <span className="text-caption tabular truncate font-mono text-gray-500">
            {asText(META.documentCode)}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onOpenSources}>
            Sources
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            aria-pressed={isDark}
            aria-label={isDark ? "Switch to the light theme" : "Switch to the dark theme"}
          >
            {isDark ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
            <span className="hidden sm:inline">{isDark ? "Dark" : "Light"}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

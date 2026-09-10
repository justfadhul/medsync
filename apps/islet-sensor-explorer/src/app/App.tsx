import { AppRoutes } from "@/app/routes";
import { AppShell } from "@/components/shell/AppShell";

export function App() {
  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  );
}

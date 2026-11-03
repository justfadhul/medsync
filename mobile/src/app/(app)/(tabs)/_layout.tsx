import type { NavPlace } from "@/components/tide/tide-nav";
import { Tabs, useRouter } from "expo-router";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TideNav } from "@/components/tide/tide-nav";
import { useMedicines } from "@/data/medicines";
import { useNow } from "@/lib/use-now";

/**
 * The four places, Home, Visits, Care and Me, under Tide's floating pill
 * (ADR 0340). The centre plus is not a tab: it opens "What would you like to
 * do?" over the current screen (`/add`). Help is never in the nav; it is the
 * red button in every screen's header (law L6).
 */
const ROUTE_FOR: Record<NavPlace, string> = {
  home: "index",
  visits: "visits",
  care: "care",
  me: "me",
};
const PLACE_FOR: Record<string, NavPlace> = {
  index: "home",
  visits: "visits",
  care: "care",
  me: "me",
};

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { dueNow } = useMedicines(useNow());

  return (
    <Tabs
      // No cross-fade between tabs: a scene caught mid-fade could stay transparent (white).
      screenOptions={{ headerShown: false, animation: "none" }}
      tabBar={({ state, navigateToTab }) => {
        const current = PLACE_FOR[state.routes[state.index]?.name ?? "index"] ?? "home";
        return (
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", left: 16, right: 16, bottom: 14 + insets.bottom }}
          >
            <TideNav
              width={width - 32}
              current={current}
              careCount={dueNow.length}
              onNavigate={(place) => {
                const route = state.routes.find((r) => r.name === ROUTE_FOR[place]);
                if (route) navigateToTab(route.key);
              }}
              onPlus={() => router.push("/add")}
            />
          </View>
        );
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="visits" />
      <Tabs.Screen name="care" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

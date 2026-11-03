import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking, StyleSheet, Text } from "react-native";

import DangerScreen from "@/app/(app)/danger";
import HelpScreen from "@/app/help";
import { readingFromParams } from "@/features/safety/danger";
import { setAnalyticsSink } from "@/lib/analytics";
import { checkReading, readingValueText } from "@/lib/readings";
import { ThemeProvider, useTheme } from "@/theme/theme";
import { tideDark, tideLight } from "@/theme/tide";

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ kind: "bp", value: "186/122" }),
  useFocusEffect: jest.fn(),
}));
jest.mock("@/lib/session", () => ({
  useSession: () => ({ status: "signedOut", session: null, signOut: jest.fn() }),
}));
jest.mock("@/lib/emergency", () => ({
  emergencyEvent: jest.fn(),
  telUrl: (n: string) => `tel:${n}`,
  useEmergencySheet: () => ({ sheet: null, offline: false }),
}));
jest.mock("@/lib/booking", () => ({ fetchPatientProfile: jest.fn(async () => null) }));
jest.mock("@/offline/outbox", () => ({ enqueue: jest.fn() }));
jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getLastKnownPositionAsync: jest.fn(async () => null),
}));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

interface Json {
  props: { style?: unknown };
  children: (Json | string)[] | null;
}

/** Every backgroundColor in a rendered tree. */
function backgrounds(node: Json | Json[] | null): string[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(backgrounds);
  const style = StyleSheet.flatten(node.props.style as never) as
    | { backgroundColor?: unknown }
    | undefined;
  const own = typeof style?.backgroundColor === "string" ? [style.backgroundColor] : [];
  const kids = (node.children ?? []).filter((c): c is Json => typeof c !== "string");
  return [...own, ...kids.flatMap(backgrounds)];
}

/** Shows the scheme the app itself is in, outside the forced-light route. */
function Probe() {
  return <Text testID="probe">{useTheme().tide.scheme}</Text>;
}

describe("law L11: Help and the danger interrupt stay light in dark mode", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem("medsync-theme", "dark");
  });

  it.each([
    ["Help", HelpScreen],
    ["Danger", DangerScreen],
  ])("%s renders the light palette", async (_name, Route) => {
    const view = await render(
      <ThemeProvider>
        <Probe />
        <Route />
      </ThemeProvider>,
    );
    await waitFor(() => expect(view.getByTestId("probe").props.children).toBe("dark"));
    const bgs = backgrounds(view.toJSON() as Json | null);
    expect(bgs).toContain(tideLight.bg);
    expect(bgs).not.toContain(tideDark.bg);
    expect(bgs).not.toContain(tideDark.surface);
  });
});

const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

describe("SOS countdown", () => {
  const events: string[] = [];
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    events.length = 0;
    setAnalyticsSink((e) => events.push(e));
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  });
  afterEach(() => {
    openURL.mockRestore();
    jest.useRealTimers();
  });

  it("cancelling within 3 s dials nothing", async () => {
    await render(<HelpScreen />);
    await fireEvent.press(screen.getByTestId("sos"));
    await tick(2500);
    expect(screen.getByText("Calling in 1…")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("sos-cancel"));
    await tick(10_000);
    expect(openURL).not.toHaveBeenCalled();
    expect(events).toEqual(["sos_started", "sos_cancelled"]);
    expect(screen.getByText("Do you need help now?")).toBeTruthy();
  });

  it("nothing is dialled before the 3 s are up, then tel:112 once", async () => {
    await render(<HelpScreen />);
    await fireEvent.press(screen.getByTestId("sos"));
    await tick(2999);
    expect(openURL).not.toHaveBeenCalled();
    await tick(1);
    await tick(10_000);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith("tel:112");
    expect(events).toEqual(["sos_started", "sos_called"]);
  });
});

describe("danger params", () => {
  it("reads a BP pair and checks it against the threshold file", () => {
    const input = readingFromParams({ kind: "bp", value: "186/122" });
    expect(input).toEqual({ kind: "bp", top: 186, bottom: 122 });
    expect(checkReading(input).level).toBe("danger");
  });
  it("reads back what the callers send: value text with its unit, and the sugar context", () => {
    const sent = { kind: "sugar" as const, value: 2.6, context: "fasting" as const };
    const back = readingFromParams({
      kind: "sugar",
      value: readingValueText(sent),
      context: "fasting",
    });
    expect(back).toEqual(sent);
    expect(checkReading(back).level).toBe(checkReading(sent).level);
  });
  it("defaults an unknown sugar context to 'another time'", () => {
    expect(readingFromParams({ kind: "sugar", value: "3.1", context: "brunch" })).toEqual({
      kind: "sugar",
      value: 3.1,
      context: "random",
    });
  });
  it("reads pulse and treats junk as empty", () => {
    expect(readingFromParams({ kind: "pulse", value: "140" })).toEqual({
      kind: "pulse",
      value: 140,
    });
    expect(checkReading(readingFromParams({ kind: "bp", value: "abc" })).level).toBe("empty");
  });
});

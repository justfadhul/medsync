/* Jest setup for the Expo app: native modules that have no JS fallback. */
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
// Reanimated 4.7.1 (SDK 58) calls a native-only CSS hook while it starts, and
// its JS stand-in throws there. A no-op lets it start under Jest.
// ponytail: drop this once Reanimated's JS module stops throwing on it.
// The official mock loads Reanimated's TypeScript source, so the patch goes there.
jest.mock("react-native-reanimated/src/ReanimatedModule/js-reanimated/JSReanimated", () => {
  const actual = jest.requireActual(
    "react-native-reanimated/src/ReanimatedModule/js-reanimated/JSReanimated",
  );
  return {
    ...actual,
    createJSReanimatedModule: () =>
      Object.assign(actual.createJSReanimatedModule(), { setCSSEventHandler: () => {} }),
  };
});
// Animated components need a host view Jest cannot give them in 4.7.1; the
// official mock renders plain views (no test reads an animated style).
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

import { useEffect } from "react";
import { BricolageGrotesque_600SemiBold, useFonts } from "@expo-google-fonts/bricolage-grotesque";
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from "@expo-google-fonts/geist";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

import { SessionProvider, useSession } from "@/lib/session";
import { ThemeProvider, useTheme } from "@/theme/theme";

/**
 * Hold the NATIVE splash until the brand fonts are in memory.
 *
 * Without this the first frame renders the wordmark in the system face and
 * then swaps to Bricolage Grotesque — a visible flash of the wrong typography on the one
 * screen whose whole job is the brand. Holding the native splash means the
 * handoff happens while nothing is on screen, and because its background is
 * `brand-950` — the same colour the React splash starts on — the transition
 * reads as one continuous surface rather than two screens.
 *
 * It is NOT held for the session. The React splash is where the session
 * resolves: its ECG hold exists to cover exactly that wait, and a native
 * splash frozen over it would show a still image instead.
 */
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_600SemiBold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
  });

  useEffect(() => {
    // Hide on error too, deliberately. A font that fails to load is a
    // degraded screen; a splash that never lifts is a dead app, and on an
    // intermittent connection the second is the likelier failure.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Both providers sit OUTSIDE the font gate on purpose: `getSession()` and
  // the stored-theme read are then already in flight while the font files
  // download, instead of three independent waits running back to back on the
  // slowest connection.
  return (
    <ThemeProvider>
      <SessionProvider>{fontsLoaded || fontError ? <RootNavigator /> : null}</SessionProvider>
    </ThemeProvider>
  );
}

/**
 * The gate.
 *
 * `Stack.Protected` is the SDK 57 idiom and it does the one thing a hand-rolled
 * redirect gets wrong: when a guard flips false the router drops those screens
 * from the navigation history entirely, so a signed-in patient cannot swipe or
 * hardware-back their way onto the welcome screen, and a signed-out one cannot
 * land on a booking screen and watch it fail with an RLS error.
 *
 * `loading` sits on the SIGNED-OUT side, which is the one judgement call here.
 * It has to: the splash is what covers the wait — its ECG hold is gated on the
 * session resolving — and the welcome call to action underneath only appears
 * once that hold ends. A signed-in patient is therefore already gone before
 * there is anything to see, while an unauthenticated workspace is never
 * mounted and never issues a query it cannot satisfy.
 */
function RootNavigator() {
  const { status } = useSession();
  const { colors, ready } = useTheme();
  const signedIn = status === "signedIn";

  // Held on the theme the way the native splash is held on the fonts: the
  // first frame is in the patient's theme, not the phone's and then theirs.
  if (!ready) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      {/* ADR 0098 Law 5: the Emergency sheet is reachable signed out — the
          pre-auth screens' red disc opens it. Signed in, the tab is E1. */}
      <Stack.Screen name="emergency" />
    </Stack>
  );
}

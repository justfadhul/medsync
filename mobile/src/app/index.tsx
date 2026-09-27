import type { LayoutChangeEvent } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EcgLoader } from "@/components/brand/ecg-loader";
import { EmergencyButton } from "@/components/patient/emergency-button";
import { useSplashSequence } from "@/hooks/use-splash-sequence";
import { useSession } from "@/lib/session";
import { splashPhoto } from "@/theme/splash-photo";
import { brand, font, mint, motion, radius, space, withAlpha } from "@/theme/tokens";

const EASE = Easing.bezier(...motion.easing);

/**
 * Share of the screen height the photograph occupies, anchored to the top.
 *
 * This is the zoom dial, and it works indirectly. `cover` scales the image by
 * whichever dimension needs more magnification; on a phone that is always the
 * height, so the height of the BOX is what decides how much of the photograph
 * survives. Shorter box, less magnification, more frame.
 *
 *   1.00  full-bleed   61% of the photo's width visible
 *   0.85  here          72%
 *   0.64  reference     96%
 */
const PHOTO_HEIGHT_RATIO = 0.85;

/** Wordmark size at rest, centred. */
const WORDMARK_SIZE = 46;
/** What it shrinks to when it docks — 46 × 0.46 ≈ 21px, a header-sized mark. */
const DOCK_SCALE = 0.46;
/** Where the centred wordmark sits, as a share of screen height. */
const WORDMARK_CENTRE_RATIO = 0.4;
/**
 * The tagline shrinks far less than the wordmark when both dock.
 *
 * A logotype survives being small — it is a shape people recognise. A sentence
 * does not: at the wordmark's 0.46 this would land at 7px and stop being
 * readable, which would make it decoration rather than a line of copy. 0.82
 * takes it to ~13px, still a legible caption under the mark.
 */
const TAGLINE_DOCK_SCALE = 0.82;

/** Where the signup flow lives until the app owns its own. */
const GET_STARTED_URL = "https://medsync-six.vercel.app/get-started";

/**
 * The splash / welcome screen.
 *
 * One screen, two states. While the app loads the wordmark sits large and
 * centred over the photograph with the ECG beating beneath it. When the beats
 * finish, the wordmark scales down and travels to the top-left corner — where
 * a logo lives in an app — the tagline goes with it, and the call to action
 * takes the floor.
 *
 * Nothing is unmounted and remounted: the same wordmark moves, so it reads as
 * the screen BECOMING the app rather than one screen replacing another.
 */
export default function SplashScreen() {
  const insets = useSafeAreaInsets();
  // Explicit pixel dimensions, not a percentage. A `%` height on an absolutely
  // positioned Image can leave the view without a resolved box, and `cover`
  // with no box to fit falls back to the source's native size.
  const { width: screenW, height: screenH } = useWindowDimensions();

  const router = useRouter();
  const { status } = useSession();
  // The brand hold now covers the session check — which is what the hold was
  // always for. `loading` is not "signed out": while it resolves, the welcome
  // call to action stays behind the ECG, so a patient who turns out to be
  // signed in reaches the workspace without ever being shown it.
  const { stage, pulses } = useSplashSequence(status !== "loading");
  const isReady = stage === "ready";

  // The wordmark's own width, needed to work out how far left it must travel
  // to reach the corner. Measured rather than guessed: it depends on the font
  // file, the size and the device's text scaling, none of which are knowable
  // up front. setState in a layout handler is an event, not a render, so the
  // purity rule does not apply.
  const [wordW, setWordW] = useState(0);
  const onWordLayout = useCallback((e: LayoutChangeEvent) => {
    setWordW(e.nativeEvent.layout.width);
  }, []);
  const [tagW, setTagW] = useState(0);
  const onTagLayout = useCallback((e: LayoutChangeEvent) => {
    setTagW(e.nativeEvent.layout.width);
  }, []);

  const openGetStarted = useCallback(() => {
    // Fire and forget with a caught rejection: there is nothing useful to tell
    // a patient if the OS refuses to open a browser, and an unhandled promise
    // would surface as a redbox in dev and a silent crash risk in release.
    Linking.openURL(GET_STARTED_URL).catch(() => {});
  }, []);

  // Where the wordmark comes to rest: top-left, on the same gutter the content
  // column uses so it lines up with everything else.
  const dockedLeft = space[5];
  const dockedTop = insets.top + space[2];
  // Clears the docked wordmark: 46px at 0.46 is ~21px tall with its leading.
  const taglineDockedTop = dockedTop + WORDMARK_SIZE * 1.12 * DOCK_SCALE + space[1];

  const fadeIn = useSharedValue(0);
  const taglineIn = useSharedValue(0);
  const ctaIn = useSharedValue(0);
  /** 0 = centred and large, 1 = docked in the corner and small. */
  const dock = useSharedValue(0);

  useEffect(() => {
    // Hold the entrance until the wordmark has been measured, or the first
    // frame would place it using a width of 0 and it would visibly jump.
    if (wordW === 0 || tagW === 0) return;
    fadeIn.value = withTiming(1, { duration: motion.slow, easing: EASE });
    taglineIn.value = withDelay(
      motion.stagger * 3,
      withTiming(1, { duration: motion.slow, easing: EASE }),
    );
  }, [wordW, tagW, fadeIn, taglineIn]);

  useEffect(() => {
    if (!isReady) return;
    // 620ms: longer than the sanctioned 400ms because this is a journey across
    // the screen, not a state change. The four durations govern how a thing
    // changes; a mark travelling the diagonal needs the time that distance
    // actually takes, or it reads as a jump.
    dock.value = withTiming(1, { duration: 620, easing: EASE });
    ctaIn.value = withDelay(240, withTiming(1, { duration: motion.slow, easing: EASE }));
  }, [isReady, dock, ctaIn]);

  const wordStyle = useAnimatedStyle(() => {
    // Distance from the docked anchor out to the centred position. Computed on
    // the UI thread so a rotation is picked up without a re-render.
    const toCentreX = (screenW - wordW) / 2 - dockedLeft;
    const toCentreY = screenH * WORDMARK_CENTRE_RATIO - dockedTop;
    const away = 1 - dock.value;
    return {
      opacity: fadeIn.value,
      transform: [
        { translateX: toCentreX * away },
        { translateY: toCentreY * away },
        { scale: DOCK_SCALE + (1 - DOCK_SCALE) * away },
      ],
    };
  });

  // The tagline travels with the wordmark rather than leaving. Same anchor
  // trick — laid out at its docked spot under the mark, translated out to the
  // centre — and driven by the SAME `dock` value, so the two move as one block
  // and cannot drift apart on a slow device.
  const taglineStyle = useAnimatedStyle(() => {
    const toCentreX = (screenW - tagW) / 2 - dockedLeft;
    const toCentreY =
      screenH * WORDMARK_CENTRE_RATIO + WORDMARK_SIZE * 1.12 + space[4] - taglineDockedTop;
    const away = 1 - dock.value;
    return {
      opacity: taglineIn.value,
      transform: [
        { translateX: toCentreX * away },
        { translateY: toCentreY * away },
        { scale: TAGLINE_DOCK_SCALE + (1 - TAGLINE_DOCK_SCALE) * away },
      ],
    };
  });

  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaIn.value,
    transform: [{ translateY: (1 - ctaIn.value) * 14 }],
  }));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {splashPhoto ? (
        <Image
          source={splashPhoto}
          // Height-bounded so `cover` magnifies less. See PHOTO_HEIGHT_RATIO.
          style={[styles.photo, { width: screenW, height: screenH * PHOTO_HEIGHT_RATIO }]}
          // As a PROP. `resizeMode` is typed on ImageStyle and accepted there
          // without complaint, but did not take effect — types passing is not
          // the same as behaviour working.
          resizeMode="cover"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      {/* Two scrims in one pass: a deep one at the top so the status bar and
          the wordmark sit on colour rather than on window light, and another
          at the bottom carrying the photograph into the solid ground the
          button sits on. The middle is left clear — a scrim running edge to
          edge is a tint, and would undo scaling the photo out. */}
      <LinearGradient
        colors={[
          withAlpha(brand[950], 0.72),
          withAlpha(brand[950], 0.3),
          "transparent",
          withAlpha(brand[950], 0.68),
          brand[950],
        ]}
        locations={[0, 0.1, 0.3, 0.76, PHOTO_HEIGHT_RATIO]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Anchored at the DOCKED position and translated OUT to the centre,
          rather than the other way round. Laying it out where it ends up means
          the corner placement is plain style that cannot drift, and only the
          temporary state is computed. `transformOrigin` top-left pins the
          scale to that anchor, so shrinking does not also nudge it. */}
      <Animated.View
        style={[styles.wordmarkAnchor, { left: dockedLeft, top: dockedTop }, wordStyle]}
        pointerEvents="none"
      >
        <Text style={styles.wordmark} onLayout={onWordLayout} accessibilityRole="header">
          medsync
        </Text>
      </Animated.View>

      <Animated.View
        style={[styles.wordmarkAnchor, { left: dockedLeft, top: taglineDockedTop }, taglineStyle]}
        pointerEvents="none"
      >
        <Text style={styles.tagline} onLayout={onTagLayout}>
          Book your visit. Keep your place.
        </Text>
      </Animated.View>

      {/* ADR 0098 ruling 7: the pre-auth screens carry the red disc, and here
          it opens the root Emergency sheet — signed out, there is no tab. */}
      <View style={[styles.discAnchor, { top: insets.top + space[2], right: space[5] }]}>
        <EmergencyButton href="/emergency" />
      </View>

      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.middle} />

        <View style={styles.footer}>
          {isReady ? (
            <Animated.View style={[styles.ctaBlock, ctaStyle]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create an account"
                onPress={openGetStarted}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              >
                <Text style={styles.ctaLabel}>Create account</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in to an existing account"
                onPress={() => router.push("/sign-in")}
                hitSlop={12}
                style={styles.secondary}
              >
                <Text style={styles.secondaryLabel}>I already have an account</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <View style={styles.loadingBlock}>
              <EcgLoader visible={!isReady} label="Loading" cycles={pulses} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand[950] },
  // Full-bleed behind everything; dimensions come from the window.
  photo: { position: "absolute", top: 0, left: 0 },

  wordmarkAnchor: { position: "absolute", transformOrigin: "left top" },
  discAnchor: { position: "absolute", zIndex: 2 },
  wordmark: {
    fontFamily: font.wordmark,
    fontSize: WORDMARK_SIZE,
    lineHeight: WORDMARK_SIZE * 1.12,
    letterSpacing: -1.2,
    color: "#ffffff",
  },

  content: { flex: 1, paddingHorizontal: space[5], justifyContent: "space-between" },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: space[16] },
  tagline: {
    fontFamily: font.body,
    fontSize: 15.5,
    lineHeight: 23,
    // No maxWidth and no centring: it is absolutely positioned now, and must
    // stay ONE line so its measured width is the real travel distance. Wrapped
    // text would make the centred position wrong.
    color: brand[200],
  },

  footer: {
    minHeight: 132,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: space[8],
  },
  loadingBlock: { alignItems: "center", justifyContent: "center", height: 108 },
  ctaBlock: { width: "100%", alignItems: "center", gap: space[4], height: 108 },

  cta: {
    width: "100%",
    minHeight: 52,
    borderRadius: radius.full,
    backgroundColor: mint[400],
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[6],
  },
  // Opacity, not scale — a button that shrinks under the thumb hides the label
  // at the moment the thumb is already covering it.
  ctaPressed: { opacity: 0.88 },
  ctaLabel: {
    fontFamily: font.bodyMedium,
    fontSize: 16,
    letterSpacing: 0.1,
    // Chroma's primary on a dark ground: the bright teal with deep-teal text (7.8:1).
    color: brand[950],
  },

  secondary: { minHeight: 44, justifyContent: "center" },
  secondaryLabel: { fontFamily: font.body, fontSize: 14.5, color: brand[200] },
});

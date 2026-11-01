import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { font, motion, space } from "@/theme/tokens";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The MedSync loading mark, ported from `components/medsync/ecg-loader.tsx`.
 *
 * One cardiac cycle drawn left→right — baseline · P wave · PR · QRS spike ·
 * ST · T wave · baseline — that sweeps across and then out behind itself, the
 * way a monitor trace does. The PATH and the easing are lifted verbatim from
 * the web component so the two loading states are the same mark, not two
 * drawings of the same idea. The TEMPO is deliberately not — see `CYCLE_MS`.
 *
 * ponytail: the path is duplicated rather than shared. The web version lives
 * in a `.tsx` that imports `cn` and renders DOM, so there is nothing importable
 * without splitting the constant into its own module for one consumer.
 * Ceiling: the trace changing shape on one platform and not the other.
 * Upgrade path: move `ECG_PATH` into a plain `.ts` both can import — three
 * lines, and worth doing the moment anyone edits the curve.
 */
const ECG_PATH =
  "M2 36 H56 Q60 36 62 32 Q65 26 68 32 Q70 36 74 36 H96 L102 36 L108 10 L114 54 L120 30 L124 36 H148 Q153 36 156 28 Q160 18 165 28 Q168 36 174 36 H238";

/** Path length. Matches the web's dasharray — the trace is drawn, not guessed. */
const TRACE_LENGTH = 480;

/**
 * One full P-QRS-T cycle in 1300ms.
 *
 * The web loader runs this trace at 2200ms. The phone runs it faster on
 * purpose: Android's SplashScreen guidance recommends not exceeding 1,000ms
 * for a launch animation, and a 2200ms cycle means a splash either exceeds
 * that cap or cuts the beat off mid-trace. At 1000ms a COMPLETE cardiac cycle
 * lands inside the platform's own ceiling — more of the mark than the slower
 * timing showed, not less.
 *
 * 1300ms is ~46bpm — slower than a resting heart, which is the point: the
 * trace is meant to feel calm rather than urgent on a screen someone may open
 * because they are unwell. The web's 2200ms is the stylised end of the same
 * idea.
 *
 * ponytail: the two platforms now differ. Ceiling: someone edits the trace on
 * one and not the other and they drift apart in shape as well as speed.
 * Upgrade path: move `ECG_PATH` into a shared `.ts` — the shape is the part
 * that must not diverge; the tempo is legitimately per-platform.
 */
export const CYCLE_MS = 1300;
const EASE_SYMMETRIC = Easing.bezier(0.45, 0, 0.55, 1);

export function EcgLoader({
  label = "Loading",
  width = 176,
  color = "#ffffff",
  visible = true,
  cycles,
}: {
  label?: string;
  width?: number;
  color?: string;
  visible?: boolean;
  /**
   * How many beats to play before stopping. Omit to loop forever — which is
   * right for an open-ended wait, and wrong for a splash, where the loop is
   * the thing being timed.
   */
  cycles?: number;
}) {
  const reduced = useReducedMotion();
  const offset = useSharedValue(TRACE_LENGTH);
  const fade = useSharedValue(0);

  useEffect(() => {
    fade.value = withTiming(visible ? 1 : 0, {
      duration: motion.normal,
      easing: Easing.bezier(...motion.easing),
    });
  }, [visible, fade]);

  useEffect(() => {
    if (reduced) {
      // Reduce Motion (Apple HIG): no repeating sweep; the whole trace shows, still.
      offset.value = 0;
      return;
    }
    if (!visible) {
      // Stop the loop rather than let it spin behind an invisible view —
      // a phone that keeps animating offscreen is spending battery on nothing.
      cancelAnimation(offset);
      return;
    }
    // The web keyframe is 0% → 55% → 100%, so the draw-in takes 55% of the
    // cycle and the sweep-out 45%. Split the same way rather than halving it:
    // the asymmetry is what makes the trace look like it is being written and
    // then scrolling away, instead of bouncing.
    offset.value = TRACE_LENGTH;
    offset.value = withRepeat(
      withSequence(
        withTiming(0, { duration: CYCLE_MS * 0.55, easing: EASE_SYMMETRIC }),
        withTiming(-TRACE_LENGTH, { duration: CYCLE_MS * 0.45, easing: EASE_SYMMETRIC }),
      ),
      // -1 loops forever. A finite count stops the trace cleanly at the end of
      // a beat, so the last thing seen is a completed cycle rather than a
      // heartbeat cut in half.
      cycles ?? -1,
      false,
    );
    return () => cancelAnimation(offset);
  }, [visible, offset, cycles, reduced]);

  const traceProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const wrapStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      style={[styles.wrap, wrapStyle]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <Svg width={width} height={width * (64 / 240)} viewBox="0 0 240 64" fill="none">
        {/* Ghost trace. Always drawn, so the mark reads as an ECG even at the
            instant the live trace is offscreen — without it the loader blinks
            empty once per cycle. */}
        <Path
          d={ECG_PATH}
          stroke={color}
          strokeOpacity={0.15}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Live trace. */}
        <AnimatedPath
          d={ECG_PATH}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={TRACE_LENGTH}
          animatedProps={traceProps}
        />
      </Svg>

      <Text style={[styles.label, { color }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space[3] },
  label: {
    fontFamily: font.body,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    // Colour comes from the `color` prop so the label and the trace can never
    // disagree — they are one mark.
    opacity: 0.72,
  },
});

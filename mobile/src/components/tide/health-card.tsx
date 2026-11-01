import { useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { Press } from "@/components/tide/press";
import { CARD_ART } from "@/data/card-art";
import { EASE_OUT_FN } from "@/motion/presets";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

/** Bank-card proportion (ISO/IEC 7810 ID-1). */
export const CARD_RATIO = 1.586;

export interface HealthCardData {
  holder: string;
  /** Spaced code, or "Given at your first visit". */
  number: string;
  /** Null until the patient has a home facility. */
  facility: string | null;
  /** "34 years", from the date of birth; null when there is none. */
  age: string | null;
  /** Null when the patient keeps them off the card (the default, PRD Q6). */
  conditions: string | null;
  /** The patient's own allergy list, "No known allergies", or "None listed". */
  allergies: string;
  /** "On file at Mulago" or "None given" (the number is encrypted, never on the phone); null: unknown. */
  nextOfKin: string | null;
  /** "If found, call Mulago on 0414 …", or return to the home facility when no number is set. */
  ifFound: string;
}

/**
 * The health card (§8.6): a bank-card-sized navy front and a light back for
 * whoever finds the card or treats the holder (ADR 0414): the number large,
 * allergies, conditions (only when the holder shows them), whether a next of
 * kin is on file, and who to call. Tap to turn, as the visit ticket does
 * (ADR 0409): each face turns on its own, half a turn apart, so the face
 * turned away is hidden (a turned parent showed the front mirrored). Under
 * reduce motion it cross-fades. Everything comes in as props, so the screen
 * can draw it from the phone's cache with no network. No blood group: the
 * record does not hold one.
 *
 * No QR: a code that encodes nothing would invite a scan that fails, and the
 * patient code alone is not an authenticator (PRD Q2). The desk reads the
 * printed number.
 */
export function HealthCard({ data }: { data: HealthCardData }) {
  const t = useTide();
  const reduced = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const turn = useSharedValue(0);
  const flip = () => {
    const next = !flipped;
    setFlipped(next);
    turn.value = withTiming(next ? 1 : 0, { duration: reduced ? 150 : 450, easing: EASE_OUT_FN });
  };
  const frontStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 1 - turn.value : 1,
    transform: [{ perspective: 1100 }, { rotateY: `${reduced ? 0 : turn.value * 180}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: reduced ? turn.value : 1,
    transform: [{ perspective: 1100 }, { rotateY: `${reduced ? 0 : turn.value * 180 + 180}deg` }],
  }));
  const label = (s: string) => (
    <Text
      style={[
        tType.micro,
        { fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: t.onBand2 },
      ]}
    >
      {s}
    </Text>
  );
  const face = {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: tRadius.cardLg,
    overflow: "hidden" as const,
    backfaceVisibility: "hidden" as const,
  };
  const row = (k: string, v: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: tSpace[2.5] }}>
      <Text style={[tType.caption, { fontFamily: tFont.medium, color: t.ink3 }]}>{k}</Text>
      <Text
        numberOfLines={1}
        style={[
          tType.caption,
          { fontFamily: tFont.bold, color: t.ink, textAlign: "right", flexShrink: 1 },
        ]}
      >
        {v}
      </Text>
    </View>
  );

  const front = (
    <Animated.View
      accessibilityElementsHidden={flipped}
      importantForAccessibility={flipped ? "no-hide-descendants" : "auto"}
      style={[face, { backgroundColor: t.band, boxShadow: t.shadow.float }, frontStyle]}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 350 222"
        preserveAspectRatio="none"
        style={{ position: "absolute" }}
      >
        <Circle cx={330} cy={-10} r={120} fill={t.onBand} fillOpacity={0.05} />
        <Circle cx={300} cy={230} r={90} fill={t.accent} fillOpacity={0.12} />
      </Svg>
      <View
        style={{
          flex: 1,
          paddingVertical: tSpace[4],
          paddingHorizontal: tSpace[4.5],
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: tSpace[2] }}>
          <View>
            <Text style={{ fontFamily: tFont.extrabold, fontSize: 17, color: t.onBand }}>
              Med<Text style={{ color: t.accent }}>Sync</Text>
            </Text>
            {label("Health card")}
          </View>
          <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
            <Text
              numberOfLines={1}
              style={[tType.micro, { fontFamily: tFont.semibold, color: t.onBand }]}
            >
              {data.facility ?? "No home facility yet"}
            </Text>
            <Text style={[tType.micro, { fontSize: 11, color: t.onBand2 }]}>Home facility</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[3] }}>
          <View
            style={{
              width: 40,
              height: 30,
              borderRadius: 7,
              backgroundColor: CARD_ART.chip,
              borderWidth: 1,
              borderColor: CARD_ART.chipLine,
              justifyContent: "center",
            }}
          >
            <View
              style={{
                height: 14,
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderColor: CARD_ART.chipLine,
              }}
            />
          </View>
          <Text
            accessibilityLabel={`Number ${data.number}`}
            adjustsFontSizeToFit
            numberOfLines={1}
            style={
              /\d/.test(data.number)
                ? {
                    flex: 1,
                    fontFamily: tFont.monoSemibold,
                    fontSize: 20,
                    letterSpacing: 2.6,
                    color: t.onBand,
                  }
                : // No number yet: the sentence in plain type, not the code face.
                  { flex: 1, fontFamily: tFont.semibold, fontSize: 15, color: t.onBand2 }
            }
          >
            {data.number}
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: tSpace[2.5],
          }}
        >
          <View style={{ flex: 1, gap: tSpace[1.5] }}>
            <View>
              {label("Card holder")}
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: tFont.bold,
                  fontSize: 15,
                  letterSpacing: 0.3,
                  color: t.onBand,
                }}
              >
                {data.holder.toUpperCase()}
              </Text>
            </View>
          </View>
          {data.age ? (
            <View style={{ alignItems: "flex-end" }}>
              {label("Age")}
              <Text style={[tType.bodyS, { fontFamily: tFont.semibold, color: t.onBandAccent }]}>
                {data.age}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );

  const back = (
    <Animated.View
      accessibilityElementsHidden={!flipped}
      importantForAccessibility={flipped ? "auto" : "no-hide-descendants"}
      style={[
        face,
        {
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t.line,
          boxShadow: t.shadow.float,
        },
        backStyle,
      ]}
    >
      <View
        style={{
          flex: 1,
          paddingTop: tSpace[3],
          paddingBottom: tSpace[2.5],
          paddingHorizontal: tSpace[4],
          gap: tSpace[1.5],
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[2] }}>
          <Text
            style={[
              tType.micro,
              {
                flex: 1,
                fontFamily: tFont.bold,
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: t.accentText,
              },
            ]}
          >
            In an emergency
          </Text>
          <Text style={{ fontFamily: tFont.extrabold, fontSize: 12, color: t.ink }}>
            Med<Text style={{ color: t.accentText }}>Sync</Text>
          </Text>
        </View>
        <View
          style={{
            paddingVertical: tSpace[1.5],
            paddingHorizontal: tSpace[2.5],
            borderRadius: tRadius.sm,
            backgroundColor: t.surface2,
          }}
        >
          <Text style={[tType.micro, { fontSize: 11, letterSpacing: 1.1, color: t.ink3 }]}>
            MEDSYNC NUMBER
          </Text>
          <Text
            accessibilityLabel={`MedSync number ${data.number}`}
            adjustsFontSizeToFit
            numberOfLines={1}
            style={
              /\d/.test(data.number)
                ? { fontFamily: tFont.monoSemibold, fontSize: 22, letterSpacing: 2.4, color: t.ink }
                : { fontFamily: tFont.semibold, fontSize: 14, color: t.ink2 }
            }
          >
            {data.number}
          </Text>
        </View>
        {row("Allergies", data.allergies)}
        {row("Conditions", data.conditions ?? "Hidden by the card holder")}
        {data.nextOfKin ? row("Next of kin", data.nextOfKin) : null}
        <View style={{ flex: 1 }} />
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          style={[tType.caption, { fontFamily: tFont.semibold, color: t.ink }]}
        >
          {data.ifFound}
        </Text>
        <Text numberOfLines={1} style={[tType.micro, { fontSize: 11, color: t.ink3 }]}>
          Written by the card holder · not confirmed by a clinician
        </Text>
      </View>
    </Animated.View>
  );

  return (
    <Press
      onPress={flip}
      accessibilityLabel={
        flipped ? "Health card, back. Tap to turn over" : "Health card, front. Tap to turn over"
      }
      accessibilityState={{ expanded: flipped }}
      haptic
      style={{ width: "100%", aspectRatio: CARD_RATIO }}
    >
      {front}
      {back}
    </Press>
  );
}

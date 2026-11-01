import type { IconName } from "@/components/tide";
import type { StartValues } from "@/data/readings";
import type { ReadingInput, ReadingKind, ReadingLevel, SugarContext } from "@/lib/readings";
import type { Tide } from "@/theme/tide";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Text, TextInput, View } from "react-native";

import { Button, Chip, ChipRow, Icon, Pill, Press, Screen, SegmentTiles } from "@/components/tide";
import { hhmm } from "@/data/medicines";
import { lastTimeLine, readingsRepo, startValues, useReadings } from "@/data/readings";
import { saveButton } from "@/features/care/logic";
import { ReadingCapture } from "@/features/home/reading-capture";
import {
  checkReading,
  parseReading,
  readingValueText,
  SUGAR_CONTEXT_WORDS,
  THRESHOLDS_NOTE,
  UNITS,
} from "@/lib/readings";
import { useNow } from "@/lib/use-now";
import { savedLine } from "@/offline/outbox";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

const PROMPTS: Record<ReadingKind, string> = {
  bp: "Type the numbers from your machine",
  sugar: "The number on your meter",
  weight: "Morning, before breakfast",
  pulse: "Sitting still for a minute",
};

const CONTEXT_ICONS: Record<SugarContext, IconName> = {
  fasting: "sunrise",
  lunch: "sun",
  supper: "sunset",
  after: "utensils",
  bedtime: "moon",
  random: "clock",
};

const FEELINGS = [
  { key: "fine", label: "I feel fine" },
  { key: "dizzy", label: "Dizzy" },
  { key: "head", label: "Headache" },
  { key: "tired", label: "Very tired" },
  { key: "chest", label: "Chest pain" },
] as const;

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
const digits = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 3);
const decimal = (v: string) => v.replace(/[^0-9.]/g, "").slice(0, 5);

const bandColours = (t: Tide, level: ReadingLevel) =>
  ({
    empty: { bg: t.surface2, fg: t.ink2, dot: t.lineStrong },
    ok: { bg: t.stable.tint, fg: t.stable.text, dot: t.stable.text },
    watch: { bg: t.caution.tint, fg: t.caution.text, dot: t.caution.text },
    danger: { bg: t.critical.tint, fg: t.critical.text, dot: t.emergency },
  })[level];

/**
 * Log a reading, full page (board TReading, prompt §8.5, PRD F-15), into the
 * patient's own log (ADR 0342). The numbers start from their last reading,
 * or empty. The live check comes from `checkReading` over the pending-CSO
 * thresholds (L7). Only the patient sees the reading, so a dangerous one or
 * chest pain goes straight to Help: no one else is alerted.
 */
export default function ReadingScreen() {
  const t = useTide();
  const router = useRouter();
  const now = useNow();
  const [kind, setKind] = useState<ReadingKind>("bp");
  const { readings } = useReadings();
  // What the patient changed; anything untouched shows their last reading.
  const [edited, setEdited] = useState<Partial<StartValues>>({});
  const values: StartValues = { ...startValues(readings), ...edited };
  const [problem, setProblem] = useState<string | null>(null);
  const [ctx, setCtx] = useState<SugarContext>("fasting");
  const [feel, setFeel] = useState<string[]>([]);
  const [taps, setTaps] = useState(0);
  const tap = () => setTaps((n) => n + 1);

  const input: ReadingInput =
    kind === "bp"
      ? { kind, top: parseReading(values.top), bottom: parseReading(values.bottom) }
      : kind === "sugar"
        ? { kind, value: parseReading(values.sugar), context: ctx }
        : kind === "weight"
          ? { kind, value: parseReading(values.weight) }
          : { kind, value: parseReading(values.pulse) };
  const check = checkReading(input);
  const chestPain = feel.includes("chest");
  const save = saveButton(check.level, chestPain);
  const band = bandColours(t, check.level);

  const set = (key: keyof StartValues, v: string) => setEdited((s) => ({ ...s, [key]: v }));
  const pickFeel = (key: string) => {
    tap();
    setFeel((f) => {
      if (key === "fine") return f.includes("fine") ? [] : ["fine"];
      const rest = f.filter((k) => k !== "fine");
      return rest.includes(key) ? rest.filter((k) => k !== key) : [...rest, key];
    });
  };

  // Chest pain is an emergency whatever the number says: straight to Help.
  // A dangerous number alone opens the danger interrupt for that reading.
  const goForHelp = () => {
    if (chestPain || check.level !== "danger") router.replace("/help");
    else
      router.replace({
        pathname: "/danger",
        params: {
          kind,
          value: readingValueText(input),
          ...(kind === "sugar" ? { context: ctx } : {}),
        },
      });
  };

  const onSave = async () => {
    // Help never waits for the network.
    const saving =
      check.level !== "empty"
        ? readingsRepo.save(input, { entry: "page", taps: taps + 1, feel })
        : null;
    // A pulse read with blood pressure (photo or voice) is its own reading, saved beside it.
    const pulse = kind === "bp" ? parseReading(edited.pulse ?? "") : null;
    if (saving && pulse !== null)
      void readingsRepo.save({ kind: "pulse", value: pulse }, { entry: "page", taps: 0 });
    if (save.help) return goForHelp();
    const result = saving ? await saving : "failed";
    if (result === "failed") setProblem(savedLine(result));
    else router.back();
  };

  const bigInput = {
    fontFamily: tFont.monoSemibold,
    fontSize: 64,
    lineHeight: 70,
    letterSpacing: -3,
    color: t.ink,
    textAlign: "center" as const,
    padding: 0,
  };

  return (
    <Screen
      back={{ label: "Care" }}
      footer={
        <Button
          label={save.label}
          variant={save.help ? "danger" : "primary"}
          disabled={save.disabled}
          onPress={() => void onSave()}
          style={{ minHeight: 56 }}
        />
      }
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: tSpace[2],
        }}
      >
        <Text accessibilityRole="header" style={[tType.display, { color: t.ink, flexShrink: 1 }]}>
          Log a reading
        </Text>
        <Pill
          label={`Now · ${hhmm(now)}`}
          icon="clock"
          style={{ borderWidth: 1, borderColor: t.line }}
        />
      </View>

      <SegmentTiles
        value={kind}
        onChange={(k) => {
          tap();
          setKind(k);
        }}
        options={[
          { key: "bp", label: "Pressure", icon: "activity", iconColor: t.area.readings },
          { key: "sugar", label: "Sugar", icon: "droplet", iconColor: t.area.medicines },
          { key: "weight", label: "Weight", icon: "scale", iconColor: t.accentText },
          { key: "pulse", label: "Pulse", icon: "heart", iconColor: t.area.visits },
        ]}
      />

      <ReadingCapture
        kind={kind}
        onFill={(found) => {
          tap();
          setEdited((s) => ({ ...s, ...found }));
        }}
      />
      {kind === "bp" && edited.pulse ? (
        <Text style={[tType.caption, { color: t.ink2 }]}>
          {`Pulse ${edited.pulse} from your monitor is saved too.`}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: tRadius.xl,
          backgroundColor: t.surface,
          boxShadow: t.shadow.card,
          paddingTop: tSpace[4.5],
          paddingHorizontal: tSpace[4],
          paddingBottom: tSpace[3.5],
          alignItems: "center",
          gap: tSpace[1.5],
        }}
      >
        <Text style={[tType.bodyS, { color: t.ink2 }]}>{PROMPTS[kind]}</Text>
        {kind === "bp" ? (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
              }}
            >
              <TextInput
                value={values.top}
                onChangeText={(v) => set("top", digits(v))}
                keyboardType="number-pad"
                accessibilityLabel="Top number"
                placeholder="–"
                placeholderTextColor={t.ink4}
                selectTextOnFocus
                style={[bigInput, { width: 128 }]}
              />
              <Text
                style={{
                  fontFamily: tFont.medium,
                  fontSize: 54,
                  lineHeight: 70,
                  color: t.lineStrong,
                }}
              >
                /
              </Text>
              <TextInput
                value={values.bottom}
                onChangeText={(v) => set("bottom", digits(v))}
                keyboardType="number-pad"
                accessibilityLabel="Bottom number"
                placeholder="–"
                placeholderTextColor={t.ink4}
                selectTextOnFocus
                style={[bigInput, { width: 104 }]}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 70 }}>
              <Text style={[tType.overline, { fontSize: 11, color: t.ink3 }]}>Top</Text>
              <Text style={[tType.overline, { fontSize: 11, color: t.ink3 }]}>Bottom</Text>
            </View>
          </>
        ) : (
          <TextInput
            value={values[kind]}
            onChangeText={(v) => set(kind, kind === "pulse" ? digits(v) : decimal(v))}
            keyboardType={kind === "pulse" ? "number-pad" : "decimal-pad"}
            accessibilityLabel={PROMPTS[kind]}
            placeholder="–"
            placeholderTextColor={t.ink4}
            selectTextOnFocus
            style={[bigInput, { width: 190 }]}
          />
        )}
        <Text style={[tType.bodyS, { color: t.ink3 }]}>{UNITS[kind]}</Text>
        <View
          accessibilityLiveRegion="polite"
          style={{
            marginTop: tSpace[1.5],
            alignSelf: "stretch",
            paddingVertical: tSpace[2.5],
            paddingHorizontal: tSpace[3],
            borderRadius: 16,
            backgroundColor: band.bg,
            alignItems: "center",
            gap: 2,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[2] }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: band.dot }} />
            <Text style={[tType.labelS, { color: band.fg, textAlign: "center", flexShrink: 1 }]}>
              {check.text}
            </Text>
          </View>
          {check.selfCare ? (
            <Text style={[tType.labelS, { color: band.fg, textAlign: "center" }]}>
              {check.selfCare}
            </Text>
          ) : null}
        </View>
        <Text style={[tType.bodyS, { fontSize: 12, color: t.ink3 }]}>
          Last time: {lastTimeLine(readings, kind, now)}
        </Text>
      </View>

      {kind === "sugar" ? (
        <View style={{ gap: tSpace[2] }}>
          <Text style={[tType.label, { fontSize: 15, color: t.ink }]}>When did you check?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tSpace[2] }}>
            {(Object.keys(SUGAR_CONTEXT_WORDS) as SugarContext[]).map((c) => {
              const on = c === ctx;
              return (
                <Press
                  key={c}
                  onPress={() => {
                    tap();
                    setCtx(c);
                  }}
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={capital(SUGAR_CONTEXT_WORDS[c])}
                  style={{
                    flexBasis: "30%",
                    flexGrow: 1,
                    minHeight: 64,
                    padding: tSpace[2.5],
                    borderRadius: tRadius.row,
                    backgroundColor: t.surface,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? t.area.medicines : t.line,
                    gap: tSpace[1.5],
                  }}
                >
                  <Icon name={CONTEXT_ICONS[c]} size={18} color={on ? t.area.medicines : t.ink3} />
                  <Text style={[tType.caption, { color: t.ink }]}>
                    {capital(SUGAR_CONTEXT_WORDS[c])}
                  </Text>
                </Press>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={{ gap: tSpace[2] }}>
        <Text style={[tType.label, { fontSize: 15, color: t.ink }]}>
          How do you feel?{" "}
          <Text style={{ fontFamily: tFont.medium, color: t.ink3 }}>(optional)</Text>
        </Text>
        <ChipRow>
          {FEELINGS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              size="sm"
              selected={feel.includes(f.key)}
              onPress={() => pickFeel(f.key)}
            />
          ))}
        </ChipRow>
        {chestPain ? (
          <Press
            onPress={goForHelp}
            accessibilityRole="link"
            accessibilityLabel="Chest pain needs help now. Tap to get help."
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: tSpace[2.5],
              paddingVertical: tSpace[3],
              paddingHorizontal: tSpace[3.5],
              borderRadius: 16,
              backgroundColor: t.emergency,
            }}
          >
            <Icon name="alert" size={18} color={t.onEmergency} strokeWidth={2} />
            <Text style={[tType.labelS, { flex: 1, color: t.onEmergency }]}>
              Chest pain needs help now. Tap to get help.
            </Text>
          </Press>
        ) : null}
      </View>

      {problem ? (
        <Text
          accessibilityRole="alert"
          style={[tType.labelS, { color: t.ink, textAlign: "center" }]}
        >
          {problem}
        </Text>
      ) : null}
      <Text style={[tType.bodyS, { fontSize: 12, color: t.ink3, textAlign: "center" }]}>
        Only you can see this reading; your care team is not alerted. {THRESHOLDS_NOTE}
      </Text>
    </Screen>
  );
}

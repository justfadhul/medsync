import type { IconName } from "@/components/tide";
import type { DoseSlot, DoseStatus, Medicine } from "@/data/medicines";
import type { Anim } from "@/motion/presets";
import type { Tide } from "@/theme/tide";
import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";

import { Button, Card, Icon, IconDisc, Pill, Press, Ring, Screen } from "@/components/tide";
import { medicinesRepo, SLOT_WORDS, useMedicines } from "@/data/medicines";
import { useToast } from "@/features/care-more/use-toast";
import { AddMedicineForm } from "@/features/care/add-medicine";
import { dayHeadline, lastSevenDays, shortDate, timelineFill } from "@/features/care/logic";
import { useNow } from "@/lib/use-now";
import { EASE_OUT, fade, OVERSHOOT, ringFillMs } from "@/motion/presets";
import { savedLine } from "@/offline/outbox";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

const SLOT_ICONS: Record<DoseSlot, IconName> = {
  morning: "sunrise",
  midday: "sun",
  evening: "sunset",
  night: "moon",
};

/** The ✓ on the done card pops in with a small overshoot (board `popIn`). */
const popIn = (reduced: boolean): Anim =>
  reduced
    ? fade()
    : {
        animationName: {
          "0%": { opacity: 0, transform: [{ scale: 0.5 }] },
          "70%": { opacity: 1, transform: [{ scale: 1.12 }] },
          "100%": { opacity: 1, transform: [{ scale: 1 }] },
        },
        animationDuration: 500,
        animationTimingFunction: OVERSHOOT,
        animationFillMode: "both",
      };

/** One ring of teal spreads out behind the ✓ once (board `burst`). Not drawn under reduce motion. */
const burst: Anim = {
  animationName: {
    from: { opacity: 0.9, transform: [{ scale: 0.4 }] },
    to: { opacity: 0, transform: [{ scale: 2.2 }] },
  },
  animationDuration: 700,
  animationTimingFunction: "ease-out",
  animationFillMode: "both",
};

const STATUS_WORDS: Record<DoseStatus, string> = {
  taken: "Taken",
  due: "Due now",
  later: "Later",
  missed: "Missed",
  noEntry: "No entry",
};

/**
 * Medicines today (board TMedicines, prompt §8.4, PRD F-14), from the
 * patient's own list (ADR 0342). Names, times of day and "As your clinician
 * prescribed" only: no dose amount anywhere (law L5). There is no supply
 * data, so no refill bars. The list is the patient's: no clinician sees it.
 */
export default function MedicinesScreen() {
  const t = useTide();
  const reduced = useReducedMotion();
  const now = useNow();
  const params = useLocalSearchParams<{ add?: string }>();
  const med = useMedicines(now);
  const [justTaken, setJustTaken] = useState<string | null>(null);
  const [adding, setAdding] = useState(params.add === "1");
  const { toast, show } = useToast();

  const { doses, taken, total, week, weekTotals, medicines } = med;
  const due = doses.find((d) => d.status === "due");
  const done = doses.find((d) => d.id === justTaken && d.status === "taken");
  const next = done ? doses.find((d) => d.status !== "taken" && d.time > done.time) : undefined;
  const days = lastSevenDays(now);
  const weekTaken = week.reduce((a, b) => a + b, 0);
  const weekTotal = weekTotals.reduce((a, b) => a + b, 0);
  const fill = timelineFill(taken, total);

  if (med.loading && !medicines.length)
    return (
      <Screen back={{ label: "Care" }} title="Medicines">
        <Text style={[tType.bodyM, { color: t.ink2 }]}>Loading your medicines…</Text>
      </Screen>
    );
  if (med.error)
    return (
      <Screen back={{ label: "Care" }} title="Medicines">
        <Text style={[tType.bodyM, { color: t.ink2 }]}>Couldn&apos;t load your medicines.</Text>
        <Button label="Try again" variant="outline" onPress={med.retry} />
      </Screen>
    );

  return (
    <View style={{ flex: 1 }}>
      <Screen back={{ label: "Care" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[4.5] }}>
          <Ring
            value={total ? taken / total : 0}
            size={116}
            stroke={12}
            color={t.accentPressed}
            accessibilityLabel={`${taken} of ${total} doses taken today`}
          >
            <Text
              style={{
                fontFamily: tFont.monoBold,
                fontSize: 34,
                lineHeight: 36,
                letterSpacing: -1.4,
                color: t.ink,
              }}
            >
              {taken}
              <Text style={{ fontSize: 18, color: t.ink3 }}>/{total}</Text>
            </Text>
            <Text style={[tType.micro, { fontFamily: tFont.semibold, color: t.ink2 }]}>
              taken today
            </Text>
          </Ring>
          <View style={{ flex: 1, gap: tSpace[1] }}>
            <Text style={[tType.overline, { color: t.area.medicines }]}>{shortDate(now)}</Text>
            <Text
              accessibilityRole="header"
              style={[tType.display, { fontSize: 30, lineHeight: 33, color: t.ink }]}
            >
              {dayHeadline(taken, total)}
            </Text>
            <Text style={[tType.bodyS, { color: t.ink2 }]}>
              {weekTotal ? `${weekTaken} of ${weekTotal} this week · ` : ""}only you can see this
            </Text>
          </View>
        </View>

        {doses.length ? (
          <Card
            radius={tRadius.panel}
            padding={tSpace[1.5]}
            style={{ flexDirection: "row", paddingVertical: tSpace[3.5] }}
          >
            <View
              style={{
                position: "absolute",
                left: 60,
                right: 60,
                top: 40,
                height: 3,
                borderRadius: 3,
                backgroundColor: t.surface3,
              }}
            >
              <Animated.View
                style={{
                  width: `${Math.round(fill * 100)}%`,
                  height: 3,
                  borderRadius: 3,
                  backgroundColor: t.accentPressed,
                  transitionProperty: "width",
                  transitionDuration: ringFillMs(reduced),
                  transitionTimingFunction: EASE_OUT,
                }}
              />
            </View>
            {doses.map((d) => (
              <TimelineStop
                key={d.id}
                slot={d.slot}
                status={d.status}
                sub={
                  d.status === "taken"
                    ? `Taken ${d.takenAt}`
                    : d.status === "due" && d.snoozedUntil
                      ? `Snoozed · ${d.snoozedUntil}`
                      : `${STATUS_WORDS[d.status]} · ${d.time}`
                }
              />
            ))}
          </Card>
        ) : null}

        {due && !done ? (
          <NowCard
            name={due.medicine}
            time={due.time}
            instruction={due.instruction}
            snoozed={Boolean(due.snoozedUntil)}
            onTake={async () => {
              setJustTaken(due.id);
              const r = await medicinesRepo.take(due.id, now);
              if (r !== "sent") show(savedLine(r));
            }}
            onSnooze={() => medicinesRepo.snooze(due.id, now)}
          />
        ) : null}

        {done ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: tSpace[3.5],
              paddingVertical: tSpace[4],
              paddingHorizontal: tSpace[4.5],
              borderRadius: tRadius.xl,
              backgroundColor: t.band,
            }}
          >
            <View style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}>
              {reduced ? null : (
                <Animated.View
                  style={[
                    { position: "absolute", inset: 0, borderRadius: 26, backgroundColor: t.accent },
                    burst,
                  ]}
                />
              )}
              <Animated.View
                style={[
                  {
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: t.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  popIn(reduced),
                ]}
              >
                <Icon name="check" size={22} color={t.onAccent} strokeWidth={3} />
              </Animated.View>
            </View>
            <View style={{ flex: 1 }} accessibilityLiveRegion="polite">
              <Text style={[tType.heading, { color: t.onBand }]}>
                {SLOT_WORDS[done.slot]} done · {done.takenAt}
              </Text>
              <Text style={[tType.bodyS, { color: t.onBand2 }]}>
                {next
                  ? `Next: ${SLOT_WORDS[next.slot].toLowerCase()} at ${next.time}.`
                  : "That is all for today."}
              </Text>
            </View>
            <Press
              onPress={async () => {
                const r = await medicinesRepo.undo(done.id);
                if (r === "failed") show("Couldn't undo that. Try again later.");
                else setJustTaken(null);
              }}
              accessibilityLabel={`Undo, ${SLOT_WORDS[done.slot].toLowerCase()} not taken`}
              hitSlop={4}
              style={{
                minHeight: 36,
                paddingHorizontal: tSpace[3],
                borderRadius: tRadius.pill,
                backgroundColor: t.bandGlass,
                justifyContent: "center",
              }}
            >
              <Text style={[tType.labelS, { fontSize: 13, color: t.onBandAccent }]}>Undo</Text>
            </Press>
          </View>
        ) : null}

        {weekTotal ? (
          <Card radius={tRadius.panel} padding={tSpace[4]}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                accessibilityRole="header"
                style={[tType.label, { fontSize: 15, color: t.ink }]}
              >
                This week
              </Text>
              <Text style={[tType.caption, { color: t.accentText }]}>
                {weekTaken} of {weekTotal} doses
              </Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {week.map((n, i) => {
                const today = i === week.length - 1;
                const of = weekTotals[i];
                return (
                  <View
                    key={i}
                    accessible
                    accessibilityLabel={`${today ? "Today" : days[i].name}, ${n} of ${of} taken`}
                    style={{ alignItems: "center", gap: 5 }}
                  >
                    <View
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: today
                          ? t.surface
                          : of && n >= of
                            ? t.accent
                            : n > 0
                              ? t.accentSoft
                              : t.surface2,
                        borderWidth: today ? 2 : 0,
                        borderColor: t.ink,
                      }}
                    >
                      <Text
                        style={[
                          tType.micro,
                          {
                            fontFamily: tFont.bold,
                            color: today ? t.ink : n > 0 ? t.onAccent : t.ink3,
                          },
                        ]}
                      >
                        {n}
                      </Text>
                    </View>
                    <Text
                      style={[
                        tType.micro,
                        { fontFamily: tFont.semibold, color: today ? t.ink : t.ink3 },
                      ]}
                    >
                      {days[i].letter}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: tSpace[1],
          }}
        >
          <Text accessibilityRole="header" style={[tType.section, { color: t.ink }]}>
            My medicines
          </Text>
          <Text style={[tType.labelS, { fontSize: 13, color: t.ink3 }]}>
            {medicines.filter((m) => m.state === "active").length} active
          </Text>
        </View>
        {!medicines.length && !adding ? (
          <Text style={[tType.bodyM, { color: t.ink2 }]}>
            Nothing on your list yet. Add the medicines you take, with the times of day, and mark
            each dose here.
          </Text>
        ) : null}
        {medicines.map((m) => (
          <MedicineCard key={m.id} m={m} onSaved={show} />
        ))}
        {adding ? (
          <Card style={{ gap: tSpace[3] }}>
            <Text accessibilityRole="header" style={[tType.label, { color: t.ink }]}>
              Add a medicine
            </Text>
            <AddMedicineForm
              onCancel={() => setAdding(false)}
              onDone={(text) => {
                setAdding(false);
                show(text);
              }}
            />
          </Card>
        ) : (
          <Button
            label="Add a medicine"
            icon="plus"
            variant="soft"
            onPress={() => setAdding(true)}
          />
        )}
        <Text
          style={[
            tType.bodyS,
            { fontSize: 12, lineHeight: 17, color: t.ink3, textAlign: "center" },
          ]}
        >
          Take each one as your clinician prescribed. This list is yours: your care team does not
          see it, so bring it to your visit.
        </Text>
      </Screen>
      {toast}
    </View>
  );
}

const stopColours = (t: Tide, status: DoseStatus) =>
  ({
    taken: { bg: t.accentPressed, fg: t.onAccent, sub: t.accentText },
    due: { bg: t.surface, fg: t.ink, sub: t.ink },
    later: { bg: t.surface2, fg: t.ink3, sub: t.ink3 },
    missed: { bg: t.surface2, fg: t.ink2, sub: t.ink2 },
    noEntry: { bg: t.surface2, fg: t.ink3, sub: t.ink3 },
  })[status];

function TimelineStop({ slot, status, sub }: { slot: DoseSlot; status: DoseStatus; sub: string }) {
  const t = useTide();
  const reduced = useReducedMotion();
  const c = stopColours(t, status);
  return (
    <View
      accessible
      accessibilityLabel={`${SLOT_WORDS[slot]}: ${sub}`}
      style={{ flex: 1, alignItems: "center", gap: tSpace[1.5] }}
    >
      <Animated.View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.bg,
          borderWidth: status === "due" ? 3 : 0,
          borderColor: t.accent,
          boxShadow: status === "due" ? `0px 0px 0px 6px ${t.accentTint}` : undefined,
          transitionProperty: "backgroundColor",
          transitionDuration: reduced ? 0 : 300,
        }}
      >
        <Icon
          name={status === "taken" ? "check" : SLOT_ICONS[slot]}
          size={22}
          color={c.fg}
          strokeWidth={status === "taken" ? 3 : 1.8}
        />
      </Animated.View>
      <Text style={[tType.labelS, { fontFamily: tFont.bold, fontSize: 13, color: t.ink }]}>
        {SLOT_WORDS[slot]}
      </Text>
      <Text
        style={[tType.micro, { fontFamily: tFont.semibold, color: c.sub, textAlign: "center" }]}
      >
        {sub}
      </Text>
    </View>
  );
}

/** The teal Now card for the dose due now. */
function NowCard({
  name,
  time,
  instruction,
  snoozed,
  onTake,
  onSnooze,
}: {
  name: string;
  time: string;
  instruction: string;
  snoozed: boolean;
  onTake: () => void;
  onSnooze: () => void;
}) {
  const t = useTide();
  return (
    <View
      style={{
        overflow: "hidden",
        borderRadius: tRadius.xl,
        padding: tSpace[4.5],
        backgroundColor: t.accent,
        gap: tSpace[3.5],
      }}
    >
      <Pill label={`Now · ${time}`} dot={t.onAccent} bg={t.accentSoft} fg={t.onAccent} />
      <View style={{ gap: 2 }}>
        <Text
          style={{
            fontFamily: tFont.bold,
            fontSize: 26,
            lineHeight: 30,
            letterSpacing: -0.5,
            color: t.onAccent,
          }}
        >
          {name}
        </Text>
        <Text style={[tType.bodyM, { fontSize: 14, color: t.onAccent }]}>{instruction}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: tSpace[2] }}>
        <Button label="I took it" icon="check" onPress={onTake} style={{ flex: 1 }} />
        <Press
          onPress={onSnooze}
          disabled={snoozed}
          accessibilityLabel={snoozed ? "Snoozed" : "Snooze for 15 minutes"}
          style={{
            minHeight: 52,
            paddingHorizontal: tSpace[4],
            borderRadius: tRadius.pill,
            backgroundColor: t.accentSoft,
            justifyContent: "center",
          }}
        >
          <Text style={[tType.labelS, { color: t.onAccent }]}>
            {snoozed ? "Snoozed" : "In 15 min"}
          </Text>
        </Press>
      </View>
    </View>
  );
}

/** One medicine on the list: its times in words, and pause, resume or stop, like the web. */
function MedicineCard({ m, onSaved }: { m: Medicine; onSaved: (text: string) => void }) {
  const t = useTide();
  const [confirmStop, setConfirmStop] = useState(false);
  const set = async (state: "active" | "paused" | "ended") => {
    const r = await medicinesRepo.setState(m.id, state);
    setConfirmStop(false);
    onSaved(
      r === "failed"
        ? "Couldn't save that. Try again when you are online."
        : state === "ended"
          ? `Stopped ${m.name}`
          : state === "paused"
            ? `Paused ${m.name}`
            : `${m.name} is back on your list`,
    );
  };
  const paused = m.state === "paused";
  return (
    <Card style={{ gap: tSpace[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[3] }}>
        <IconDisc name="pill" size={44} color={t.area.medicines} bg={t.surface2} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text style={[tType.label, { fontFamily: tFont.bold, fontSize: 15, color: t.ink }]}>
            {m.name}
          </Text>
          <Text style={[tType.bodyS, { fontSize: 12, color: t.ink2 }]}>
            {paused ? "Paused · " : ""}
            {m.when}
            {m.instructions ? ` · ${m.instructions}` : ""}
          </Text>
        </View>
      </View>
      {confirmStop ? (
        <View style={{ gap: tSpace[2] }}>
          <Text style={[tType.bodyS, { color: t.ink }]}>
            Stop {m.name}? It leaves your list. Only stop a medicine your clinician told you to
            stop.
          </Text>
          <View style={{ flexDirection: "row", gap: tSpace[2] }}>
            <Button
              label="Yes, stop it"
              size="sm"
              variant="outline"
              onPress={() => void set("ended")}
            />
            <Button
              label="Keep it"
              size="sm"
              variant="soft"
              onPress={() => setConfirmStop(false)}
            />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: tSpace[2] }}>
          <Button
            label={paused ? "Resume" : "Pause"}
            size="sm"
            variant="soft"
            accessibilityLabel={`${paused ? "Resume" : "Pause"} ${m.name}`}
            onPress={() => void set(paused ? "active" : "paused")}
          />
          <Button
            label="Stop"
            size="sm"
            variant="outline"
            accessibilityLabel={`Stop ${m.name}`}
            onPress={() => setConfirmStop(true)}
          />
        </View>
      )}
    </Card>
  );
}

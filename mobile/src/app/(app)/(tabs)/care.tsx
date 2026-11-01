import type { IconName } from "@/components/tide";
import type { TrendTile } from "@/data/trends";
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import {
  Avatar,
  Button,
  Card,
  Icon,
  IconDisc,
  Press,
  Ring,
  Screen,
  SectionHead,
  Skeleton,
  SkeletonCard,
} from "@/components/tide";
import { DAY_GOAL, GLASSES, useActivity } from "@/data/activity";
import { useChatPreview } from "@/data/chat";
import { lastDays } from "@/data/health-log";
import { useLabsSummary } from "@/data/labs";
import { SLOT_WORDS, useMedicines } from "@/data/medicines";
import { useReadings } from "@/data/readings";
import { trendTiles } from "@/data/trends";
import { lastSevenDays, longDate } from "@/features/care/logic";
import { flag } from "@/lib/flags";
import { THRESHOLDS_NOTE } from "@/lib/readings";
import { useNow } from "@/lib/use-now";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

const n = (v: number) => v.toLocaleString("en-US");

/**
 * The Care hub (board TCare, PRD F-13). Medicines, trends, water and minutes
 * walked come from the patient's own log (ADR 0342), with empty states for a
 * patient who has logged nothing. The care-team card shows only while chat
 * is on (`mobileChat`); until then it offers "Book a visit".
 */
export default function CareTab() {
  const t = useTide();
  const router = useRouter();
  const now = useNow();
  const med = useMedicines(now);
  const labs = useLabsSummary();
  const act = useActivity(now);
  const { readings } = useReadings();
  const chat = useChatPreview();
  const chatOn = flag("mobileChat");
  const go = (href: Href) => () => router.push(href);

  const days = lastSevenDays(now);
  const tiles = trendTiles(readings, lastDays(now));
  const weekTaken = med.week.reduce((a, b) => a + b, 0);
  const weekTotal = med.weekTotals.reduce((a, b) => a + b, 0);
  const next =
    med.doses.find((d) => d.status === "due") ?? med.doses.find((d) => d.status === "later");
  const noMedicines = !med.loading && !med.medicines.length;

  return (
    <Screen
      underNav
      bell
      header={
        <View>
          <Text style={[tType.bodyM, { fontSize: 14, lineHeight: 18, color: t.ink2 }]}>
            {longDate(now)}
          </Text>
          <Text accessibilityRole="header" style={[tType.display, { color: t.ink }]}>
            Your care
          </Text>
        </View>
      }
    >
      {med.loading && !med.medicines.length ? (
        <SkeletonCard label="Loading your medicines" lines={2} height={132} />
      ) : (
        <Press
          onPress={go("/care/medicines")}
          accessibilityLabel={`Medicines this week: ${weekTaken} of ${weekTotal} doses taken. Open medicines.`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: tSpace[4],
            padding: tSpace[4],
            borderRadius: 26,
            backgroundColor: t.band,
          }}
        >
          <Ring
            value={weekTotal ? weekTaken / weekTotal : 0}
            size={84}
            stroke={10}
            color={t.accent}
            track={t.bandGlass}
          >
            <Text style={{ fontFamily: tFont.bold, fontSize: 20, color: t.onBand }}>
              {Math.round((weekTaken / Math.max(1, weekTotal)) * 100)}%
            </Text>
          </Ring>
          <View style={{ flex: 1, gap: tSpace[1.5] }}>
            <Text style={[tType.overline, { color: t.onBandAccent }]}>Medicines this week</Text>
            <Text style={[tType.heading, { fontSize: 18, lineHeight: 23, color: t.onBand }]}>
              {weekTotal ? `${weekTaken} of ${weekTotal} doses taken` : "No doses on your list yet"}
            </Text>
            <View style={{ flexDirection: "row", gap: tSpace[1] }}>
              {med.week.map((count, i) => (
                <View key={i} style={{ alignItems: "center", gap: 3 }}>
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 6,
                      backgroundColor: count === 0 ? t.bandGlass : t.accent,
                      opacity: count === 0 || count >= med.weekTotals[i] ? 1 : 0.45,
                      borderWidth: i === 6 ? 2 : 0,
                      borderColor: t.onBand,
                    }}
                  />
                  <Text style={{ fontFamily: tFont.semibold, fontSize: 11, color: t.onBand2 }}>
                    {days[i].letter}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </Press>
      )}

      <Card
        onPress={go("/care/medicines")}
        radius={tRadius.card}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: tSpace[3],
          paddingVertical: tSpace[3],
        }}
      >
        <IconDisc name="pill" color={t.area.medicines} bg={t.surface2} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={[tType.label, { fontSize: 15, color: t.ink }]}>
            {noMedicines
              ? "Add your medicines"
              : next
                ? `${SLOT_WORDS[next.slot]} medicine is ${next.status === "due" ? "due" : "next"}`
                : med.total
                  ? "Nothing more due today"
                  : "No doses due today"}
          </Text>
          <Text style={[tType.bodyS, { fontFamily: tFont.regular, color: t.ink2 }]}>
            {noMedicines
              ? "Names and times of day, to keep track"
              : next
                ? `${next.time} · ${next.medicine}`
                : `${med.taken} of ${med.total} taken today`}
          </Text>
        </View>
        <View
          style={{
            height: 34,
            paddingHorizontal: tSpace[3.5],
            borderRadius: tRadius.pill,
            backgroundColor: t.accent,
            justifyContent: "center",
          }}
        >
          <Text style={[tType.labelS, { color: t.onAccent }]}>Open</Text>
        </View>
      </Card>

      <SectionHead title="Health trends" action="See all" onAction={go("/care/trends")} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tSpace[2.5] }}>
        {tiles.map((tile) => (
          <TrendCard key={tile.metric} tile={tile} onPress={go("/care/trends")} />
        ))}
      </View>

      <SectionHead title="Lab tests" action="All tests" onAction={go("/care/labs")} />
      <Card
        onPress={go("/care/labs")}
        accessibilityLabel="Lab tests. Open the list."
        style={{ flexDirection: "row", alignItems: "center", gap: tSpace[3] }}
      >
        <IconDisc name="flask" color={t.area.medicines} bg={t.surface2} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          {labs.status === "loading" ? (
            <View accessible accessibilityLabel="Loading your tests" style={{ gap: tSpace[1.5] }}>
              <Skeleton width="70%" height={14} />
              <Skeleton width="40%" height={11} />
            </View>
          ) : labs.latest ? (
            <>
              <Text style={[tType.labelS, { color: t.ink }]}>
                {labs.latest.tests
                  .slice(0, 3)
                  .map((x) => x.name)
                  .join(", ")}
                {labs.latest.tests.length > 3 ? ` and ${labs.latest.tests.length - 3} more` : ""}
              </Text>
              <Text style={[tType.bodyS, { fontSize: 12, color: t.ink2 }]}>{labs.latest.note}</Text>
            </>
          ) : (
            <Text style={[tType.bodyS, { color: t.ink2 }]}>
              {labs.message ?? "No tests from your visits yet."}
            </Text>
          )}
        </View>
        <Icon name="forward" size={16} color={t.ink3} />
      </Card>

      <SectionHead title="Move and eat" action="Open" onAction={go("/care/activity")} />
      <Card onPress={go("/care/activity")} style={{ flexDirection: "row", padding: tSpace[3.5] }}>
        <MoveRing
          value={act.minutesToday}
          goal={DAY_GOAL}
          label={`of ${DAY_GOAL} walked today`}
          shown={`${n(act.minutesToday)} min`}
          icon="walk"
          color={t.accent}
          iconColor={t.accentText}
        />
        <MoveRing
          value={act.water}
          goal={GLASSES}
          label={`of ${GLASSES} glasses`}
          shown={`${act.water}`}
          icon="droplet"
          color={t.cascade[2]}
          iconColor={t.cascade[2]}
        />
      </Card>

      {chatOn ? (
        <SectionHead title="Your care team" action="Open chat" onAction={go("/care/chat")} />
      ) : (
        <SectionHead title="See your care team" />
      )}
      {chatOn ? (
        <Card style={{ gap: tSpace[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[2.5] }}>
            <View style={{ flexDirection: "row" }}>
              {[
                { i: "DR", bg: t.info.tint, fg: t.info.text },
                { i: "NS", bg: t.pending.tint, fg: t.pending.text },
                { i: "PH", bg: t.place.tint, fg: t.place.text },
                { i: "DT", bg: t.accentTint, fg: t.accentText },
              ].map((a, k) => (
                <View
                  key={a.i}
                  style={{
                    marginLeft: k ? -8 : 0,
                    borderRadius: 20,
                    borderWidth: 2,
                    borderColor: t.surface,
                  }}
                >
                  <Avatar initials={a.i} size={36} bg={a.bg} fg={a.fg} />
                </View>
              ))}
            </View>
            <Text style={[tType.bodyS, { flex: 1, color: t.ink2 }]}>
              Doctor, nurse, pharmacist and dietitian
            </Text>
          </View>
          <Press
            onPress={go("/care/chat")}
            accessibilityLabel={`${chat.from}, ${chat.time}: ${chat.text}`}
            style={{
              flexDirection: "row",
              gap: tSpace[2.5],
              alignItems: "flex-start",
              paddingVertical: tSpace[2.5],
              paddingHorizontal: tSpace[3],
              borderRadius: 16,
              backgroundColor: t.bg,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                marginTop: 6,
                borderRadius: 4,
                backgroundColor: t.accent,
              }}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[tType.labelS, { color: t.ink }]}>
                {chat.from} · {chat.time}
              </Text>
              <Text
                style={[
                  tType.bodyM,
                  { fontFamily: tFont.regular, fontSize: 14, lineHeight: 19, color: t.ink2 },
                ]}
              >
                {chat.text}
              </Text>
            </View>
          </Press>
          <View style={{ flexDirection: "row", gap: tSpace[2] }}>
            <Button
              label="Reply"
              icon="message"
              size="md"
              onPress={go("/care/chat")}
              style={{ flex: 1 }}
            />
            <Button label="Voice" icon="mic" size="md" variant="soft" onPress={go("/care/chat")} />
            <Button
              label="Video"
              icon="video"
              size="md"
              variant="soft"
              onPress={go("/care/chat")}
            />
          </View>
        </Card>
      ) : (
        <Card
          onPress={go("/book")}
          accessibilityLabel="Book a visit"
          style={{ flexDirection: "row", alignItems: "center", gap: tSpace[3] }}
        >
          <IconDisc name="calendar" color={t.area.team} bg={t.surface2} size={38} />
          <View style={{ flex: 1 }}>
            <Text style={[tType.label, { fontSize: 15, color: t.ink }]}>Book a visit</Text>
            <Text style={[tType.bodyS, { color: t.ink2 }]}>
              Your care team does not see what you log here. Bring it to your visit.
            </Text>
          </View>
          <Icon name="forward" size={16} color={t.ink3} />
        </Card>
      )}

      <Text style={[tType.bodyS, { fontSize: 12, color: t.ink3, textAlign: "center" }]}>
        Only you can see what you log. {THRESHOLDS_NOTE}
      </Text>
    </Screen>
  );
}

/** One Health trends tile: value, an arrow disc and the words that say what the arrow means. */
function TrendCard({ tile, onPress }: { tile: TrendTile; onPress: () => void }) {
  const t = useTide();
  const pair =
    tile.tone === "neutral"
      ? t.pending
      : tile.tone === "good"
        ? { tint: t.accentTint, text: t.accentText }
        : t.caution;
  const rotate = tile.dir === "down" ? "0deg" : tile.dir === "up" ? "180deg" : "-90deg";
  return (
    <Card
      onPress={onPress}
      radius={tRadius.card}
      accessibilityLabel={`${tile.name}: ${tile.value} ${tile.unit}. ${tile.trend}`}
      style={{ flexBasis: "47%", flexGrow: 1, gap: tSpace[1], paddingVertical: tSpace[3] }}
    >
      <Text style={[tType.bodyS, { fontFamily: tFont.semibold, color: t.ink2 }]} numberOfLines={1}>
        {tile.name}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: tSpace[1.5],
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "baseline", gap: tSpace[1], flexShrink: 1 }}
        >
          <Text
            style={{
              fontFamily: tFont.bold,
              fontSize: 22,
              lineHeight: 26,
              letterSpacing: -0.4,
              color: t.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {tile.value}
          </Text>
          <Text style={[tType.caption, { fontFamily: tFont.medium, color: t.ink2 }]}>
            {tile.unit}
          </Text>
        </View>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: pair.tint,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ rotate }],
          }}
        >
          <Icon name="arrowDown" size={17} color={pair.text} strokeWidth={2.4} />
        </View>
      </View>
      <Text style={[tType.caption, { fontFamily: tFont.medium, color: pair.text }]}>
        {tile.trend}
      </Text>
    </Card>
  );
}

function MoveRing({
  value,
  goal,
  label,
  shown,
  icon,
  color,
  iconColor,
}: {
  value: number;
  goal: number;
  label: string;
  shown: string;
  icon: IconName;
  color: string;
  iconColor: string;
}) {
  const t = useTide();
  return (
    <View
      accessible
      accessibilityLabel={`${shown} ${label}`}
      style={{ flex: 1, alignItems: "center", gap: tSpace[1.5] }}
    >
      <Ring value={goal ? value / goal : 0} size={64} stroke={8} color={color}>
        <Icon name={icon} size={20} color={iconColor} />
      </Ring>
      <View style={{ alignItems: "center" }}>
        <Text
          style={{
            fontFamily: tFont.bold,
            fontSize: 15,
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {shown}
        </Text>
        <Text style={[tType.caption, { fontFamily: tFont.medium, color: t.ink2 }]}>{label}</Text>
      </View>
    </View>
  );
}

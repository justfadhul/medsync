import type { ClinicianOption } from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * The top of the provider screen: the person, then the facts.
 *
 * A photograph, when there is one, is the reference's photo card; without
 * one the monogram sits beside the name as a disc, and no pale block stands
 * in for a face. Under the name, a row of facts — and only facts the tables
 * hold (ADR 0085 §2): time on MedSync, patients seen, the rating with its
 * count, video visits. A count of zero is not a fact and is not drawn; the
 * old strip of "—" is gone. Nothing here is an affordance that does nothing:
 * the call and message circles had no transport behind them.
 */
export function ProviderHero({
  doctor,
  hospitalName,
  allowVirtual,
  seenBefore,
}: {
  doctor: ClinicianOption;
  hospitalName: string;
  allowVirtual: boolean;
  /** PRD §2.7 continuity. */
  seenBefore: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  const facts: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [];
  const years = yearsWithUs(doctor.withUsSinceIso);
  if (years) facts.push({ icon: "time-outline", text: years });
  if (doctor.patientsSeen > 0)
    facts.push({ icon: "people-outline", text: `${compact(doctor.patientsSeen)} patients` });
  if (doctor.rating)
    facts.push({
      icon: "star",
      text: `${doctor.rating.average.toFixed(1)} · ${compact(doctor.rating.count)} ${
        doctor.rating.count === 1 ? "review" : "reviews"
      }`,
    });
  if (allowVirtual) facts.push({ icon: "videocam-outline", text: "Video visits" });
  if (seenBefore) facts.push({ icon: "checkmark-circle-outline", text: "Seen you before" });

  return (
    <View style={styles.stack}>
      {doctor.photoUrl ? (
        <Image
          source={{ uri: doctor.photoUrl }}
          style={styles.photo}
          contentFit="cover"
          transition={150}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      <View style={styles.head}>
        {doctor.photoUrl ? null : <Avatar name={doctor.fullName} size={56} />}
        <View style={styles.names}>
          <Text accessibilityRole="header" style={styles.name}>
            {doctor.fullName}
          </Text>
          <Text style={styles.credential} numberOfLines={2}>
            {[doctor.cadre, doctor.specialty ?? doctor.departmentName, hospitalName]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>

      {facts.length > 0 ? (
        <View style={styles.facts} accessibilityRole="summary">
          {facts.map((f) => (
            <View key={f.text} style={styles.fact}>
              <Ionicons name={f.icon} size={13} color={colors.mutedForeground} />
              <Text style={styles.factText}>{f.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** "New on MedSync" / "3 yrs on MedSync" — time at this hospital, which is all we know. */
function yearsWithUs(iso: string | null): string | null {
  if (!iso) return null;
  const years = Math.floor((Date.now() - new Date(iso).getTime()) / (365.25 * 86_400_000));
  return years < 1 ? "New on MedSync" : `${years} yr${years === 1 ? "" : "s"} on MedSync`;
}

/** 3549 → "3,549". Never rounded, never a "+": the count is exact, so it is shown exactly. */
function compact(n: number): string {
  return n.toLocaleString("en-UG");
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    stack: { gap: space[4] },
    // 16:10, not 4:5: the days and times are the point of the screen and a
    // taller photo pushed them a scroll away.
    photo: {
      width: "100%",
      aspectRatio: 16 / 10,
      borderRadius: radius["2xl"],
      backgroundColor: c.place,
    },
    head: { flexDirection: "row", alignItems: "center", gap: space[3] },
    names: { flex: 1, gap: 2 },
    name: {
      fontFamily: font.display,
      fontSize: 26,
      lineHeight: 32,
      letterSpacing: -0.4,
      color: c.foreground,
    },
    credential: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: c.mutedForeground },
    facts: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
    fact: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minHeight: 30,
      paddingHorizontal: space[3],
      borderRadius: radius.full,
      backgroundColor: c.muted,
      borderWidth: 1,
      borderColor: c.border,
    },
    factText: { fontFamily: font.bodyMedium, fontSize: 12.5, color: c.foreground },
  });

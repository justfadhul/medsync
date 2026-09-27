import type { ContactKind, PendingPreArrival, SheetContact } from "@/lib/emergency";
import type { Palette } from "@/theme/tokens";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { CATALOG } from "@shared/symptom-catalog/catalog.v0.1";
import { t } from "@shared/symptom-catalog/classify";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { FirstAidCards } from "@/components/emergency/first-aid-cards";
import { Watermark } from "@/components/emergency/watermark";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import {
  e1Tiles,
  emergencyEvent,
  firstAidCardsLive,
  preAlertLive,
  readPendingPreArrival,
  telUrl,
  useEmergencySheet,
} from "@/lib/emergency";
import { ForcedScheme, useStyles } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * E1 — the Emergency sheet (PRD MS-PRD-SYM-001 §8.2; ADR 0098 rulings 7, 8).
 * One screen, both doors: the Emergency tab draws it with the patient's
 * hospital, the pre-auth root route draws it with none. Permanently light
 * (Law 3). This file and the pre-alert's Send and the status header are
 * where the app's red lives (tests/design/red-reserved.test.ts).
 *
 * The primary call is the first VERIFIED contact the server returned — the
 * hospital's own `emergency_phone` rides first as `hospital:<id>` when one
 * is named (ruling 8) — and when nothing is verified the sheet says "Go to
 * the nearest emergency unit" with no number: a guessed number here would be
 * the most dangerous fabricated datum in the product. Up to three more
 * numbers follow, each labelled by kind. Draft (unverified) rows come only
 * outside production and only under the watermark.
 *
 * Numbers never appear in this file; they come from data.
 */
export function EmergencySheet({
  hospitalId,
  from,
  showDrafts,
  onBack,
  onTell,
  onOpenStatus,
}: {
  hospitalId: string | null;
  /** `"catalog"` when the symptom catalog's interrupt opened this: no tiles, one warning haptic. */
  from?: string;
  /** The tab shows unverified rows under the watermark outside production; the pre-auth sheet never does. */
  showDrafts: boolean;
  onBack?: () => void;
  /** "Tell a hospital I'm coming" with the tiles picked so far. */
  onTell: (picks: string[]) => void;
  /** A pre-alert this device already sent and has not closed. */
  onOpenStatus?: (pending: PendingPreArrival) => void;
}) {
  return (
    <ForcedScheme scheme="light">
      <SheetBody
        hospitalId={hospitalId}
        from={from}
        showDrafts={showDrafts}
        onBack={onBack}
        onTell={onTell}
        onOpenStatus={onOpenStatus}
      />
    </ForcedScheme>
  );
}

const KIND_WORD: Record<ContactKind, string> = {
  general: "Emergency line",
  ambulance: "Ambulance",
  crisis: "Crisis support",
  sv: "Sexual violence support",
};

/** Catalog icon key → a glyph. The word beside it carries the meaning (PRD §7.1). */
const TILE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  lungs: "pulse-outline",
  heart: "heart-outline",
  brain: "body-outline",
  child: "person-outline",
  thermometer: "thermometer-outline",
  droplet: "water-outline",
};

function SheetBody({
  hospitalId,
  from,
  showDrafts,
  onBack,
  onTell,
  onOpenStatus,
}: {
  hospitalId: string | null;
  from?: string;
  showDrafts: boolean;
  onBack?: () => void;
  onTell: (picks: string[]) => void;
  onOpenStatus?: (pending: PendingPreArrival) => void;
}) {
  const styles = useStyles(makeStyles);
  const { sheet } = useEmergencySheet(hospitalId);
  const [picks, setPicks] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingPreArrival | null>(null);
  const fromCatalog = from === "catalog";
  const canTell = preAlertLive();

  // PRD §7.5: ONE haptic per emergency interrupt — the catalog's interrupt
  // fires it (emergency-interrupt.tsx), so arriving here from it fires none.
  // No pulsing anywhere — the phone does not read reduced-motion today, so
  // there is no motion to reduce.

  useEffect(() => {
    if (!canTell || !onOpenStatus) return;
    let cancelled = false;
    readPendingPreArrival().then((p) => {
      if (!cancelled) setPending(p);
    });
    return () => {
      cancelled = true;
    };
  }, [canTell, onOpenStatus]);

  const contacts = sheet?.contacts ?? [];
  const verified = contacts.filter((c) => !c.draft);
  const primary = verified[0] ?? null;
  const secondary = verified.slice(1, 4);
  const drafts = showDrafts ? contacts.filter((c) => c.draft).slice(0, 3) : [];

  const call = (c: SheetContact) => {
    emergencyEvent("call_tapped", { contact_id: c.id });
    Linking.openURL(telUrl(c.number)).catch(() => {});
  };
  const toggle = (key: string) =>
    setPicks((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  return (
    <Screen onBack={onBack}>
      <View style={styles.column}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={styles.title}>
            {t(CATALOG, "tier.E")}
          </Text>
          <Text style={styles.lead}>
            If the person is not breathing or can&rsquo;t be woken, call now.
          </Text>
        </View>

        {/* The primary call. One tap, no data: `tel:` rides the cellular
            network, and the number was verified by a human before it was
            allowed here. */}
        {primary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${primary.label}, ${primary.number}`}
            onPress={() => call(primary)}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Ionicons name="call" size={22} color={styles.primaryLabel.color} />
            <View style={styles.primaryText}>
              <Text style={styles.primaryLabel}>Call {primary.label}</Text>
              <Text style={styles.primaryNumber}>{primary.number}</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.noNumber}>
            <Text style={styles.noNumberTitle}>Go to the nearest emergency unit</Text>
            <Text style={styles.noNumberBody}>
              No verified emergency number is available here yet. They see the sickest people first.
            </Text>
          </View>
        )}

        {secondary.length ? (
          <View style={styles.list}>
            {secondary.map((c) => (
              <ContactRow key={c.id} contact={c} onPress={() => call(c)} />
            ))}
          </View>
        ) : null}

        {canTell ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onTell(picks)}
            style={({ pressed }) => [styles.tell, pressed && styles.pressed]}
          >
            <Text style={styles.tellLabel}>Tell a hospital I&rsquo;m coming</Text>
          </Pressable>
        ) : null}

        {pending && onOpenStatus ? (
          <Button
            variant="link"
            label="See the pre-alert you sent"
            onPress={() => onOpenStatus(pending)}
          />
        ) : null}

        {!fromCatalog ? (
          <View style={styles.block}>
            <Text accessibilityRole="header" style={styles.blockTitle}>
              What&rsquo;s happening?
            </Text>
            <Text style={styles.blockHint}>Optional. It helps the hospital get ready.</Text>
            <View style={styles.grid}>
              {e1Tiles().map((item) => {
                const selected = picks.includes(item.key);
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    onPress={() => toggle(item.key)}
                    style={({ pressed }) => [
                      styles.tile,
                      selected && styles.tileSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={TILE_ICON[item.icon] ?? "warning-outline"}
                      size={20}
                      color={selected ? styles.tileLabelSelected.color : styles.tileLabel.color}
                    />
                    <Text style={[styles.tileLabel, selected && styles.tileLabelSelected]}>
                      {t(CATALOG, item.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {drafts.length ? (
          <View style={styles.block}>
            <Watermark>These numbers are not yet verified and do not show in production.</Watermark>
            <View style={styles.list}>
              {drafts.map((c) => (
                <ContactRow key={c.id} contact={c} onPress={() => call(c)} draft />
              ))}
            </View>
          </View>
        ) : null}

        {firstAidCardsLive() ? <FirstAidCards /> : null}
      </View>
    </Screen>
  );
}

/** A secondary number: its kind, its label, and the `tel:` tap. */
function ContactRow({
  contact,
  onPress,
  draft = false,
}: {
  contact: SheetContact;
  onPress: () => void;
  draft?: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Call ${KIND_WORD[contact.kind]}, ${contact.label}, ${contact.number}${draft ? ", unverified" : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowKind}>
          {KIND_WORD[contact.kind]}
          {draft ? " · Unverified" : ""}
        </Text>
        <Text style={styles.rowLabel}>{contact.label}</Text>
      </View>
      <Text style={styles.rowNumber}>{contact.number}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    column: { gap: space[4] },
    head: { gap: space[2], marginBottom: space[1] },
    // The one red heading in the app: it names the tier in the PRD's word.
    title: {
      fontFamily: font.display,
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.6,
      color: c.status.criticalFg,
    },
    lead: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 23, color: c.foreground },

    primary: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
      minHeight: 64,
      paddingHorizontal: space[5],
      paddingVertical: space[3],
      borderRadius: radius.xl,
      backgroundColor: c.status.criticalFg,
    },
    primaryText: { flex: 1, gap: 2 },
    primaryLabel: { fontFamily: font.bodyMedium, fontSize: 17, color: c.background },
    primaryNumber: {
      fontFamily: font.body,
      fontSize: 15,
      color: c.background,
      fontVariant: ["tabular-nums"],
    },
    pressed: { opacity: 0.85 },

    noNumber: {
      padding: space[4],
      borderRadius: radius.xl,
      backgroundColor: c.status.criticalBg,
      gap: space[1],
    },
    noNumberTitle: { fontFamily: font.bodySemiBold, fontSize: 17, color: c.status.criticalFg },
    noNumberBody: { fontFamily: font.body, fontSize: 15, lineHeight: 22, color: c.foreground },

    list: { gap: space[2] },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
      minHeight: 56,
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    rowText: { flex: 1, gap: 1 },
    rowKind: {
      fontFamily: font.bodyMedium,
      fontSize: 12.5,
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: c.mutedForeground,
    },
    rowLabel: { fontFamily: font.body, fontSize: 15, color: c.foreground },
    rowNumber: {
      fontFamily: font.bodyMedium,
      fontSize: 15,
      color: c.primary,
      fontVariant: ["tabular-nums"],
    },

    // White fill, red text and border (PRD §8.2 item 3).
    tell: {
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: space[6],
      borderRadius: radius.full,
      borderWidth: 1.5,
      borderColor: c.status.criticalFg,
      backgroundColor: c.background,
    },
    tellLabel: { fontFamily: font.bodyMedium, fontSize: 16, color: c.status.criticalFg },

    block: { gap: space[2], marginTop: space[2] },
    blockTitle: {
      fontFamily: font.bodyMedium,
      fontSize: 16.5,
      lineHeight: 22,
      color: c.foreground,
    },
    blockHint: { fontFamily: font.body, fontSize: 13.5, color: c.mutedForeground },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
    tile: {
      width: "48%",
      flexGrow: 1,
      minHeight: 72,
      padding: space[3],
      gap: space[1],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    // Chosen = ink, the app's selection language (handoff §0).
    tileSelected: { backgroundColor: c.foreground, borderColor: c.foreground },
    tileLabel: { fontFamily: font.bodyMedium, fontSize: 13.5, lineHeight: 18, color: c.foreground },
    tileLabelSelected: { color: c.background },
  });

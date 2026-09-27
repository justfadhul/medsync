import type { BookingSymptomOption } from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { MAX_SYMPTOMS, QUICK_PICK_CODES, SYMPTOMS_NOTE } from "@shared/symptoms";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SymptomPicker } from "@/components/patient/symptom-picker";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { setPendingSymptoms, usePendingSymptoms } from "@/lib/pending-symptoms";
import { useStyles, useTheme } from "@/theme/theme";
import { font, space } from "@/theme/tokens";

/**
 * The shortlist under "How are you feeling today?" (ADR 0096): eight
 * catalogue chips in `QUICK_PICK_CODES` order — a rule, not a curation; a
 * code the catalogue no longer has is skipped — and "More…" opening the whole
 * catalogue with search. Words only, `duration: null`; the booking screens
 * start from the same store and ask the duration as they always did. Nothing
 * reads the picks before a booking is filed.
 */
export function SymptomQuickPick({ options }: { options: BookingSymptomOption[] }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const pending = usePendingSymptoms();
  const [open, setOpen] = useState(false);

  const shortlist = QUICK_PICK_CODES.map((code) => options.find((o) => o.code === code)).filter(
    (o): o is BookingSymptomOption => o !== undefined,
  );
  const full = pending.length >= MAX_SYMPTOMS;
  const toggle = (o: BookingSymptomOption) => {
    if (pending.some((v) => v.code === o.code)) {
      setPendingSymptoms(pending.filter((v) => v.code !== o.code));
    } else if (!full) {
      setPendingSymptoms([...pending, { code: o.code, label: o.display, duration: null }]);
    }
  };

  return (
    <View style={styles.block}>
      <Text style={styles.lede}>Tap what fits. You can add more when you book.</Text>
      <ChipRow>
        {shortlist.map((o) => {
          const chosen = pending.some((v) => v.code === o.code);
          return (
            <Chip
              key={o.code}
              role="button"
              label={o.display}
              selected={chosen}
              disabled={!chosen && full}
              onPress={() => toggle(o)}
            />
          );
        })}
        <Chip role="button" label="More…" onPress={() => setOpen(true)} />
      </ChipRow>
      <Text style={styles.note}>{SYMPTOMS_NOTE}</Text>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              The whole list
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setOpen(false)}
              hitSlop={8}
              style={styles.sheetClose}
            >
              <Ionicons name="close" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          {/* A pageSheet is its own view controller on iOS: the ScrollView
              pads for the keyboard itself, or the search input sits under it. */}
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <SymptomPicker options={options} value={pending} onChange={setPendingSymptoms} />
          </ScrollView>
          <View style={styles.sheetFoot}>
            <Button label="Done" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: { gap: space[3] },
    lede: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21, color: c.mutedForeground },
    note: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },

    // The booking screens' confirm sheet, same chrome.
    sheet: { flex: 1, backgroundColor: c.background },
    sheetHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: space[5],
      paddingTop: space[5],
      paddingBottom: space[2],
    },
    sheetTitle: {
      fontFamily: font.bodySemiBold,
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.3,
      color: c.foreground,
    },
    sheetClose: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.muted,
    },
    sheetBody: { paddingHorizontal: space[5], paddingBottom: space[5], gap: space[5] },
    sheetFoot: {
      paddingHorizontal: space[5],
      paddingVertical: space[4],
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
  });

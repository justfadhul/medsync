import type { Palette } from "@/theme/tokens";
import type { CatalogItem } from "@shared/symptom-catalog/types";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ItemRow } from "@/components/symptoms/item-row";
import { QualifierChips } from "@/components/symptoms/qualifier-chips";
import { Button } from "@/components/ui/button";
import { useStyles, useTheme } from "@/theme/theme";
import { font, space } from "@/theme/tokens";

/** Emergency rows first, then catalog order — the only reordering the catalog ever gets (PRD §6.1). */
export const emergencyFirst = (items: CatalogItem[]): CatalogItem[] =>
  [...items].sort((a, b) => Number(b.tier === "E") - Number(a.tier === "E"));

/**
 * S2 (PRD §7.2): one category's ≤ 8 items in the house sheet — the
 * `pageSheet` Modal the booking screens confirm in — as tickable rows,
 * emergency first. Multi-select; a ticked row opens its qualifier chips
 * beneath it (S3). The second of the three interactions to any item.
 */
export function CategorySheet({
  title,
  items,
  selected,
  qualifiers,
  onToggle,
  onAnswer,
  onClose,
}: {
  /** The sheet's heading — a category's label, or "Danger signs"; null closes it. */
  title: string | null;
  /** The rows, already narrowed to the category (or the danger signs). */
  items: CatalogItem[];
  selected: string[];
  qualifiers: Record<string, Record<string, string>>;
  onToggle: (item: CatalogItem) => void;
  onAnswer: (itemKey: string, qualifierKey: string, optionKey: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const rows = emergencyFirst(items);

  return (
    <Modal
      visible={title !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={styles.title}>
            {title ?? ""}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={8}
            style={styles.close}
          >
            <Ionicons name="close" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {rows.map((item) => {
            const ticked = selected.includes(item.key);
            return (
              <View key={item.key} style={styles.entry}>
                <ItemRow item={item} selected={ticked} onPress={() => onToggle(item)} />
                {ticked && item.qualifiers?.length ? (
                  <QualifierChips
                    qualifiers={item.qualifiers}
                    answers={qualifiers[item.key] ?? {}}
                    onAnswer={(q, o) => onAnswer(item.key, q, o)}
                  />
                ) : null}
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.foot}>
          <Button label="Done" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: c.background },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: space[5],
      paddingTop: space[5],
      paddingBottom: space[2],
    },
    title: {
      flex: 1,
      fontFamily: font.bodySemiBold,
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.3,
      color: c.foreground,
    },
    close: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.muted,
    },
    body: { paddingHorizontal: space[5], paddingBottom: space[5], gap: space[2] },
    entry: { gap: space[2] },
    foot: {
      paddingHorizontal: space[5],
      paddingVertical: space[4],
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
  });

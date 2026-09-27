import type { SheetContact } from "@/lib/emergency";
import type { Palette } from "@/theme/tokens";
import type { ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { emergencyEvent, telUrl } from "@/lib/emergency";
import { ForcedScheme, useStyles } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * The two special routes (PRD §5.5): self-harm and sexual violence. Calm
 * on purpose — NO red, no alarm haptic, no questionnaire, no motion. The
 * words are the screen; the contacts are whatever is verified for the
 * route's kind (nothing national is at ship — ADR 0098 ruling 8 — so the
 * hospital's own line stands in until they are sourced). Permanently light
 * (Law 3).
 */
export function CalmScreen({
  title,
  lead,
  body,
  contacts,
  fallback,
  children,
  onBack,
}: {
  title: string;
  lead: string;
  body?: string;
  /** The route's contacts (`crisis` / `sv`) first, then the general line — verified only. */
  contacts: SheetContact[];
  /** The line shown when there is nothing to dial. */
  fallback: string;
  children?: ReactNode;
  onBack: () => void;
}) {
  return (
    <ForcedScheme scheme="light">
      <CalmBody
        title={title}
        lead={lead}
        body={body}
        contacts={contacts}
        fallback={fallback}
        onBack={onBack}
      >
        {children}
      </CalmBody>
    </ForcedScheme>
  );
}

function CalmBody({
  title,
  lead,
  body,
  contacts,
  fallback,
  children,
  onBack,
}: {
  title: string;
  lead: string;
  body?: string;
  contacts: SheetContact[];
  fallback: string;
  children?: ReactNode;
  onBack: () => void;
}) {
  const styles = useStyles(makeStyles);
  const call = (c: SheetContact) => {
    emergencyEvent("call_tapped", { contact_id: c.id });
    Linking.openURL(telUrl(c.number)).catch(() => {});
  };
  return (
    <Screen title={title} onBack={onBack}>
      <View style={styles.column}>
        <Text style={styles.lead}>{lead}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}

        {contacts.length ? (
          <View style={styles.list}>
            {contacts.map((c) => (
              <View key={c.id} style={styles.row}>
                <Text style={styles.rowLabel}>{c.label}</Text>
                <Button
                  variant="secondary"
                  label={`Call ${c.number}`}
                  accessibilityLabel={`Call ${c.label}, ${c.number}`}
                  onPress={() => call(c)}
                />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.note}>
            <Text style={styles.noteText}>{fallback}</Text>
          </View>
        )}

        {children}
      </View>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    column: { gap: space[5] },
    lead: {
      fontFamily: font.bodySemiBold,
      fontSize: 22,
      lineHeight: 30,
      letterSpacing: -0.3,
      color: c.foreground,
    },
    body: { fontFamily: font.body, fontSize: 16, lineHeight: 24, color: c.foreground },
    list: { gap: space[4] },
    row: { gap: space[2] },
    rowLabel: { fontFamily: font.bodyMedium, fontSize: 15, color: c.foreground },
    note: {
      padding: space[4],
      borderRadius: radius.xl,
      backgroundColor: c.muted,
      borderWidth: 1,
      borderColor: c.border,
    },
    noteText: { fontFamily: font.body, fontSize: 15, lineHeight: 22, color: c.foreground },
  });

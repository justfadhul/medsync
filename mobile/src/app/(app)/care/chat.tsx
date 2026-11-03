import type { IconName } from "@/components/tide";
import type { ScrollViewInstance } from "react-native";
import { Fragment, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Chip, DemoRibbon, HelpButton, Icon, Press, Screen } from "@/components/tide";
import { chatRepo, QUICK_REPLIES, ROLES, useChat } from "@/data/chat";
import { DayMark, Message } from "@/features/care-more/chat-parts";
import { useToast } from "@/features/care-more/use-toast";
import { flag } from "@/lib/flags";
import { motion } from "@/motion/presets";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

const NOT_YET = "Not available yet";

/**
 * Care team chat (F-19). Hidden behind `mobileChat` (off) until there is a
 * clinician inbox to answer it (ADR 0342 §4): until then the screen says so
 * plainly and offers a visit and Help instead.
 */
export default function ChatScreen() {
  return flag("mobileChat") ? <ChatThread /> : <ChatNotYet />;
}

function ChatNotYet() {
  const t = useTide();
  const router = useRouter();
  return (
    <Screen back={{ label: "Care" }} title="Messages" helpSource="care/chat">
      <Text style={[tType.bodyM, { color: t.ink }]}>
        Messaging your care team is not available yet.
      </Text>
      <Text style={[tType.bodyS, { color: t.ink2 }]}>
        To talk to a clinician, book a visit. If you feel very unwell, press the red Help button.
      </Text>
      <Button label="Book a visit" icon="calendar" onPress={() => router.push("/book")} />
    </Screen>
  );
}

/**
 * The thread (board TChat), for when `mobileChat` is on. Demo data. There is no
 * messaging engine: a sent message joins the thread as "Waiting to send" and
 * waits in the outbox on the phone. Voice, video, attach and voice notes are
 * stubs. The screen keeps its own frame (header, thread, docked composer) and
 * still carries the red Help (law L6).
 */
function ChatThread() {
  const t = useTide();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const messages = useChat();
  const [draft, setDraft] = useState("");
  const thread = useRef<ScrollViewInstance>(null);
  const { toast, show } = useToast(150 + insets.bottom);

  const send = (text: string) => {
    if (!text.trim()) return;
    void chatRepo.send(text, new Date());
    setDraft("");
  };

  const round = (icon: IconName, label: string, onPress: () => void, bg = t.bg, fg = t.ink) => (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={icon} size={20} color={fg} />
    </Press>
  );

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: t.bg }, motion.pageIn(reduced)]}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <View
        style={{
          backgroundColor: t.surface,
          paddingTop: insets.top + 6,
          paddingBottom: tSpace[3],
          paddingLeft: tSpace[1.5],
          paddingRight: tSpace[3.5],
          gap: tSpace[2.5],
          borderBottomWidth: 1,
          borderBottomColor: t.surface3,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[1.5] }}>
          <Press
            onPress={() => router.back()}
            accessibilityLabel="Back to Care"
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="back" size={22} color={t.ink} />
          </Press>
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              style={[tType.heading, { fontSize: 18, color: t.ink }]}
            >
              Your care team
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[1.5] }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent }} />
              <Text
                style={[tType.caption, { fontFamily: tFont.medium, color: t.ink2, flexShrink: 1 }]}
                numberOfLines={1}
              >
                Replies within 2 hours · Mon to Sat
              </Text>
            </View>
          </View>
          {round("phone", "Voice call the clinic", () => show(NOT_YET))}
          {round("video", "Video visit", () => show(NOT_YET))}
          <HelpButton source="care/chat" />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: tSpace[1.5], paddingLeft: tSpace[2.5] }}
        >
          {ROLES.map((r) => (
            <View
              key={r.key}
              style={{
                minHeight: 30,
                paddingLeft: tSpace[1],
                paddingRight: tSpace[2.5],
                borderRadius: tRadius.pill,
                backgroundColor: t.surface2,
                flexDirection: "row",
                alignItems: "center",
                gap: tSpace[1.5],
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: t.surface,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontFamily: tFont.bold, fontSize: 11, color: t.ink }}>
                  {r.initials}
                </Text>
              </View>
              <Text style={[tType.caption, { color: t.ink }]}>{r.label}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={thread}
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: tSpace[3.5],
            paddingBottom: tSpace[2.5],
            gap: tSpace[2.5],
          }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => thread.current?.scrollToEnd({ animated: !reduced })}
        >
          {chatRepo.demo ? <DemoRibbon /> : null}
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {i === 0 || messages[i - 1].day !== m.day ? <DayMark label={m.day} /> : null}
              <Message m={m} onReply={send} />
            </Fragment>
          ))}
        </ScrollView>

        <View
          style={{
            backgroundColor: t.surface,
            paddingTop: tSpace[2.5],
            paddingHorizontal: tSpace[3],
            paddingBottom: Math.max(insets.bottom, tSpace[3]),
            gap: tSpace[2.5],
            borderTopWidth: 1,
            borderTopColor: t.surface3,
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: tSpace[1.5] }}
          >
            {QUICK_REPLIES.map((q) => (
              <Chip key={q} label={q} size="sm" onPress={() => send(q)} />
            ))}
          </ScrollView>
          <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[2] }}>
            {round("camera", "Attach a photo or reading", () => show(NOT_YET))}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message your care team"
              placeholderTextColor={t.ink4}
              accessibilityLabel="Message your care team"
              returnKeyType="send"
              onSubmitEditing={() => send(draft)}
              style={{
                flex: 1,
                minWidth: 0,
                height: 44,
                paddingHorizontal: tSpace[4],
                borderRadius: tRadius.pill,
                backgroundColor: t.bg,
                fontFamily: tFont.regular,
                fontSize: 16,
                color: t.ink,
              }}
            />
            {draft.trim()
              ? round("send", "Send", () => send(draft), t.accent, t.onAccent)
              : round("mic", "Record a voice note", () => show(NOT_YET), t.primary, t.onPrimary)}
          </View>
          <Text style={[tType.micro, { color: t.ink3, textAlign: "center" }]}>
            Not for emergencies. If you feel very unwell, press the red Help button.
          </Text>
        </View>
      </KeyboardAvoidingView>
      {toast}
    </Animated.View>
  );
}

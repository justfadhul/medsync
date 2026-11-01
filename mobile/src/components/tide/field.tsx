import type { ReactNode } from "react";
import type { KeyboardTypeOptions, TextInputProps } from "react-native";
import { useRef } from "react";
import { formatUgPhone, isUgMobile } from "@patient-core/getting-in-signup";
import { Pressable, Text, TextInput, View } from "react-native";

import { Icon } from "@/components/tide/icon";
import { Press } from "@/components/tide/press";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

export { formatUgPhone, isUgMobile } from "@patient-core/getting-in-signup";

/**
 * Text inputs. 16pt or larger so phones never zoom (law L13); a 2pt inset
 * ring that turns lagoon when the value is good and red only for an error the
 * patient can fix. The error line appears once the field has a value.
 */
export type FieldState = "idle" | "good" | "error";

function ringFor(state: FieldState, t: ReturnType<typeof useTide>): string {
  if (state === "good") return t.accentPressed;
  if (state === "error") return t.critical.text;
  return t.line;
}

export function FieldLabel({ children, optional }: { children: string; optional?: boolean }) {
  const t = useTide();
  return (
    <Text style={[tType.caption, { fontSize: 13, color: t.ink2 }]}>
      {children}
      {optional ? (
        <Text style={{ fontFamily: tFont.medium, color: t.ink3 }}> (optional)</Text>
      ) : null}
    </Text>
  );
}

export function FieldError({ children }: { children: string }) {
  const t = useTide();
  return (
    <Text accessibilityRole="alert" style={[tType.bodyS, { fontSize: 12, color: t.critical.text }]}>
      {children}
    </Text>
  );
}

export function TextField({
  label,
  optional,
  value,
  onChangeText,
  state = "idle",
  error,
  placeholder,
  secure,
  onToggleSecure,
  keyboardType,
  autoComplete,
  maxLength,
  multiline,
  textAlign,
  accessibilityLabel,
  right,
  inputProps,
}: {
  label?: string;
  optional?: boolean;
  value: string;
  onChangeText: (next: string) => void;
  state?: FieldState;
  error?: string | null;
  placeholder?: string;
  /** Hide the text; with `onToggleSecure` an eye button shows it. */
  secure?: boolean;
  onToggleSecure?: () => void;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps["autoComplete"];
  maxLength?: number;
  multiline?: boolean;
  textAlign?: "left" | "center";
  accessibilityLabel?: string;
  right?: ReactNode;
  inputProps?: TextInputProps;
}) {
  const t = useTide();
  return (
    <View style={{ gap: tSpace[1.5] }}>
      {label ? <FieldLabel optional={optional}>{label}</FieldLabel> : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          minHeight: multiline ? 72 : 54,
          borderRadius: tRadius.field,
          backgroundColor: t.surface,
          boxShadow: `inset 0px 0px 0px 2px ${ringFor(state, t)}`,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.ink4}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          maxLength={maxLength}
          multiline={multiline}
          accessibilityLabel={accessibilityLabel ?? label}
          style={{
            flex: 1,
            minHeight: multiline ? 72 : 54,
            paddingHorizontal: tSpace[3.5],
            paddingVertical: multiline ? tSpace[3] : 0,
            fontFamily: tFont.semibold,
            fontSize: 16,
            color: t.ink,
            textAlign,
            textAlignVertical: multiline ? "top" : "center",
          }}
          {...inputProps}
        />
        {onToggleSecure ? (
          <Press
            onPress={onToggleSecure}
            accessibilityLabel={secure ? "Show password" : "Hide password"}
            style={{ width: 50, minHeight: 54, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={secure ? "eyeOff" : "eye"} size={20} color={t.ink2} />
          </Press>
        ) : null}
        {right}
      </View>
      {error && value.length > 0 ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

export function PhoneField({
  label,
  value,
  onChangeText,
  error,
  large = false,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  error?: string | null;
  large?: boolean;
}) {
  const t = useTide();
  const digits = value.replace(/ /g, "");
  const state: FieldState = isUgMobile(value) ? "good" : digits.length >= 9 ? "error" : "idle";
  const h = large ? 64 : 54;
  return (
    <View style={{ gap: tSpace[1.5] }}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: h,
          borderRadius: large ? tRadius.card : tRadius.field,
          backgroundColor: large ? t.surface2 : t.surface,
          boxShadow: `inset 0px 0px 0px 2px ${state === "idle" && large ? "transparent" : ringFor(state, t)}`,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            paddingHorizontal: tSpace[3],
            flexDirection: "row",
            alignItems: "center",
            gap: tSpace[2],
            borderRightWidth: 1,
            borderRightColor: t.line,
          }}
        >
          <Text
            style={[
              tType.label,
              { fontFamily: tFont.bold, fontSize: large ? 17 : 16, color: t.ink },
            ]}
          >
            +256
          </Text>
        </View>
        <TextInput
          value={value}
          onChangeText={(v) => onChangeText(formatUgPhone(v))}
          keyboardType="number-pad"
          autoComplete="tel-national"
          placeholder="772 000 000"
          placeholderTextColor={t.ink4}
          accessibilityLabel={label ?? "Phone number"}
          style={{
            flex: 1,
            height: "100%",
            paddingHorizontal: tSpace[3],
            fontFamily: tFont.monoSemibold,
            fontSize: large ? 20 : 17,
            letterSpacing: 0.8,
            color: t.ink,
          }}
        />
      </View>
      {error && state === "error" ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

/** Six boxes over one hidden input, so SMS autofill and paste still work. */
export function OtpBoxes({
  value,
  onChangeText,
  length = 6,
}: {
  value: string;
  onChangeText: (next: string) => void;
  length?: number;
}) {
  const t = useTide();
  const ref = useRef<TextInput>(null);
  return (
    <Pressable
      onPress={() => ref.current?.focus()}
      accessibilityRole="none"
      style={{ flexDirection: "row", justifyContent: "space-between" }}
    >
      {Array.from({ length }, (_, i) => {
        const ch = value[i] ?? "";
        const ring = i === value.length ? t.accentPressed : ch ? t.ink : t.line;
        return (
          <View
            key={i}
            style={{
              width: 44,
              height: 56,
              borderRadius: 14,
              backgroundColor: t.surface2,
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `inset 0px 0px 0px ${i === value.length || ch ? 2 : 1}px ${ring}`,
            }}
          >
            <Text style={{ fontFamily: tFont.monoBold, fontSize: 24, color: t.ink }}>{ch}</Text>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(v) => onChangeText(v.replace(/[^0-9]/g, "").slice(0, length))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        accessibilityLabel={`${length}-digit code`}
        style={{ position: "absolute", inset: 0, opacity: 0.02, fontSize: 16 }}
      />
    </Pressable>
  );
}

/**
 * A typeable number with − and + either side: reading values in the Plus
 * sheet. Steps are clamped to [min, max] and rounded to `decimals`.
 */
export function Stepper({
  label,
  unit,
  value,
  onChange,
  step,
  min,
  max,
  decimals = 0,
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (next: string) => void;
  step: number;
  min: number;
  max: number;
  decimals?: number;
}) {
  const t = useTide();
  const bump = (d: number) => {
    const n = parseFloat(value) || 0;
    const next = Math.min(
      max,
      Math.max(min, Math.round((n + d) * 10 ** decimals) / 10 ** decimals),
    );
    onChange(next.toFixed(decimals));
  };
  const round = (name: "minus" | "plus", d: number, a11y: string) => (
    <Press
      onPress={() => bump(d)}
      accessibilityLabel={`${a11y} ${label}`}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.lineStrong,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={name} size={18} color={t.ink} strokeWidth={2.2} />
    </Press>
  );
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        gap: tSpace[1.5],
        paddingVertical: tSpace[3],
        paddingHorizontal: tSpace[2],
        borderRadius: tRadius.cardLg,
        backgroundColor: t.surface2,
      }}
    >
      <Text style={[tType.caption, { color: t.ink2 }]}>{label}</Text>
      <View
        style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: tSpace[1] }}
      >
        {round("minus", -step, "Less")}
        <TextInput
          value={value}
          onChangeText={(v) =>
            onChange(v.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, "").slice(0, 5))
          }
          keyboardType={decimals ? "decimal-pad" : "number-pad"}
          selectTextOnFocus
          accessibilityLabel={label}
          style={{
            flex: 1,
            minWidth: 0,
            paddingVertical: 2,
            borderBottomWidth: 2,
            borderBottomColor: t.lineStrong,
            borderStyle: "dashed",
            textAlign: "center",
            fontFamily: tFont.monoSemibold,
            fontSize: 32,
            letterSpacing: -1,
            color: t.ink,
          }}
        />
        {round("plus", step, "More")}
      </View>
      {unit ? <Text style={[tType.bodyS, { fontSize: 12, color: t.ink3 }]}>{unit}</Text> : null}
    </View>
  );
}

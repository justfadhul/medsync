import type { ReactNode } from "react";
import type { ScrollViewInstance } from "react-native";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, TextInput } from "react-native";

/** Space kept between the focused field and the top of the keyboard. */
const ABOVE_KEYBOARD = 32;

/**
 * Keeps a scrolling form usable while the keyboard is up. The shared frames
 * (`Screen`, `Sheet` and the legacy `ui/screen`) use it, so every form gets
 * it without each screen opting in.
 *
 * - The area above the keyboard shrinks (`KeyboardFrame`), so the footer's
 *   button rides on top of the keyboard and the list can scroll to its end.
 * - When the keyboard opens, or focus moves to another field while it is open
 *   (iOS fires `keyboardDidShow` again for that), the focused field is
 *   scrolled clear of it. Android scrolls a focused field into view natively.
 *
 * Returns the ref to put on the `ScrollView` and whether the keyboard is up,
 * so a frame can drop the home-indicator padding it no longer needs.
 */
export function useKeyboardAware() {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvent, () => setShown(true));
    const onHide = Keyboard.addListener(hideEvent, () => setShown(false));
    const onShown = Keyboard.addListener("keyboardDidShow", () => {
      const input = TextInput.State.currentlyFocusedInput();
      const scroll = scrollRef.current;
      if (!input || !scroll) return;
      // ponytail: RN's own scroll-to-keyboard helper; a library such as
      // react-native-keyboard-controller would track the keyboard frame by
      // frame, but it is a native module Expo Go cannot load.
      scroll.scrollResponderScrollNativeHandleToKeyboard(input, ABOVE_KEYBOARD, true);
    });
    return () => {
      onShow.remove();
      onHide.remove();
      onShown.remove();
    };
  }, []);

  return { scrollRef, keyboardShown: shown };
}

/**
 * How the frame gives way: `padding` on iOS, `height` on Android. One
 * behaviour for both leaves the button under the keyboard on whichever
 * platform loses (found on the legacy screens, `ui/screen.tsx`).
 */
export const KEYBOARD_BEHAVIOR = Platform.OS === "ios" ? "padding" : "height";

/**
 * The part of a frame that shrinks above the keyboard: wrap the scrolling
 * content and any footer in it. Header rows stay outside, above it.
 */
export function KeyboardFrame({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
      {children}
    </KeyboardAvoidingView>
  );
}

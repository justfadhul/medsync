/**
 * Shared form primitives for the onboarding flows (GATE B).
 *
 * Built on `@base-ui/react` with the same visual conventions as
 * `components/ui/*` (teal accent, rounded-sm/-md, 11/13/15px type
 * scale). All controls submit via native form behaviour — pass them a
 * `name` and they show up in the FormData a Server Action receives.
 *
 * Primitive vs ui/: components/ui/* is the generic shadcn-style
 * library; components/forms/* layers the validation/draft/PHI-aware
 * behaviour the onboarding flows specifically need.
 */
export { Field, type FieldProps } from "./field";
export { Combobox, type ComboboxItem, type ComboboxProps } from "./combobox";
export { CascadingCombobox, type CascadingComboboxProps } from "./cascading-combobox";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./segmented-control";
export { RadioCards, type RadioCardOption, type RadioCardsProps } from "./radio-cards";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { ConsentCheckbox, type ConsentCheckboxProps } from "./consent-checkbox";
export { PhoneInput, type PhoneInputProps } from "./phone-input";
export { DatePicker, type DatePickerProps } from "./date-picker";
export { OtpInput, type OtpInputProps } from "./otp-input";
export { FileUpload, type FileUploadProps } from "./file-upload";
export {
  MultiStepForm,
  type MultiStepFormProps,
  type MultiStepStep,
  type StepRenderHelpers,
} from "./multi-step";

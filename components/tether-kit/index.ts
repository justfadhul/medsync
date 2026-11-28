/**
 * The Tether kit: one component library for every Tether surface (docs/tether-kit/gate-a-proposal.md), built
 * one set at a time. Set 1: buttons, tags, surfaces.
 * Wrap a surface in `KitRoot` (or give its root `data-pw` and `data-density`) and build only from these parts.
 */
export { KitRoot, useDensity } from "./root";
export { ICON, type Density } from "./core";
export {
  Button,
  ButtonLink,
  IconButton,
  buttonClass,
  type ButtonTone,
  type ButtonSize,
} from "./button";
export { Tag, StatusTag, type TagTone, type StatusTone, type Area } from "./tag";
export { Card, Band } from "./surface";

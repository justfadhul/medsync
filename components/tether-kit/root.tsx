"use client";

import type { Density } from "./core";
import type { ComponentProps } from "react";
import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

const DensityContext = createContext<Density>("patient");

/** The density of the nearest `KitRoot`, for parts that portal out of the page. */
export function useDensity(): Density {
  return useContext(DensityContext);
}

/**
 * The root of a Tether surface: switches the Tide tokens on (`data-pw`), sets the density once for everything
 * inside, and sets Tide's type. A desk shell renders `<KitRoot density="desk">`; a patient page the default.
 */
export function KitRoot({
  density = "patient",
  className,
  ...rest
}: ComponentProps<"div"> & { density?: Density }) {
  return (
    <DensityContext.Provider value={density}>
      <div
        {...rest}
        data-pw=""
        data-density={density}
        className={cn("bg-pw-bg text-pw-ink font-pw", className)}
      />
    </DensityContext.Provider>
  );
}

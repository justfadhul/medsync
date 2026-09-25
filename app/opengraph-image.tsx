import { ImageResponse } from "next/og";

import { HERO, HERO_LOCKED } from "@/content/hero";
import { SITE } from "@/content/landing";

/**
 * The shared-link card for every route (Next 16 `opengraph-image` convention):
 * a light 1200×630 PNG built from the hero — wordmark, kicker, headline, the
 * phone's one reading and the hospital's pattern line. Generated at build
 * time. Satori is flexbox-only and has no CSS variables, so this is the one
 * file allowed hex literals; they mirror the light-theme tokens (monochrome +
 * teal, amber only on the above-target signal).
 */

export const alt = `${SITE.wordmark} — ${HERO.title.text}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const C = {
  teal: "#0D9488",
  tealDeep: "#134E4A",
  amberFill: "#FEF3C7",
  amberText: "#92400E",
  text: "#171717",
  muted: "#525252",
  border: "#E5E5E5",
  bg: "#FFFFFF",
};

const { phone, hospital } = HERO_LOCKED;

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: C.bg,
        color: C.text,
        borderTop: `12px solid ${C.teal}`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: C.tealDeep }}>
          {SITE.wordmark}
        </div>
        <div style={{ display: "flex", fontSize: 22, color: C.muted, letterSpacing: 1 }}>
          {HERO.kicker.toUpperCase()}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 60,
            lineHeight: 1.1,
            maxWidth: 960,
            letterSpacing: -1,
          }}
        >
          {HERO.title.text}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "20px 28px",
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            fontSize: 24,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: C.muted }}>{phone.reading}</span>
            <span style={{ fontWeight: 600 }}>{phone.value}</span>
            <span style={{ color: C.muted }}>{`${phone.unit} · ${phone.time}`}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ color: C.teal }}>→</span>
            <span
              style={{
                display: "flex",
                padding: "6px 14px",
                borderRadius: 8,
                background: C.amberFill,
                color: C.amberText,
              }}
            >
              {hospital.pattern}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 18, color: C.muted }}>{HERO.caption}</div>
      </div>
    </div>,
    size,
  );
}

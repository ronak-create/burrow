import { create } from "zustand";

/**
 * Appearance preference.
 *
 * Stored in localStorage rather than the workspace, because it describes this
 * machine and this person — not the research project. Applied by stamping
 * `data-theme` on <html>, which always beats the prefers-color-scheme fallback in
 * tokens.css; "system" removes the attribute so that fallback takes over and keeps
 * tracking the OS live.
 */

export type ThemePref = "system" | "light" | "dark";

const KEY = "burrow.theme";

function read(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "dark";
}

function paint(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

interface ThemeState {
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  pref: read(),
  setPref: (pref) => {
    localStorage.setItem(KEY, pref);
    paint(pref);
    set({ pref });
  },
}));

/** Apply the stored preferences before first paint, to avoid a flash of the wrong theme. */
export function initTheme(): void {
  paint(read());
  paintAccent(readAccent());
}

/** What "system" currently resolves to, for showing the effective theme in settings. */
export function resolvedTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Accent colour.
 *
 * The palette in tokens.css is monochrome by design, so "mono" is the default and
 * simply lets those tokens stand. Any other choice writes inline custom properties
 * onto <html>, which outrank the :root rules without editing the stylesheet — the
 * one sanctioned exception to "a hardcoded hex is a bug", because these values are
 * a user preference rather than part of the theme.
 */

export type AccentPref = "mono" | "violet" | "blue" | "green" | "amber" | "red";

export const ACCENTS: Array<{ pref: AccentPref; label: string; swatch: string }> = [
  { pref: "mono", label: "Monochrome", swatch: "#f2f2f2" },
  { pref: "violet", label: "Violet", swatch: "#7c5cff" },
  { pref: "blue", label: "Blue", swatch: "#3b82f6" },
  { pref: "green", label: "Green", swatch: "#3ecf8e" },
  { pref: "amber", label: "Amber", swatch: "#e5a13a" },
  { pref: "red", label: "Red", swatch: "#e5484d" },
];

/** rgb triples, so washes and lines can be derived at one place per colour. */
const ACCENT_RGB: Record<Exclude<AccentPref, "mono">, string> = {
  violet: "124, 92, 255",
  blue: "59, 130, 246",
  green: "62, 207, 142",
  amber: "229, 161, 58",
  red: "229, 72, 77",
};

const ACCENT_KEY = "burrow.accent";

function readAccent(): AccentPref {
  const v = localStorage.getItem(ACCENT_KEY);
  return v && (v === "mono" || v in ACCENT_RGB) ? (v as AccentPref) : "mono";
}

function paintAccent(pref: AccentPref): void {
  const s = document.documentElement.style;
  const vars = [
    "--accent",
    "--accent-hover",
    "--accent-dim",
    "--accent-wash",
    "--accent-line",
    "--frame-wash",
    "--on-accent",
  ];
  if (pref === "mono") {
    // Clearing the inline values hands control back to tokens.css, which keeps the
    // accent theme-aware (near-white on dark, near-black on light).
    for (const v of vars) s.removeProperty(v);
    return;
  }
  const rgb = ACCENT_RGB[pref];
  s.setProperty("--accent", `rgb(${rgb})`);
  s.setProperty("--accent-hover", `rgb(${rgb})`);
  s.setProperty("--accent-dim", `rgba(${rgb}, 0.55)`);
  s.setProperty("--accent-wash", `rgba(${rgb}, 0.14)`);
  s.setProperty("--accent-line", `rgba(${rgb}, 0.45)`);
  s.setProperty("--frame-wash", `rgba(${rgb}, 0.05)`);
  // Every accent above is dark enough to carry white glyphs in both themes.
  s.setProperty("--on-accent", "#ffffff");
}

interface AccentState {
  accent: AccentPref;
  setAccent: (a: AccentPref) => void;
}

export const useAccent = create<AccentState>((set) => ({
  accent: readAccent(),
  setAccent: (accent) => {
    localStorage.setItem(ACCENT_KEY, accent);
    paintAccent(accent);
    set({ accent });
  },
}));

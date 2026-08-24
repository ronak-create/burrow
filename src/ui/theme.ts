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
  return v === "light" || v === "dark" || v === "system" ? v : "system";
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

/** Apply the stored preference before first paint, to avoid a flash of the wrong theme. */
export function initTheme(): void {
  paint(read());
}

/** What "system" currently resolves to, for showing the effective theme in settings. */
export function resolvedTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

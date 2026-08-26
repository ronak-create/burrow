import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { configuredProviders, getApiKey } from "../workspace/api";
import { anthropic } from "./llm/anthropic";
import { google } from "./llm/google";
import { openai } from "./llm/openai";
import { groq } from "./llm/groq";
import { cerebras } from "./llm/cerebras";
import { custom } from "./llm/custom";
import { deepgram } from "./stt/deepgram";
import { groqWhisper, openaiWhisper } from "./stt/whisper";
import type { LLMProvider, STTProvider } from "./types";

/**
 * Which features are alive right now.
 *
 * Spec E: with no keys at all, the canvas, notes, frames, tables and undo work
 * completely. Each capability lights up on its own as its key appears, and
 * nothing else is allowed to break when one is missing. So the UI asks this
 * registry rather than assuming any provider exists.
 */

export const LLM_PROVIDERS: LLMProvider[] = [anthropic, openai, google, groq, cerebras, custom];
export const STT_PROVIDERS: STTProvider[] = [groqWhisper, openaiWhisper, deepgram];

/** Every provider id we might hold a key for. The keychain cannot be enumerated. */
const KNOWN_KEYS = [...new Set([...LLM_PROVIDERS, ...STT_PROVIDERS].map((p) => p.id))];

export interface Settings {
  llmProvider: string;
  llmModel: string;
  sttProvider: string;
  /** Base URL for the "Custom / Local" provider, e.g. an Ollama server. */
  customBaseUrl: string;
  /** Canvas backdrop pattern. */
  canvasPattern: "dots" | "grid" | "plain";
  /**
   * Canvas backdrop shade, 0–100, interpolated between the theme's page colour and
   * its card colour. A number rather than a colour so it stays theme-aware — a
   * fixed hex chosen in dark mode would be wrong in light mode.
   */
  canvasShade: number;
  /** Speak assistant replies aloud. */
  voiceReplies: boolean;
}

const DEFAULTS: Settings = {
  // Local by default. A fresh install should be able to reason without the user
  // handing money to anyone first — that is the whole point of the BYOK posture,
  // and a hosted provider is one dropdown away. The model is left blank because
  // it depends on what the machine has pulled; Settings offers a Detect button.
  llmProvider: "custom",
  llmModel: "",
  sttProvider: "groq",
  customBaseUrl: "http://127.0.0.1:11434/v1",
  canvasPattern: "dots",
  canvasShade: 0,
  voiceReplies: true,
};

const SETTINGS_KEY = "burrow.settings";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    // Only preferences live here. Keys never do — those are in the OS keychain.
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

interface RegistryState {
  settings: Settings;
  /** Provider ids that currently have a key stored. */
  configured: string[];
  speechAvailable: boolean;
  ready: boolean;

  refresh: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
}

export const useProviders = create<RegistryState>((set, get) => ({
  settings: loadSettings(),
  configured: [],
  speechAvailable: false,
  ready: false,

  refresh: async () => {
    const [configured, speechAvailable] = await Promise.all([
      configuredProviders(KNOWN_KEYS).catch(() => [] as string[]),
      invoke<boolean>("speech_available").catch(() => false),
    ]);
    set({ configured, speechAvailable, ready: true });
  },

  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
  },
}));

/* ---------- capability queries ---------- */

export function canChat(s: RegistryState = useProviders.getState()): boolean {
  const provider = LLM_PROVIDERS.find((p) => p.id === s.settings.llmProvider);
  // A keyless provider is ready once it has somewhere to talk to and something to
  // run — asking the keychain about it would always say "not configured".
  if (provider?.keyOptional) {
    return Boolean(s.settings.customBaseUrl.trim() && s.settings.llmModel.trim());
  }
  return s.configured.includes(s.settings.llmProvider);
}

export function canTranscribe(s: RegistryState = useProviders.getState()): boolean {
  return s.configured.includes(s.settings.sttProvider);
}

export function canSpeak(s: RegistryState = useProviders.getState()): boolean {
  return s.speechAvailable && s.settings.voiceReplies;
}

export function activeLLM(): LLMProvider {
  const { settings } = useProviders.getState();
  return LLM_PROVIDERS.find((p) => p.id === settings.llmProvider) ?? anthropic;
}

export function activeSTT(): STTProvider {
  const { settings } = useProviders.getState();
  return STT_PROVIDERS.find((p) => p.id === settings.sttProvider) ?? groqWhisper;
}

/**
 * Fetch a key at the point of use. Never cached in module state.
 *
 * `optional` is for providers that can run without one — a local model server on
 * loopback. Those still get any key the user chose to store, since some local
 * runtimes are put behind a token, but a missing key is not an error.
 */
export async function keyFor(providerId: string, optional = false): Promise<string> {
  const key = await getApiKey(providerId);
  if (!key) {
    if (optional) return "";
    throw new Error(`No API key configured for ${providerId}. Add one in Settings.`);
  }
  return key;
}

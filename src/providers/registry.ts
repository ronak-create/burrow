import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { configuredProviders, getApiKey } from "../workspace/api";
import { anthropic } from "./llm/anthropic";
import { google } from "./llm/google";
import { openai } from "./llm/openai";
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

export const LLM_PROVIDERS: LLMProvider[] = [anthropic, openai, google];
export const STT_PROVIDERS: STTProvider[] = [groqWhisper, openaiWhisper, deepgram];

/** Every provider id we might hold a key for. The keychain cannot be enumerated. */
const KNOWN_KEYS = [...new Set([...LLM_PROVIDERS, ...STT_PROVIDERS].map((p) => p.id))];

export interface Settings {
  llmProvider: string;
  llmModel: string;
  sttProvider: string;
  /** Speak assistant replies aloud. */
  voiceReplies: boolean;
}

const DEFAULTS: Settings = {
  llmProvider: "anthropic",
  llmModel: "claude-sonnet-5",
  sttProvider: "groq",
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

/** Fetch a key at the point of use. Never cached in module state. */
export async function keyFor(providerId: string): Promise<string> {
  const key = await getApiKey(providerId);
  if (!key) throw new Error(`No API key configured for ${providerId}. Add one in Settings.`);
  return key;
}

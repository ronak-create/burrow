/**
 * Wake phrase matching.
 *
 * The wake word arrives as Whisper's guess at what was said, not as a keyword
 * spotter's confidence score, and Whisper renders a name it has never been told
 * about however it likes. Matching the literal string would mean the feature
 * works for people whose accent the model happens to spell the expected way, and
 * silently never fires for everyone else — with nothing on screen to explain it.
 *
 * So matching is phonetic, with a small edit-distance budget on top, and the
 * phrase is user-configurable. There is deliberately **no** built-in table of
 * "words Whisper produces instead of Burrow": such a table is only worth having
 * if it was built from observation, and inventing plausible-looking entries would
 * be guessing dressed up as measurement. Users who hit a consistent mishearing
 * add it themselves — the setting takes a comma-separated list.
 */

/**
 * Words a speaker puts in front of a wake word, and which Whisper freely adds,
 * drops and swaps. Leading carriers in the configured phrase are optional, so
 * "hey burrow" is woken by "burrow" alone — and by "a burrow", which is what a
 * transcript of "hey Burrow" not uncommonly looks like.
 */
const CARRIERS = new Set([
  "hey", "hi", "hello", "ok", "okay", "yo", "a", "uh", "um", "the", "and", "so",
]);

/**
 * How many filler tokens may precede the phrase.
 *
 * The wake word starts an utterance; it is not a word that may appear anywhere in
 * one. Without this window, saying "the burrow collapsed" in ordinary
 * conversation would activate the assistant, which is precisely the behaviour
 * that makes always-listening features unbearable.
 */
const LEAD_WINDOW = 3;

export interface WakeMatch {
  hit: boolean;
  /** Whatever was said after the wake phrase, as a command. Empty if nothing was. */
  rest: string;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Whisper punctuates, capitalises and hyphenates to taste, and none of it is
    // information about what was said.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Soundex. Collapses spelling variation that sounds identical, which is exactly
 * the error a transcription model makes on an unfamiliar proper noun.
 */
export function soundex(word: string): string {
  const s = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";

  const code = (c: string): string => {
    if ("BFPV".includes(c)) return "1";
    if ("CGJKQSXZ".includes(c)) return "2";
    if ("DT".includes(c)) return "3";
    if (c === "L") return "4";
    if ("MN".includes(c)) return "5";
    if (c === "R") return "6";
    return "";
  };

  let out = s[0];
  let prev = code(s[0]);
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = code(s[i]);
    if (c && c !== prev) out += c;
    // H and W are transparent: they do not separate two consonants that would
    // otherwise collapse into one code.
    if (s[i] !== "H" && s[i] !== "W") prev = c;
  }
  return (out + "000").slice(0, 4);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** One heard token against one wanted token: exact, then phonetic, then near. */
export function tokenMatches(heard: string, want: string): boolean {
  if (heard === want) return true;
  // Two characters is too little to be distinctive: at a budget of one edit, "a"
  // would match most short words in the language.
  if (want.length <= 2) return false;
  if (soundex(heard) === soundex(want)) return true;
  return levenshtein(heard, want) <= Math.max(1, Math.floor(want.length / 4));
}

function matchAt(heard: string[], want: string[], at: number): boolean {
  if (at + want.length > heard.length) return false;
  return want.every((w, i) => tokenMatches(heard[at + i], w));
}

/**
 * Look for one phrase near the start of a transcript.
 *
 * Returns any trailing text as well, because "Hey Burrow, add a note about Redis"
 * is one utterance. Waking and then discarding the instruction would make the
 * user say everything twice, which is a worse interaction than holding a button.
 */
export function matchWake(heard: string, phrase: string): WakeMatch {
  const tokens = tokenize(heard);
  const want = tokenize(phrase);
  if (want.length === 0 || tokens.length === 0) return { hit: false, rest: "" };

  // The distinctive part: the phrase with any leading carriers removed. Tried as
  // a fallback so the carrier is optional, but only if something is left — a
  // phrase that is *entirely* carriers has no distinctive part to fall back to,
  // and must be matched in full or it would fire on ordinary speech.
  const core = (() => {
    let i = 0;
    while (i < want.length && CARRIERS.has(want[i])) i++;
    return i < want.length ? want.slice(i) : want;
  })();

  const limit = Math.min(LEAD_WINDOW, tokens.length - 1) + 1;
  for (let at = 0; at < limit; at++) {
    for (const candidate of want === core ? [want] : [want, core]) {
      if (matchAt(tokens, candidate, at)) {
        return { hit: true, rest: tokens.slice(at + candidate.length).join(" ") };
      }
    }
  }
  return { hit: false, rest: "" };
}

/**
 * Match any of several comma-separated phrases.
 *
 * The escape hatch for a mishearing this code cannot anticipate. A user whose
 * engine consistently produces something the phonetic match misses adds that
 * spelling to the setting and moves on, rather than filing a bug and waiting.
 */
export function matchAnyWake(heard: string, phrases: string): WakeMatch {
  for (const phrase of phrases.split(",")) {
    if (!phrase.trim()) continue;
    const m = matchWake(heard, phrase);
    if (m.hit) return m;
  }
  return { hit: false, rest: "" };
}

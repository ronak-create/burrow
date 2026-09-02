/**
 * Transcripts that are not speech.
 *
 * Whisper does not return an empty string for silence. Asked to transcribe a
 * segment with nothing in it, it produces the most likely thing a person says at
 * the end of a recording — "Thank you.", "Thanks for watching!", a bracketed
 * sound tag — with full confidence and no error. `listener.ts` assumed silence
 * would arrive as an empty string or a lone piece of punctuation; that assumption
 * was written from reasoning and is wrong.
 *
 * Measured, 2 Sep 2026: a live microphone test produced three segments, of which
 * two were "Thank you." and neither was said. The detector had opened on room
 * noise and whisper.cpp filled the gap.
 *
 * Why this matters more when awake than asleep: an invented utterance does not
 * match the wake phrase, so a sleeping assistant ignores it. An awake one treats
 * every transcript as a command — it would answer something nobody asked, and
 * `session.ts` would reset the idle clock, so a room with any background noise
 * would keep the assistant awake indefinitely. Idle sleep exists precisely to
 * stop that.
 *
 * The cost of being wrong here is deliberately lopsided. Dropping a genuine
 * "thank you" loses nothing — it is not a command. Acting on an invented one
 * costs a model call, a spoken reply to nobody, and a session that never sleeps.
 */

/**
 * Phrases whisper produces from silence, lowercased and stripped of punctuation.
 *
 * Only whole-transcript matches count: "thank you" inside a longer sentence is
 * someone talking. The list is the observed set plus the ones documented
 * repeatedly against the ggml models — it is not open season on short replies,
 * and it should grow only from transcripts someone actually saw.
 */
const FILLERS = new Set([
  // Observed here, twice in one three-segment test.
  "thank you",
  // Reported against the ggml models often enough to be the standard examples.
  "thank you very much",
  "thanks for watching",
  "thank you for watching",
  "please subscribe to my channel",
  "bye",
  "bye bye",
  "you",
]);

// Not included, deliberately: "okay", "so", "thanks". They are also reported, but
// they are things a person genuinely says to an assistant, and this module has no
// way to tell those apart. The rule the wake matcher set holds here too — the list
// grows from transcripts someone saw, not from a plausible list someone wrote.

/** Bracketed sound tags: [BLANK_AUDIO], [Music], (upbeat music), (wind blowing). */
const TAG = /^[[(][^\])]*[\])]$/;

/** Is this transcript whisper talking to itself rather than a person talking? */
export function isFiller(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (TAG.test(t)) return true;

  // Punctuation and case carry no information here — whisper varies both freely
  // between "Thank you." and "thank you" for the same silence.
  const bare = t
    .toLowerCase()
    .replace(/[.,!?;:…"'’“”-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return FILLERS.has(bare);
}

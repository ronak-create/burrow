import { useEffect, useRef, useState } from "react";
import { ContinuousListener } from "../agent/listener";
import { tuningFor } from "../agent/vad";
import { useProviders } from "../providers/registry";
import { setMicLevel, useMicLevel } from "../ui/ListeningIndicator";
import { toastError } from "../ui/toast";

/**
 * Microphone self-test.
 *
 * This exists because of a specific gap. Everything in the always-on listening
 * path is unit-tested and the matcher and thresholds have been run against a real
 * Whisper model — but always through *files*. The live half — `getUserMedia` and
 * the `AudioWorklet` inside WebView2 — cannot be exercised without a microphone
 * and someone talking, so no amount of further automated testing reaches it.
 *
 * So it is put in front of the user as one button. Pressing it runs the exact
 * production path: the same stream, the same worklet, the same detector, the same
 * transcription. If the worklet fails to load in WebView2, it fails here, once,
 * next to an explanation — rather than silently, later, as an assistant that
 * never answers to its name.
 *
 * The meter is the other half. The defaults were measured against a speech
 * synthesiser, which is clean and level and has no room behind it; a real
 * microphone is none of those. Showing where the threshold sits against a live
 * voice is what makes that difference visible instead of mysterious.
 */
export default function MicCheck() {
  const providers = useProviders();
  const [running, setRunning] = useState(false);
  const [heard, setHeard] = useState<string[]>([]);
  const [peak, setPeak] = useState(0);
  const listener = useRef(new ContinuousListener());

  const level = useMicLevel((s) => s.level);
  const tuning = tuningFor(providers.settings.micSensitivity);

  // Releasing the microphone when this unmounts is not optional: the panel is
  // inside a dialog, and closing it must not leave a stream open behind it.
  useEffect(() => {
    const engine = listener.current;
    return () => {
      engine.stop();
      setMicLevel(0);
    };
  }, []);

  // Peak-hold. A live level alone is hard to read against a fixed line, because
  // the loudest part of a word lasts a few frames and the eye misses it.
  useEffect(() => {
    if (!running) return;
    setPeak((p) => Math.max(p, level));
  }, [level, running]);

  async function start() {
    setHeard([]);
    setPeak(0);
    setRunning(true);
    try {
      await listener.current.start(
        {
          onLevel: setMicLevel,
          onUtterance: (text) => setHeard((h) => [...h, text]),
          onError: toastError,
          onStopped: (reason) => {
            toastError(reason);
            setRunning(false);
          },
        },
        tuning,
      );
    } catch (e) {
      // The most likely failure by far, and the one this whole panel exists to
      // surface: the microphone was refused, or the worklet did not load.
      toastError(e);
      setRunning(false);
    }
  }

  function stop() {
    listener.current.stop();
    setMicLevel(0);
    setRunning(false);
  }

  // The meter is logarithmic. Speech spans a wide range at the quiet end, and on
  // a linear scale the thresholds and a normal voice all crowd into the leftmost
  // tenth of the bar, which is exactly the part that needs to be readable.
  const scale = (v: number) => Math.min(100, Math.max(0, (Math.log10(Math.max(v, 1e-4)) + 4) * 25));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={() => (running ? stop() : void start())}
          style={{
            padding: "6px 12px",
            borderRadius: "var(--r-sm)",
            fontSize: 13,
            border: "1px solid var(--border)",
            background: running ? "var(--danger)" : "transparent",
            color: running ? "var(--on-accent)" : "var(--text)",
            whiteSpace: "nowrap",
          }}
        >
          {running ? "Stop" : "Test microphone"}
        </button>
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
          {running
            ? "Say something. Speech above the line is what gets transcribed."
            : "Checks the microphone, the detector and transcription end to end."}
        </span>
      </div>

      <div
        style={{
          position: "relative",
          height: 22,
          borderRadius: "var(--r-sm)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${scale(level)}%`,
            height: "100%",
            background: level >= tuning.openRms ? "var(--accent)" : "var(--accent-dim)",
            // No transition: a smoothed bar lies about how quickly the level moves,
            // and how quickly it moves is the thing being judged.
            opacity: running ? 1 : 0.35,
          }}
        />
        {/* Peak hold, so a single loud syllable is still visible after it passes. */}
        {running && peak > 0 && (
          <div
            style={{
              position: "absolute",
              left: `${scale(peak)}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: "var(--text)",
              opacity: 0.5,
            }}
          />
        )}
        {/* The decision line. If a normal voice does not cross it, nothing works. */}
        <div
          style={{
            position: "absolute",
            left: `${scale(tuning.openRms)}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--danger)",
          }}
          title={`Speech starts at ${tuning.openRms.toFixed(3)} RMS`}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          Sensitivity
        </span>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={providers.settings.micSensitivity}
          onChange={(e) => providers.update({ micSensitivity: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span
          style={{
            fontSize: 12,
            color: "var(--text-faint)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
          }}
        >
          {providers.settings.micSensitivity} · {tuning.openRms.toFixed(3)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
        Move the slider until your normal speaking voice crosses the line but the
        quiet room does not. Changes apply the next time listening starts.
      </div>

      {heard.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          {heard.map((text, i) => (
            <div
              key={i}
              className="selectable"
              style={{
                fontSize: 13,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                padding: "6px 9px",
              }}
            >
              {text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

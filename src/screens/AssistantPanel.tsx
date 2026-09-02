import { useCallback, useEffect, useRef, useState } from "react";
import { runTurn, trimHistory } from "../agent/loop";
import { toastError, toastWarn } from "../ui/toastStore";
import { Recorder, speak, stopSpeaking, transcribe } from "../agent/voice";
import { ContinuousListener } from "../agent/listener";
import { initialSession, sessionStep, type SessionEvent, type SessionState } from "../agent/session";
import { tuningFor } from "../agent/vad";
import { canChat, canSpeak, canTranscribe, canWake, useProviders } from "../providers/registry";
import {
  LiveListeningIndicator,
  setMicLevel,
  type IndicatorState,
} from "../ui/ListeningIndicator";
import type { Turn } from "../providers/types";
import { appendTranscript, readTranscript, type TranscriptEntry } from "../workspace/api";
import { Icon } from "../ui/icons";

type Status = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

interface Line {
  role: "user" | "assistant";
  text: string;
  actions?: string[];
}

/**
 * The assistant column. Text input works with no microphone at all, which keeps
 * the whole agent loop usable — and testable — before any voice key exists.
 */
export default function AssistantPanel({ root, wsId }: { root: string; wsId: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const providers = useProviders();
  const history = useRef<Turn[]>([]);
  const recorder = useRef(new Recorder());
  const scroller = useRef<HTMLDivElement>(null);

  const chatReady = canChat(providers);
  const micReady = canTranscribe(providers);
  const busy = status !== "idle" && status !== "listening";

  /* ---------- always-on listening (spec D) ---------- */

  const [session, setSession] = useState<SessionState>(initialSession);
  const listener = useRef(new ContinuousListener());
  // Mirrored in a ref because the microphone's callbacks outlive the render they
  // were created in, and a stale session would answer with a stale mode.
  const sessionRef = useRef(session);
  const cfgRef = useRef({ wakePhrases: "", idleSleepMs: 0 });
  cfgRef.current = {
    wakePhrases: providers.settings.wakePhrase,
    idleSleepMs: providers.settings.idleSleepSeconds * 1000,
  };

  // Likewise: the listener is started once, and would otherwise keep calling the
  // first render's send.
  const sendRef = useRef<(text: string) => void>(() => {});

  /**
   * The turn in flight, so it can be given up on.
   *
   * A local model on a laptop can think for minutes, and until there was a way
   * to stop one the only options were to wait it out or close the app. Aborting
   * the request is the honest version: the provider call is cancelled, tools stop
   * running between steps, and nothing half-finished is written to the board.
   */
  const inFlight = useRef<AbortController | null>(null);

  const stopTurn = useCallback(() => {
    inFlight.current?.abort();
    void stopSpeaking();
  }, []);

  const dispatch = useCallback(
    (event: SessionEvent) => {
      const result = sessionStep(sessionRef.current, event, cfgRef.current);
      sessionRef.current = result.state;
      setSession(result.state);
      if (result.cancel) stopTurn();
      if (result.command) sendRef.current(result.command);
    },
    [stopTurn],
  );

  const wakeReady = canWake(providers);
  // Read through a ref rather than listed as a dependency: changing sensitivity
  // must not tear down and restart a live microphone mid-sentence. It takes
  // effect the next time listening starts, which is what the panel says it does.
  const sensitivityRef = useRef(providers.settings.micSensitivity);
  sensitivityRef.current = providers.settings.micSensitivity;

  useEffect(() => {
    if (!wakeReady) {
      listener.current.stop();
      dispatch({ type: "disable" });
      setMicLevel(0);
      return;
    }

    const engine = listener.current;
    dispatch({ type: "enable" });
    engine
      .start(
        {
          onLevel: setMicLevel,
          onUtterance: (text, capturedAt) => dispatch({ type: "heard", text, capturedAt }),
          onError: toastError,
          onStopped: (reason) => {
            // The engine released the microphone on its own. Flip the setting
            // too, so the toggle, the indicator and the hardware all agree — a
            // switch left reading "on" over a released microphone is the exact
            // ambiguity this feature is not allowed to have.
            toastError(reason);
            useProviders.getState().update({ wakeWord: false });
          },
        },
        // The same tuning the meter in Settings draws its line from, or that
        // meter would be calibrating something this never uses.
        tuningFor(sensitivityRef.current),
      )
      .catch((e) => {
        // The microphone was refused or is already held. Falling back to off is
        // the honest outcome: the indicator must not claim to be listening.
        toastError(e);
        dispatch({ type: "disable" });
      });

    return () => {
      engine.stop();
      dispatch({ type: "disable" });
      setMicLevel(0);
    };
  }, [wakeReady, dispatch]);

  // Anything that is not idle suspends the session: the assistant's own spoken
  // reply must not be transcribed back into a command, and audio captured while
  // the push-to-talk button is held is already being handled by that path.
  useEffect(() => {
    dispatch({
      type: "busy",
      value: status !== "idle",
      at: Date.now(),
      speaking: status === "speaking",
    });
  }, [status, dispatch]);

  useEffect(() => {
    if (session.mode !== "active") return;
    const id = setInterval(() => dispatch({ type: "tick", dtMs: 1000 }), 1000);
    return () => clearInterval(id);
  }, [session.mode, dispatch]);

  useEffect(() => {
    void providers.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replay the saved transcript so reopening a workspace shows the conversation.
  useEffect(() => {
    readTranscript(root, wsId)
      .then((entries: TranscriptEntry[]) => {
        setLines(entries.map((e) => ({ role: e.role, text: e.text, actions: e.commands })));
        history.current = entries.map((e) =>
          e.role === "user"
            ? ({ role: "user", text: e.text } as Turn)
            : ({ role: "assistant", text: e.text, toolCalls: [] } as Turn),
        );
      })
      .catch(() => {});
  }, [root, wsId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines, status]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setLines((l) => [...l, { role: "user", text: trimmed }]);
    void appendTranscript(root, wsId, { role: "user", text: trimmed, at: new Date().toISOString() });

    setStatus("thinking");
    const turn = new AbortController();
    inFlight.current = turn;
    try {
      const outcome = await runTurn(trimmed, history.current, {}, turn.signal);
      if (turn.signal.aborted) return;

      history.current = trimHistory([
        ...history.current,
        { role: "user", text: trimmed },
        { role: "assistant", text: outcome.reply, toolCalls: [] },
      ]);

      setLines((l) => [...l, { role: "assistant", text: outcome.reply, actions: outcome.actions }]);
      void appendTranscript(root, wsId, {
        role: "assistant",
        text: outcome.reply,
        at: new Date().toISOString(),
        ...(outcome.actions.length ? { commands: outcome.actions } : {}),
      });

      if (canSpeak(useProviders.getState()) && outcome.reply) {
        setStatus("speaking");
        await speak(outcome.reply);
      }
    } catch (e) {
      // Abandoning a turn is a thing the user did, not a failure to report.
      if (!turn.signal.aborted) toastError(e);
    } finally {
      if (inFlight.current === turn) inFlight.current = null;
      setStatus("idle");
    }
  }

  async function beginListening() {
    if (busy || !micReady) return;
    void stopSpeaking();
    try {
      await recorder.current.start();
      setStatus("listening");
    } catch (e) {
      toastError(e);
      setStatus("idle");
    }
  }

  async function endListening() {
    if (status !== "listening") return;
    setStatus("transcribing");
    try {
      const captured = await recorder.current.stop();
      if (!captured) {
        setStatus("idle");
        return;
      }
      const text = await transcribe(captured.blob, captured.mimeType);
      if (!text) {
        setStatus("idle");
        toastWarn("Nothing was picked up. Try again a little closer to the mic.");
        return;
      }
      await send(text);
    } catch (e) {
      toastError(e);
      setStatus("idle");
    }
  }

  // `send` is a hoisted declaration, so this is safe here and keeps the wiring
  // next to the state it belongs to.
  sendRef.current = (text: string) => void send(text);

  /**
   * What the indicator claims. Whatever the assistant is doing outranks the
   * session mode, because "thinking" and "listening" are the two states a user
   * most needs told apart, and the session is still nominally active throughout.
   */
  const indicatorState: IndicatorState =
    status === "thinking" || status === "transcribing"
      ? "thinking"
      : status === "speaking"
        ? "speaking"
        : status === "listening" || session.mode === "active"
          ? "active"
          : session.mode === "wake"
            ? "wake"
            : "off";

  function toggleWake() {
    if (!providers.settings.wakeWord && !micReady) {
      toastWarn("Set up speech-to-text in Settings before turning on always-on listening.");
      return;
    }
    providers.update({ wakeWord: !providers.settings.wakeWord });
  }

  const idle = providers.settings.wakeWord
    ? session.mode === "active"
      ? "Listening — just talk"
      : session.mode === "wake"
        ? `Say "${providers.settings.wakePhrase.split(",")[0].trim()}"`
        : "Microphone off"
    : chatReady
      ? "Hold to speak, or type"
      : "Add an API key in Settings";

  const statusLabel: Record<Status, string> = {
    idle,
    listening: "Listening…",
    transcribing: "Transcribing…",
    thinking: "Thinking…",
    speaking: "Speaking…",
  };

  return (
    <aside
      style={{
        width: "100%",
        height: "100%",
        borderLeft: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/*
            Spec D: persistent and always visible, so whether the microphone is
            live is never a question the user has to answer by guessing. It is
            also the on/off switch, because the control that makes the claim
            should be the control that changes it.
          */}
          <LiveListeningIndicator
            state={indicatorState}
            onClick={toggleWake}
            title={
              providers.settings.wakeWord
                ? "Always-on listening is on — click to turn the microphone off"
                : "Turn on always-on listening"
            }
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Research Assistant</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{statusLabel[status]}</div>
          </div>
          <button
            title={providers.settings.voiceReplies ? "Mute spoken replies" : "Speak replies aloud"}
            onClick={() => {
              providers.update({ voiceReplies: !providers.settings.voiceReplies });
              void stopSpeaking();
            }}
            style={{
              width: 26,
              height: 26,
              borderRadius: "var(--r-sm)",
              color: providers.settings.voiceReplies ? "var(--text)" : "var(--text-faint)",
            }}
          >
            <Icon name={providers.settings.voiceReplies ? "speakerOn" : "speakerOff"} />
          </button>
        </div>

        {busy ? (
          <button
            onClick={stopTurn}
            title="Stop this turn"
            style={{
              width: "100%",
              marginTop: 12,
              padding: "9px 0",
              borderRadius: "var(--r-md)",
              fontWeight: 500,
              fontSize: 14,
              color: "var(--text)",
              border: "1px solid var(--border-strong)",
              background: "var(--surface-2)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "center" }}>
              <Icon name="close" size={15} />
              {status === "speaking" ? "Stop speaking" : "Stop"}
            </span>
          </button>
        ) : (
        <button
          disabled={!micReady || busy}
          onPointerDown={() => void beginListening()}
          onPointerUp={() => void endListening()}
          onPointerLeave={() => void endListening()}
          title={micReady ? "Hold to speak" : "Set up speech-to-text in Settings"}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "9px 0",
            borderRadius: "var(--r-md)",
            fontWeight: 500,
            fontSize: 14,
            // White only over a filled accent/danger background. When the button is
            // disabled its background is a pale surface, where white is invisible in
            // the light theme.
            color: micReady && !busy ? "var(--on-accent)" : "var(--text-muted)",
            background:
              status === "listening" ? "var(--danger)" : micReady && !busy ? "var(--accent)" : "var(--surface-2)",
            border: micReady && !busy ? "none" : "1px solid var(--border)",
            opacity: micReady && !busy ? 1 : 0.9,
            cursor: micReady && !busy ? "pointer" : "not-allowed",
            transition: "background 120ms ease",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "center" }}>
            <Icon name="mic" size={15} />
            {status === "listening" ? "Release to send" : "Hold to speak"}
          </span>
        </button>
        )}
      </div>

      <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: 14, minHeight: 0 }}>
        {lines.length === 0 && (
          <p style={{ color: "var(--text-faint)", fontSize: 13, lineHeight: 1.6 }}>
            Ask for a note, a summary, or a frame around related findings. The assistant only writes
            to the board when you ask it to.
          </p>
        )}

        {lines.map((line, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div
              className="selectable"
              style={{
                background: line.role === "user" ? "var(--accent)" : "var(--card)",
                border: line.role === "user" ? "none" : "1px solid var(--border)",
                color: line.role === "user" ? "var(--on-accent)" : "var(--text)",
                borderRadius: "var(--r-md)",
                padding: "9px 12px",
                fontSize: 14,
                lineHeight: 1.5,
                marginLeft: line.role === "user" ? 28 : 0,
                marginRight: line.role === "user" ? 0 : 28,
                whiteSpace: "pre-wrap",
              }}
            >
              {line.text}
            </div>
            {line.actions?.map((a, j) => (
              <div
                key={j}
                style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, marginLeft: 4 }}
              >
                <Icon name="draw" size={10} style={{ display: "inline-block", verticalAlign: -1, marginRight: 4 }} />
                {a}
              </div>
            ))}
          </div>
        ))}

      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 6 }}>
        <input
          value={input}
          disabled={!chatReady || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send(input)}
          placeholder={chatReady ? "Ask anything…" : "No API key configured"}
          style={{
            flex: 1,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            padding: "8px 12px",
            outline: "none",
            fontSize: 14,
            opacity: chatReady ? 1 : 0.6,
          }}
        />
        <button
          disabled={!chatReady || busy || !input.trim()}
          onClick={() => void send(input)}
          style={{
            padding: "0 13px",
            borderRadius: "var(--r-md)",
            background: input.trim() && chatReady && !busy ? "var(--accent)" : "var(--surface-2)",
            color: input.trim() && chatReady && !busy ? "var(--on-accent)" : "var(--text-faint)",
          }}
        >
          <Icon name="send" size={15} />
        </button>
      </div>
    </aside>
  );
}

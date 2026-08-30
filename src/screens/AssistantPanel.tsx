import { useEffect, useRef, useState } from "react";
import { runTurn, trimHistory } from "../agent/loop";
import { toastError, toastWarn } from "../ui/toast";
import { Recorder, speak, stopSpeaking, transcribe } from "../agent/voice";
import { canChat, canSpeak, canTranscribe, useProviders } from "../providers/registry";
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
    try {
      const outcome = await runTurn(trimmed, history.current);

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
      toastError(e);
    } finally {
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

  const statusLabel: Record<Status, string> = {
    idle: chatReady ? "Hold to speak, or type" : "Add an API key in Settings",
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

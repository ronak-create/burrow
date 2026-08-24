import { useBoard } from "../canvas/store";
import { isSparse, serializeBoard } from "../canvas/serialize";
import { activeLLM, keyFor, useProviders } from "../providers/registry";
import type { Turn } from "../providers/types";
import { TOOLS, runTool } from "./tools";

/**
 * One conversational turn: user says something, the model may call tools, tools
 * mutate the board through the command layer, the model gets the results, and
 * eventually it produces a reply.
 *
 * The board is re-serialised into the system prompt on every request rather than
 * being carried in history, so the model always sees the board as it is now —
 * including edits the user made mid-conversation.
 */

const MAX_STEPS = 6;

function systemPrompt(): string {
  const board = useBoard.getState().board;
  return [
    "You are the research assistant inside Burrow, a desktop tool where a researcher",
    "thinks on an infinite board. You are talked to by voice, often in passing, so keep spoken",
    "replies short and natural — a sentence or two. The board is where detail belongs, not the reply.",
    "",
    "How you work:",
    "- Write to the board only when asked. Do not add blocks unprompted.",
    "- When you do add something, say briefly what you put where.",
    "- Never cover existing work: omit x and y and let placement find empty space unless the user named a spot.",
    "- If you are unsure about something on the board, do not interrupt. Either ask at the end of your",
    "  reply, or use flag_block to leave a '?' marker the user can address whenever they like.",
    "- Framing regroups someone's thinking. On a board that already has work, ask before adding a frame.",
    "",
    `The board is currently ${isSparse(board) ? "nearly empty, so you may organise it freely" : "already in use, so treat it as the user's work"}.`,
    "",
    "Current board state (JSON):",
    serializeBoard(board),
  ].join("\n");
}

export interface TurnCallbacks {
  /** Called as tools land, so the UI can show what the assistant is doing. */
  onToolActivity?: (summary: string) => void;
}

export interface TurnOutcome {
  reply: string;
  /** Human-readable list of what the assistant did to the board this turn. */
  actions: string[];
}

export async function runTurn(
  userText: string,
  history: Turn[],
  cb: TurnCallbacks = {},
): Promise<TurnOutcome> {
  const provider = activeLLM();
  const { settings } = useProviders.getState();
  const apiKey = await keyFor(provider.id);

  const messages: Turn[] = [...history, { role: "user", text: userText }];
  const actions: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await provider.send({
      apiKey,
      model: settings.llmModel,
      // Rebuilt each step so the model sees the board it just changed.
      system: systemPrompt(),
      messages,
      tools: TOOLS,
    });

    if (!reply.wantsTools || reply.toolCalls.length === 0) {
      return { reply: reply.text.trim(), actions };
    }

    messages.push({ role: "assistant", text: reply.text, toolCalls: reply.toolCalls });

    const results = [];
    for (const call of reply.toolCalls) {
      const result = await runTool(call);
      results.push(result);
      if (!result.isError) {
        actions.push(result.content);
        cb.onToolActivity?.(result.content);
      }
    }
    messages.push({ role: "tool", results });
  }

  // Ran out of steps — return whatever was accomplished rather than hanging.
  return {
    reply: "I made several changes but stopped before finishing. Tell me if you want me to continue.",
    actions,
  };
}

/** History is capped so a long session cannot grow the context without bound. */
export function trimHistory(history: Turn[], maxTurns = 20): Turn[] {
  if (history.length <= maxTurns) return history;
  const trimmed = history.slice(-maxTurns);
  // Never start history with orphaned tool results — the model rejects that.
  while (trimmed.length && trimmed[0].role === "tool") trimmed.shift();
  return trimmed;
}

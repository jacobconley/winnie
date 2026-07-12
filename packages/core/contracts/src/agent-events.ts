import type { RunId, ThreadId } from "./ids.js";

export type RunStatus = "queued" | "running" | "stopped" | "completed" | "failed";

export interface RunStartedEvent {
  readonly type: "run.started";
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly timestamp: string;
}

export interface RunStatusChangedEvent {
  readonly type: "run.statusChanged";
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly status: RunStatus;
  readonly timestamp: string;
}

export interface UserPromptEvent {
  readonly type: "user.prompt";
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly prompt: string;
  readonly timestamp: string;
}

export interface AssistantTextDeltaEvent {
  readonly type: "assistant.textDelta";
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly delta: string;
  readonly timestamp: string;
}

export type AgentEvent =
  | RunStartedEvent
  | RunStatusChangedEvent
  | UserPromptEvent
  | AssistantTextDeltaEvent;

export const AgentEvent = {
  is: (value: unknown): value is AgentEvent => {
    if (typeof value !== "object" || value === null || !("type" in value)) {
      return false;
    }
    const type = (value as { type: unknown }).type;
    return (
      type === "run.started" ||
      type === "run.statusChanged" ||
      type === "user.prompt" ||
      type === "assistant.textDelta"
    );
  },
} as const;

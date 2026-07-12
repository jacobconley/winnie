import type { Brand } from "@winnie/utils";

export type ThreadId = Brand<string, "ThreadId">;
export type RunId = Brand<string, "RunId">;
export type TaskId = Brand<string, "TaskId">;

export type RunStatus = "queued" | "running" | "stopped" | "completed" | "failed";

export interface Task {
  readonly id: TaskId;
  readonly title: string;
  readonly prompt: string;
  readonly createdAt: string;
}

export interface RunStartedEvent {
  readonly type: "run.started";
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly timestamp: string;
}

export interface RunStatusChangedEvent {
  readonly type: "run.statusChanged";
  readonly runId: RunId;
  readonly status: RunStatus;
  readonly timestamp: string;
}

export interface AssistantTextDeltaEvent {
  readonly type: "assistant.textDelta";
  readonly runId: RunId;
  readonly delta: string;
  readonly timestamp: string;
}

export type AgentEvent = RunStartedEvent | RunStatusChangedEvent | AssistantTextDeltaEvent;

import type { RunStatus } from "./agent-events.js";
import type { RunId, TaskId, ThreadId } from "./ids.js";

/**
 * Long-lived agent conversation. Maps to Cursor's session via `cursorSessionId`
 * when known (used as `--resume` on follow-up runs).
 */
export interface Thread {
  readonly id: ThreadId;
  readonly workspacePath: string;
  /** Cursor chat/session id for `--resume`; set after the first successful stream init/result. */
  readonly cursorSessionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Active run for this thread, if any. */
  readonly activeRunId?: RunId;
}

/**
 * One `cursor-agent` subprocess invocation for a single user prompt.
 */
export interface Run {
  readonly id: RunId;
  readonly threadId: ThreadId;
  readonly prompt: string;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly stdoutLogPath?: string;
  readonly stderrLogPath?: string;
  readonly exitCode?: number | null;
  readonly exitSignal?: string | null;
}

/** Optional task grouping — not required for chat execution yet. */
export interface Task {
  readonly id: TaskId;
  readonly title: string;
  readonly prompt: string;
  readonly createdAt: string;
}

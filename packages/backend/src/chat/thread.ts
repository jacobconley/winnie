import path from "node:path";
import type { RunId, ThreadId } from "@winnie/contracts/ids";

/**
 * Resolved filesystem layout for a single thread under the backend data directory.
 */
export interface ThreadPaths {
  readonly threadId: ThreadId;
  readonly dir: string;
  readonly threadJson: string;
  readonly transcriptPath: string;
  readonly logDirectory: string;
  readonly runJson: (runId: RunId) => string;
}

/**
 * Path helpers for chat thread storage. Plain data — not an Effect context.
 */
export const ThreadPaths = {
  threadsRoot: (dataDirectory: string) => path.join(dataDirectory, "threads"),

  make: (dataDirectory: string, threadId: ThreadId): ThreadPaths => {
    const dir = path.join(dataDirectory, "threads", threadId);
    return {
      threadId,
      dir,
      threadJson: path.join(dir, "thread.json"),
      transcriptPath: path.join(dir, "transcript.ndjson"),
      logDirectory: path.join(dir, "logs"),
      runJson: (runId) => path.join(dir, "runs", `${runId}.json`),
    };
  },
} as const;

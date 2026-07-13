import path from "node:path";
import type { RunId, ThreadId } from "@winnie/contracts/ids";

/**
 * Resolved filesystem layout for a single thread under a threads root.
 * Collection root (`threadsRoot`) is owned by {@link AgentChatStorage}.
 */
export interface ThreadPaths {
  readonly threadId: ThreadId;
  readonly dir: string;
  readonly threadJson: string;
  readonly transcriptPath: string;
  readonly logDirectory: string;
  readonly runJson: (runId: RunId) => string;
}

export const ThreadPaths = (threadsRoot: string, threadId: ThreadId): ThreadPaths => {
  const dir = path.join(threadsRoot, threadId);
  return {
    threadId,
    dir,
    threadJson: path.join(dir, "thread.json"),
    transcriptPath: path.join(dir, "transcript.ndjson"),
    logDirectory: path.join(dir, "logs"),
    runJson: (runId) => path.join(dir, "runs", `${runId}.json`),
  };
};

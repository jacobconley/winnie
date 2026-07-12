import path from "node:path";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { Context, Effect, Layer } from "effect";
import { CursorContext } from "../cursor-context.js";

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

export type ThreadContextService = ThreadPaths;

/**
 * Per-thread scope: paths (and later workspace / session details) for one chat thread.
 *
 * Built from {@link CursorContext}; provide with {@link ThreadContext.layer}.
 */
export class ThreadContext extends Context.Tag("@winnie/backend/ThreadContext")<
  ThreadContext,
  ThreadContextService
>() {
  static layer = (threadId: ThreadId) =>
    Layer.effect(
      ThreadContext,
      Effect.gen(function* () {
        const { dataDirectory } = yield* CursorContext;
        return ThreadPaths.make(dataDirectory, threadId);
      }),
    );
}

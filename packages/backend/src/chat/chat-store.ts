import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEvent } from "@winnie/contracts/agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { RunId as RunIdNs, ThreadId as ThreadIdNs } from "@winnie/contracts/ids";
import type { Run, Thread } from "@winnie/contracts/thread";
import { MessageError } from "@winnie/utils/message-error";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { ThreadPaths } from "./thread.js";

/**
 * Durable chat storage root (process data directory).
 * Construct with {@link ChatStore.make}; namespace ops take this as the first argument.
 */
export interface ChatStore {
  readonly dataDirectory: string;
}

const readJsonFile = <A>(filePath: string, label: string) =>
  MessageError.TryPromise(
    async () => JSON.parse(await readFile(filePath, "utf8")) as A,
    (error, builder) => builder.line(`Failed to read ${label}.`).line(filePath).cause(error),
  );

const writeJsonFile = (filePath: string, value: unknown, label: string) =>
  MessageError.TryPromise(
    async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    },
    (error, builder) => builder.line(`Failed to write ${label}.`).line(filePath).cause(error),
  );

const reviveThread = (value: Thread): Thread => ({
  ...value,
  id: ThreadIdNs.make(value.id),
  ...(value.activeRunId === undefined ? {} : { activeRunId: RunIdNs.make(value.activeRunId) }),
});

const reviveRun = (value: Run): Run => ({
  ...value,
  id: RunIdNs.make(value.id),
  threadId: ThreadIdNs.make(value.threadId),
});

const pathsFor = (store: ChatStore, threadId: ThreadId) =>
  ThreadPaths.make(store.dataDirectory, threadId);

const threadLogDirectory: {
  (store: ChatStore, threadId: ThreadId): string;
  (threadId: ThreadId): (store: ChatStore) => string;
} = dual(
  2,
  (store: ChatStore, threadId: ThreadId): string => pathsFor(store, threadId).logDirectory,
);

const saveThread: {
  (store: ChatStore, thread: Thread): Effect.Effect<void, MessageError>;
  (thread: Thread): (store: ChatStore) => Effect.Effect<void, MessageError>;
} = dual(
  2,
  (store: ChatStore, thread: Thread): Effect.Effect<void, MessageError> =>
    writeJsonFile(pathsFor(store, thread.id).threadJson, thread, "thread metadata"),
);

const loadThread: {
  (store: ChatStore, threadId: ThreadId): Effect.Effect<Thread, MessageError>;
  (threadId: ThreadId): (store: ChatStore) => Effect.Effect<Thread, MessageError>;
} = dual(
  2,
  (store: ChatStore, threadId: ThreadId): Effect.Effect<Thread, MessageError> =>
    Effect.gen(function* () {
      const raw = yield* readJsonFile<Thread>(
        pathsFor(store, threadId).threadJson,
        "thread metadata",
      );
      return reviveThread(raw);
    }),
);

const listThreads = (store: ChatStore): Effect.Effect<readonly Thread[], MessageError> =>
  MessageError.TryPromise(
    async () => {
      const threadsRoot = ThreadPaths.threadsRoot(store.dataDirectory);
      await mkdir(threadsRoot, { recursive: true });
      const entries = await readdir(threadsRoot, { withFileTypes: true });
      const threads: Thread[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const filePath = path.join(threadsRoot, entry.name, "thread.json");
        try {
          const raw = JSON.parse(await readFile(filePath, "utf8")) as Thread;
          threads.push(reviveThread(raw));
        } catch {
          // Skip corrupt / incomplete thread dirs during listing.
        }
      }

      return threads.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    (error, builder) => builder.line("Failed to list threads.").cause(error),
  );

const saveRun: {
  (store: ChatStore, run: Run): Effect.Effect<void, MessageError>;
  (run: Run): (store: ChatStore) => Effect.Effect<void, MessageError>;
} = dual(
  2,
  (store: ChatStore, run: Run): Effect.Effect<void, MessageError> =>
    writeJsonFile(pathsFor(store, run.threadId).runJson(run.id), run, "run metadata"),
);

const loadRun: {
  (store: ChatStore, threadId: ThreadId, runId: RunId): Effect.Effect<Run, MessageError>;
  (threadId: ThreadId, runId: RunId): (store: ChatStore) => Effect.Effect<Run, MessageError>;
} = dual(
  3,
  (store: ChatStore, threadId: ThreadId, runId: RunId): Effect.Effect<Run, MessageError> =>
    Effect.gen(function* () {
      const raw = yield* readJsonFile<Run>(
        pathsFor(store, threadId).runJson(runId),
        "run metadata",
      );
      return reviveRun(raw);
    }),
);

const appendTranscript: {
  (
    store: ChatStore,
    threadId: ThreadId,
    events: readonly AgentEvent[],
  ): Effect.Effect<void, MessageError>;
  (
    threadId: ThreadId,
    events: readonly AgentEvent[],
  ): (store: ChatStore) => Effect.Effect<void, MessageError>;
} = dual(
  3,
  (
    store: ChatStore,
    threadId: ThreadId,
    events: readonly AgentEvent[],
  ): Effect.Effect<void, MessageError> => {
    if (events.length === 0) {
      return Effect.void;
    }

    const filePath = pathsFor(store, threadId).transcriptPath;
    return MessageError.TryPromise(
      async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        const chunk = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
        await appendFile(filePath, chunk, "utf8");
      },
      (error, builder) =>
        builder.line("Failed to append transcript events.").line(filePath).cause(error),
    );
  },
);

const readTranscript: {
  (store: ChatStore, threadId: ThreadId): Effect.Effect<readonly AgentEvent[], MessageError>;
  (threadId: ThreadId): (store: ChatStore) => Effect.Effect<readonly AgentEvent[], MessageError>;
} = dual(
  2,
  (store: ChatStore, threadId: ThreadId): Effect.Effect<readonly AgentEvent[], MessageError> => {
    const filePath = pathsFor(store, threadId).transcriptPath;
    return MessageError.TryPromise(
      async () => {
        let text: string;
        try {
          text = await readFile(filePath, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [] as AgentEvent[];
          }
          throw error;
        }

        const events: AgentEvent[] = [];
        for (const line of text.split("\n")) {
          if (line.trim().length === 0) continue;
          const value: unknown = JSON.parse(line);
          if (!AgentEvent.is(value)) {
            throw new Error(`Invalid agent event line: ${line}`);
          }
          events.push({
            ...value,
            runId: RunIdNs.make(value.runId),
            threadId: ThreadIdNs.make(value.threadId),
          } as AgentEvent);
        }
        return events;
      },
      (error, builder) => builder.line("Failed to read transcript.").line(filePath).cause(error),
    );
  },
);

export const ChatStore = {
  make: (dataDirectory: string): ChatStore => ({ dataDirectory }),
  paths: pathsFor,
  threadLogDirectory,
  saveThread,
  loadThread,
  listThreads,
  saveRun,
  loadRun,
  appendTranscript,
  readTranscript,
};

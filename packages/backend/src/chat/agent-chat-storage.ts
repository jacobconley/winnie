import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEvent } from "@winnie/contracts/agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { RunId as RunIdNs, ThreadId as ThreadIdNs } from "@winnie/contracts/ids";
import type { Run, Thread } from "@winnie/contracts/thread";
import { MessageError } from "@winnie/utils/message-error";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { ThreadPaths } from "./agent-chat-core.js";

/**
 * Durable chat filesystem root. Owns `threadsRoot`; no cursor knowledge.
 */
export interface AgentChatStorage {
  readonly dataDirectory: string;
  readonly threadsRoot: string;
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

const paths: {
  (storage: AgentChatStorage, threadId: ThreadId): ThreadPaths;
  (threadId: ThreadId): (storage: AgentChatStorage) => ThreadPaths;
} = dual(
  2,
  (storage: AgentChatStorage, threadId: ThreadId): ThreadPaths =>
    ThreadPaths(storage.threadsRoot, threadId),
);

const threadLogDirectory: {
  (storage: AgentChatStorage, threadId: ThreadId): string;
  (threadId: ThreadId): (storage: AgentChatStorage) => string;
} = dual(
  2,
  (storage: AgentChatStorage, threadId: ThreadId): string => paths(storage, threadId).logDirectory,
);

const saveThread: {
  (storage: AgentChatStorage, thread: Thread): Effect.Effect<void, MessageError>;
  (thread: Thread): (storage: AgentChatStorage) => Effect.Effect<void, MessageError>;
} = dual(
  2,
  (storage: AgentChatStorage, thread: Thread): Effect.Effect<void, MessageError> =>
    writeJsonFile(paths(storage, thread.id).threadJson, thread, "thread metadata"),
);

const loadThread: {
  (storage: AgentChatStorage, threadId: ThreadId): Effect.Effect<Thread, MessageError>;
  (threadId: ThreadId): (storage: AgentChatStorage) => Effect.Effect<Thread, MessageError>;
} = dual(
  2,
  (storage: AgentChatStorage, threadId: ThreadId): Effect.Effect<Thread, MessageError> =>
    Effect.gen(function* () {
      const raw = yield* readJsonFile<Thread>(
        paths(storage, threadId).threadJson,
        "thread metadata",
      );
      return reviveThread(raw);
    }),
);

const listThreads = (storage: AgentChatStorage): Effect.Effect<readonly Thread[], MessageError> =>
  MessageError.TryPromise(
    async () => {
      await mkdir(storage.threadsRoot, { recursive: true });
      const entries = await readdir(storage.threadsRoot, { withFileTypes: true });
      const threads: Thread[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const filePath = path.join(storage.threadsRoot, entry.name, "thread.json");
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
  (storage: AgentChatStorage, run: Run): Effect.Effect<void, MessageError>;
  (run: Run): (storage: AgentChatStorage) => Effect.Effect<void, MessageError>;
} = dual(
  2,
  (storage: AgentChatStorage, run: Run): Effect.Effect<void, MessageError> =>
    writeJsonFile(paths(storage, run.threadId).runJson(run.id), run, "run metadata"),
);

const loadRun: {
  (storage: AgentChatStorage, threadId: ThreadId, runId: RunId): Effect.Effect<Run, MessageError>;
  (
    threadId: ThreadId,
    runId: RunId,
  ): (storage: AgentChatStorage) => Effect.Effect<Run, MessageError>;
} = dual(
  3,
  (storage: AgentChatStorage, threadId: ThreadId, runId: RunId): Effect.Effect<Run, MessageError> =>
    Effect.gen(function* () {
      const raw = yield* readJsonFile<Run>(paths(storage, threadId).runJson(runId), "run metadata");
      return reviveRun(raw);
    }),
);

const appendTranscript: {
  (
    storage: AgentChatStorage,
    threadId: ThreadId,
    events: readonly AgentEvent[],
  ): Effect.Effect<void, MessageError>;
  (
    threadId: ThreadId,
    events: readonly AgentEvent[],
  ): (storage: AgentChatStorage) => Effect.Effect<void, MessageError>;
} = dual(
  3,
  (
    storage: AgentChatStorage,
    threadId: ThreadId,
    events: readonly AgentEvent[],
  ): Effect.Effect<void, MessageError> => {
    if (events.length === 0) {
      return Effect.void;
    }

    const filePath = paths(storage, threadId).transcriptPath;
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
  (
    storage: AgentChatStorage,
    threadId: ThreadId,
  ): Effect.Effect<readonly AgentEvent[], MessageError>;
  (
    threadId: ThreadId,
  ): (storage: AgentChatStorage) => Effect.Effect<readonly AgentEvent[], MessageError>;
} = dual(
  2,
  (
    storage: AgentChatStorage,
    threadId: ThreadId,
  ): Effect.Effect<readonly AgentEvent[], MessageError> => {
    const filePath = paths(storage, threadId).transcriptPath;
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

export const AgentChatStorage = {
  make: (dataDirectory: string): AgentChatStorage => ({
    dataDirectory,
    threadsRoot: path.join(dataDirectory, "threads"),
  }),
  paths,
  threadLogDirectory,
  saveThread,
  loadThread,
  listThreads,
  saveRun,
  loadRun,
  appendTranscript,
  readTranscript,
};

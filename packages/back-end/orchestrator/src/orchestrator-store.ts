import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEvent } from "@winnie/contracts/agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { RunId as RunIdNs, ThreadId as ThreadIdNs } from "@winnie/contracts/ids";
import type { Run, Thread } from "@winnie/contracts/thread";
import { MessageError } from "@winnie/utils/message-error";
import { Effect } from "effect";

export interface OrchestratorPaths {
  readonly root: string;
  threadDir: (threadId: ThreadId) => string;
  threadJson: (threadId: ThreadId) => string;
  transcriptPath: (threadId: ThreadId) => string;
  runJson: (threadId: ThreadId, runId: RunId) => string;
}

export const OrchestratorPaths = {
  make: (root: string): OrchestratorPaths => ({
    root,
    threadDir: (threadId) => path.join(root, "threads", threadId),
    threadJson: (threadId) => path.join(root, "threads", threadId, "thread.json"),
    transcriptPath: (threadId) => path.join(root, "threads", threadId, "transcript.ndjson"),
    runJson: (threadId, runId) => path.join(root, "threads", threadId, "runs", `${runId}.json`),
  }),
} as const;

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

export const ThreadStore = {
  save: (paths: OrchestratorPaths, thread: Thread) =>
    writeJsonFile(paths.threadJson(thread.id), thread, "thread metadata"),

  load: (paths: OrchestratorPaths, threadId: ThreadId) =>
    Effect.gen(function* () {
      const raw = yield* readJsonFile<Thread>(paths.threadJson(threadId), "thread metadata");
      return reviveThread(raw);
    }),

  list: (paths: OrchestratorPaths) =>
    MessageError.TryPromise(
      async () => {
        const threadsRoot = path.join(paths.root, "threads");
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
    ),
} as const;

export const RunStore = {
  save: (paths: OrchestratorPaths, run: Run) =>
    writeJsonFile(paths.runJson(run.threadId, run.id), run, "run metadata"),

  load: (paths: OrchestratorPaths, threadId: ThreadId, runId: RunId) =>
    Effect.gen(function* () {
      const raw = yield* readJsonFile<Run>(paths.runJson(threadId, runId), "run metadata");
      return reviveRun(raw);
    }),
} as const;

export const TranscriptStore = {
  append: (paths: OrchestratorPaths, threadId: ThreadId, events: readonly AgentEvent[]) => {
    if (events.length === 0) {
      return Effect.void;
    }

    return MessageError.TryPromise(
      async () => {
        const filePath = paths.transcriptPath(threadId);
        await mkdir(path.dirname(filePath), { recursive: true });
        const chunk = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
        await appendFile(filePath, chunk, "utf8");
      },
      (error, builder) =>
        builder
          .line("Failed to append transcript events.")
          .line(paths.transcriptPath(threadId))
          .cause(error),
    );
  },

  read: (paths: OrchestratorPaths, threadId: ThreadId) =>
    MessageError.TryPromise(
      async () => {
        const filePath = paths.transcriptPath(threadId);
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
      (error, builder) =>
        builder
          .line("Failed to read transcript.")
          .line(paths.transcriptPath(threadId))
          .cause(error),
    ),
} as const;

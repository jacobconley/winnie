import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEvent } from "@winnie/contracts/agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { RunId as RunIdNs, ThreadId as ThreadIdNs } from "@winnie/contracts/ids";
import type { Run, Thread } from "@winnie/contracts/thread";
import { MessageError } from "@winnie/utils/message-error";
import { Effect } from "effect";
import { BackendConfig } from "./backend-config.js";

const makePaths = (root: string) => ({
  root,
  threadDir: (threadId: ThreadId) => path.join(root, "threads", threadId),
  threadJson: (threadId: ThreadId) => path.join(root, "threads", threadId, "thread.json"),
  transcriptPath: (threadId: ThreadId) => path.join(root, "threads", threadId, "transcript.ndjson"),
  runJson: (threadId: ThreadId, runId: RunId) =>
    path.join(root, "threads", threadId, "runs", `${runId}.json`),
  threadLogDirectory: (threadId: ThreadId) => path.join(root, "threads", threadId, "logs"),
});

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

/**
 * Durable chat storage (threads, runs, transcripts). Paths come from
 * {@link BackendConfig} in Effect context — not from the orchestrator model.
 */
export class ChatStore extends Effect.Service<ChatStore>()("@winnie/backend/ChatStore", {
  effect: Effect.gen(function* () {
    const { dataDirectory } = yield* BackendConfig;
    const paths = makePaths(dataDirectory);

    return {
      dataDirectory,

      threadLogDirectory: (threadId: ThreadId) => paths.threadLogDirectory(threadId),

      saveThread: (thread: Thread) =>
        writeJsonFile(paths.threadJson(thread.id), thread, "thread metadata"),

      loadThread: (threadId: ThreadId) =>
        Effect.gen(function* () {
          const raw = yield* readJsonFile<Thread>(paths.threadJson(threadId), "thread metadata");
          return reviveThread(raw);
        }),

      listThreads: () =>
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

      saveRun: (run: Run) =>
        writeJsonFile(paths.runJson(run.threadId, run.id), run, "run metadata"),

      loadRun: (threadId: ThreadId, runId: RunId) =>
        Effect.gen(function* () {
          const raw = yield* readJsonFile<Run>(paths.runJson(threadId, runId), "run metadata");
          return reviveRun(raw);
        }),

      appendTranscript: (threadId: ThreadId, events: readonly AgentEvent[]) => {
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

      readTranscript: (threadId: ThreadId) =>
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
  }),
}) {}

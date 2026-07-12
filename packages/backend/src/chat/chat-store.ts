import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEvent } from "@winnie/contracts/agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { RunId as RunIdNs, ThreadId as ThreadIdNs } from "@winnie/contracts/ids";
import type { Run, Thread } from "@winnie/contracts/thread";
import { MessageError } from "@winnie/utils/message-error";
import { Effect } from "effect";
import { CursorContext } from "../cursor-context.js";
import { ThreadPaths } from "./thread-context.js";

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
 * Durable chat storage (threads, runs, transcripts).
 * Uses {@link CursorContext} for the data root and {@link ThreadPaths} per thread.
 */
export class ChatStore extends Effect.Service<ChatStore>()("@winnie/backend/ChatStore", {
  effect: Effect.gen(function* () {
    const cursor = yield* CursorContext;
    const pathsFor = (threadId: ThreadId) => ThreadPaths.make(cursor.dataDirectory, threadId);

    return {
      dataDirectory: cursor.dataDirectory,

      threadLogDirectory: (threadId: ThreadId) => pathsFor(threadId).logDirectory,

      saveThread: (thread: Thread) =>
        writeJsonFile(pathsFor(thread.id).threadJson, thread, "thread metadata"),

      loadThread: (threadId: ThreadId) =>
        Effect.gen(function* () {
          const raw = yield* readJsonFile<Thread>(pathsFor(threadId).threadJson, "thread metadata");
          return reviveThread(raw);
        }),

      listThreads: () =>
        MessageError.TryPromise(
          async () => {
            const threadsRoot = ThreadPaths.threadsRoot(cursor.dataDirectory);
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
        writeJsonFile(pathsFor(run.threadId).runJson(run.id), run, "run metadata"),

      loadRun: (threadId: ThreadId, runId: RunId) =>
        Effect.gen(function* () {
          const raw = yield* readJsonFile<Run>(pathsFor(threadId).runJson(runId), "run metadata");
          return reviveRun(raw);
        }),

      appendTranscript: (threadId: ThreadId, events: readonly AgentEvent[]) => {
        if (events.length === 0) {
          return Effect.void;
        }

        const filePath = pathsFor(threadId).transcriptPath;
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

      readTranscript: (threadId: ThreadId) => {
        const filePath = pathsFor(threadId).transcriptPath;
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
          (error, builder) =>
            builder.line("Failed to read transcript.").line(filePath).cause(error),
        );
      },
    } as const;
  }),
}) {}

import { randomUUID } from "node:crypto";
import type { AgentEvent, RunStatus } from "@winnie/contracts/agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { RunId as RunIdNs } from "@winnie/contracts/ids";
import type { Run, Thread } from "@winnie/contracts/thread";
import { MessageError } from "@winnie/utils/message-error";
import { Data, Deferred, Effect, Fiber, Queue, Ref, Stream } from "effect";
import { dual } from "effect/Function";
import type { CursorAgentRunRequest } from "../cursor-agent/cursor-agent-transport.js";
import { CursorService as CursorServiceNs } from "../cursor-agent/cursor-agent-transport.js";
import type { ProcessIoError, ProcessStartError } from "../cursor-agent/process-runner.js";
import type { AgentChat } from "./agent-chat.js";
import type { ThreadPaths } from "./agent-chat-core.js";
import { AgentChatStorage as Storage } from "./agent-chat-storage.js";
import { cursorSessionIdFromEvent, mapCursorAgentEvent } from "./agent-event-mapper.js";

export class AgentChatConflictError extends Data.TaggedError("AgentChatConflictError")<{
  readonly message: string;
  readonly threadId: ThreadId;
  readonly activeRunId?: RunId;
}> {}

export type AgentChatError =
  | MessageError
  | ProcessStartError
  | ProcessIoError
  | AgentChatConflictError;

export interface SendMessageRequest {
  readonly prompt: string;
  readonly force?: boolean;
  readonly model?: string;
  readonly sandbox?: string;
}

/**
 * Long-lived thread handle: FS ↔ cursor integration with a live event queue.
 */
export interface AgentChatThread {
  readonly id: ThreadId;
  readonly chat: AgentChat;
  readonly paths: ThreadPaths;
  /** @internal */
  readonly eventQueue: Queue.Queue<AgentEvent>;
  /** @internal */
  readonly liveRun: Ref.Ref<LiveRun | undefined>;
}

/**
 * Per-send control handle (no event stream — use {@link AgentChatThread} events).
 */
export interface AgentChatRun {
  readonly run: Run;
  readonly threadId: ThreadId;
  readonly exit: Effect.Effect<Run, AgentChatError>;
  readonly stop: Effect.Effect<Run, AgentChatError>;
}

interface LiveRun {
  readonly runId: RunId;
  readonly stop: Effect.Effect<Run, AgentChatError>;
}

const isoNow = () => new Date().toISOString();
const freshRunId = () => RunIdNs.make(randomUUID());

const clearActiveRun = (thread: Thread): Thread => {
  const { activeRunId: _activeRunId, ...rest } = thread;
  return {
    ...rest,
    updatedAt: isoNow(),
  };
};

const publish = (
  thread: AgentChatThread,
  events: readonly AgentEvent[],
): Effect.Effect<void, MessageError> =>
  Effect.gen(function* () {
    yield* Storage.appendTranscript(thread.chat.storage, thread.id, events);
    for (const event of events) {
      yield* Queue.offer(thread.eventQueue, event);
    }
  });

const make = (chat: AgentChat, threadId: ThreadId): Effect.Effect<AgentChatThread> =>
  Effect.gen(function* () {
    const eventQueue = yield* Queue.unbounded<AgentEvent>();
    const liveRun = yield* Ref.make<LiveRun | undefined>(undefined);
    return {
      id: threadId,
      chat,
      paths: Storage.paths(chat.storage, threadId),
      eventQueue,
      liveRun,
    };
  });

const events = (thread: AgentChatThread): Stream.Stream<AgentEvent, never> =>
  Stream.fromQueue(thread.eventQueue);

const snapshot = (thread: AgentChatThread): Effect.Effect<Thread, MessageError> =>
  Storage.loadThread(thread.chat.storage, thread.id);

const getTranscript = (
  thread: AgentChatThread,
): Effect.Effect<readonly AgentEvent[], MessageError> =>
  Storage.readTranscript(thread.chat.storage, thread.id);

const getRun: {
  (thread: AgentChatThread, runId: RunId): Effect.Effect<Run, MessageError>;
  (runId: RunId): (thread: AgentChatThread) => Effect.Effect<Run, MessageError>;
} = dual(2, (thread: AgentChatThread, runId: RunId) =>
  Storage.loadRun(thread.chat.storage, thread.id, runId),
);

const send: {
  (
    thread: AgentChatThread,
    request: SendMessageRequest,
  ): Effect.Effect<AgentChatRun, AgentChatError>;
  (
    request: SendMessageRequest,
  ): (thread: AgentChatThread) => Effect.Effect<AgentChatRun, AgentChatError>;
} = dual(2, (thread: AgentChatThread, request: SendMessageRequest) =>
  Effect.gen(function* () {
    const storage = thread.chat.storage;
    const cursor = thread.chat.cursor;
    const meta = yield* Storage.loadThread(storage, thread.id);

    if (meta.activeRunId !== undefined) {
      return yield* new AgentChatConflictError({
        message: `Thread ${meta.id} already has an active run.`,
        threadId: meta.id,
        activeRunId: meta.activeRunId,
      });
    }

    const timestamp = isoNow();
    const runId = freshRunId();

    const runState = yield* Ref.make<Run>({
      id: runId,
      threadId: thread.id,
      prompt: request.prompt,
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
    });

    const threadState = yield* Ref.make<Thread>({
      ...meta,
      activeRunId: runId,
      updatedAt: timestamp,
    });

    const lifecycleEvents: AgentEvent[] = [
      {
        type: "run.started",
        runId,
        threadId: thread.id,
        timestamp,
      },
      {
        type: "user.prompt",
        runId,
        threadId: thread.id,
        prompt: request.prompt,
        timestamp,
      },
    ];

    yield* Storage.saveRun(storage, yield* Ref.get(runState));
    yield* Storage.saveThread(storage, yield* Ref.get(threadState));
    yield* publish(thread, lifecycleEvents);

    const cursorRequest: CursorAgentRunRequest = {
      prompt: request.prompt,
      workspacePath: meta.workspacePath,
      ...(request.force === undefined ? {} : { force: request.force }),
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.sandbox === undefined ? {} : { sandbox: request.sandbox }),
      ...(meta.cursorSessionId === undefined ? {} : { resume: meta.cursorSessionId }),
      logDirectory: thread.paths.logDirectory,
    };

    const started = yield* CursorServiceNs.start(cursor, cursorRequest);

    yield* Ref.update(runState, (run) => ({
      ...run,
      stdoutLogPath: started.stdoutLogPath,
      stderrLogPath: started.stderrLogPath,
      updatedAt: isoNow(),
    }));
    yield* Storage.saveRun(storage, yield* Ref.get(runState));

    const finalized = yield* Deferred.make<Run, never>();
    const finalizeClaimed = yield* Ref.make(false);
    const finalize = (
      status: RunStatus,
      exit: {
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      },
    ) =>
      Effect.gen(function* () {
        const claimed = yield* Ref.modify(finalizeClaimed, (done) => [!done, true]);
        if (!claimed) {
          return yield* Deferred.await(finalized);
        }

        const endedAt = isoNow();
        const run = yield* Ref.updateAndGet(runState, (current) => ({
          ...current,
          status,
          endedAt,
          exitCode: exit.code,
          exitSignal: exit.signal,
          updatedAt: endedAt,
        }));

        const currentThread = yield* Ref.get(threadState);
        const nextThread = clearActiveRun(currentThread);
        yield* Ref.set(threadState, nextThread);

        const statusEvent: AgentEvent = {
          type: "run.statusChanged",
          runId,
          threadId: thread.id,
          status,
          timestamp: endedAt,
        };

        yield* Storage.saveRun(storage, run);
        yield* Storage.saveThread(storage, nextThread);
        yield* publish(thread, [statusEvent]);
        yield* Ref.set(thread.liveRun, undefined);
        yield* Deferred.succeed(finalized, run);
        return run;
      });

    const ingestFiber = yield* Effect.forkDaemon(
      started.events.pipe(
        Stream.runForEach((cursorEvent) =>
          Effect.gen(function* () {
            const sessionId = cursorSessionIdFromEvent(cursorEvent);
            if (sessionId !== undefined) {
              const current = yield* Ref.get(threadState);
              if (current.cursorSessionId !== sessionId) {
                const updated: Thread = {
                  ...current,
                  cursorSessionId: sessionId,
                  updatedAt: isoNow(),
                };
                yield* Ref.set(threadState, updated);
                yield* Storage.saveThread(storage, updated);
              }
            }

            const mapped = mapCursorAgentEvent(cursorEvent, {
              runId,
              threadId: thread.id,
            });
            if (mapped.length > 0) {
              yield* publish(thread, mapped);
            }
          }),
        ),
      ),
    );

    const stderrFiber = yield* Effect.forkDaemon(
      Stream.runDrain(started.stderr).pipe(Effect.ignore),
    );

    const settleProcess = Effect.gen(function* () {
      const processExit = yield* started.exit;
      yield* Fiber.join(ingestFiber).pipe(Effect.ignore);
      yield* Fiber.join(stderrFiber).pipe(Effect.ignore);
      return processExit;
    });

    const exit = Effect.gen(function* () {
      const processExit = yield* settleProcess;
      const status: RunStatus =
        processExit.signal !== null ? "stopped" : processExit.code === 0 ? "completed" : "failed";
      return yield* finalize(status, {
        code: processExit.code,
        signal: processExit.signal,
      });
    });

    const stopRun = Effect.gen(function* () {
      yield* started.kill;
      const processExit = yield* settleProcess.pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            code: null as number | null,
            signal: "SIGTERM" as NodeJS.Signals | null,
          }),
        ),
      );
      return yield* finalize("stopped", {
        code: processExit.code,
        signal: processExit.signal,
      });
    });

    yield* Ref.set(thread.liveRun, { runId, stop: stopRun });

    return {
      run: yield* Ref.get(runState),
      threadId: thread.id,
      exit,
      stop: stopRun,
    } satisfies AgentChatRun;
  }),
);

const stop = (thread: AgentChatThread): Effect.Effect<Run, AgentChatError> =>
  Effect.gen(function* () {
    const live = yield* Ref.get(thread.liveRun);
    if (live === undefined) {
      return yield* MessageError.FailWith(`No active run on thread '${thread.id}' to stop.`);
    }
    return yield* live.stop;
  });

export const AgentChatThread = {
  make,
  events,
  snapshot,
  getTranscript,
  getRun,
  send,
  stop,
};

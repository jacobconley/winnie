import { randomUUID } from "node:crypto";
import type { AgentEvent, RunStatus } from "@winnie/contracts/agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";
import { RunId as RunIdNs, ThreadId as ThreadIdNs } from "@winnie/contracts/ids";
import type { Run, Thread } from "@winnie/contracts/thread";
import { MessageError } from "@winnie/utils/message-error";
import { Data, Deferred, Effect, Fiber, Layer, Queue, Ref, Stream } from "effect";
import {
  type CursorAgentRunRequest,
  CursorService,
} from "../cursor-agent/cursor-agent-transport.js";
import type { ProcessIoError, ProcessStartError } from "../cursor-agent/process-runner.js";
import { CursorContext } from "../cursor-context.js";
import { cursorSessionIdFromEvent, mapCursorAgentEvent } from "./agent-event-mapper.js";
import { ChatStore } from "./chat-store.js";

export class OrchestratorConflictError extends Data.TaggedError("OrchestratorConflictError")<{
  readonly message: string;
  readonly threadId: ThreadId;
  readonly activeRunId?: RunId;
}> {}

export type ChatOrchestratorError =
  | MessageError
  | ProcessStartError
  | ProcessIoError
  | OrchestratorConflictError;

export interface CreateThreadRequest {
  readonly workspacePath: string;
}

export interface StartRunRequest {
  readonly threadId: ThreadId;
  readonly prompt: string;
  readonly force?: boolean;
  readonly model?: string;
  readonly sandbox?: string;
}

export interface ActiveRun {
  readonly run: Run;
  readonly thread: Thread;
  /** Live app events for this run (also appended to the thread transcript). */
  readonly events: Stream.Stream<AgentEvent, ChatOrchestratorError>;
  /** Wait for the subprocess to finish and finalize run status. */
  readonly exit: Effect.Effect<Run, ChatOrchestratorError>;
  /** Kill the subprocess and finalize as `stopped`. */
  readonly stop: Effect.Effect<Run, ChatOrchestratorError>;
}

interface LiveRun {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly stop: Effect.Effect<Run, ChatOrchestratorError>;
}

const isoNow = () => new Date().toISOString();
const freshThreadId = () => ThreadIdNs.make(randomUUID());
const freshRunId = () => RunIdNs.make(randomUUID());

const clearActiveRun = (thread: Thread): Thread => {
  const { activeRunId: _activeRunId, ...rest } = thread;
  return {
    ...rest,
    updatedAt: isoNow(),
  };
};

export class ChatOrchestrator extends Effect.Service<ChatOrchestrator>()(
  "@winnie/backend/ChatOrchestrator",
  {
    effect: Effect.gen(function* () {
      const cursor = yield* CursorService;
      const store = yield* ChatStore;
      const liveRuns = yield* Ref.make<ReadonlyMap<RunId, LiveRun>>(new Map());

      const createThread = (request: CreateThreadRequest) =>
        Effect.gen(function* () {
          const timestamp = isoNow();
          const thread: Thread = {
            id: freshThreadId(),
            workspacePath: request.workspacePath,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          yield* store.saveThread(thread);
          return thread;
        });

      const getThread = (threadId: ThreadId) => store.loadThread(threadId);
      const listThreads = () => store.listThreads();
      const getTranscript = (threadId: ThreadId) => store.readTranscript(threadId);
      const getRun = (threadId: ThreadId, runId: RunId) => store.loadRun(threadId, runId);

      const registerLive = (live: LiveRun) =>
        Ref.update(liveRuns, (map) => new Map(map).set(live.runId, live));

      const unregisterLive = (runId: RunId) =>
        Ref.update(liveRuns, (map) => {
          const next = new Map(map);
          next.delete(runId);
          return next;
        });

      const startRun = (request: StartRunRequest) =>
        Effect.gen(function* () {
          const thread = yield* store.loadThread(request.threadId);

          if (thread.activeRunId !== undefined) {
            return yield* new OrchestratorConflictError({
              message: `Thread ${thread.id} already has an active run.`,
              threadId: thread.id,
              activeRunId: thread.activeRunId,
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
            ...thread,
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

          yield* store.saveRun(yield* Ref.get(runState));
          yield* store.saveThread(yield* Ref.get(threadState));
          yield* store.appendTranscript(thread.id, lifecycleEvents);

          const cursorRequest: CursorAgentRunRequest = {
            prompt: request.prompt,
            workspacePath: thread.workspacePath,
            ...(request.force === undefined ? {} : { force: request.force }),
            ...(request.model === undefined ? {} : { model: request.model }),
            ...(request.sandbox === undefined ? {} : { sandbox: request.sandbox }),
            ...(thread.cursorSessionId === undefined ? {} : { resume: thread.cursorSessionId }),
            logDirectory: store.threadLogDirectory(thread.id),
          };

          const started = yield* cursor.start(cursorRequest);

          yield* Ref.update(runState, (run) => ({
            ...run,
            stdoutLogPath: started.stdoutLogPath,
            stderrLogPath: started.stderrLogPath,
            updatedAt: isoNow(),
          }));
          yield* store.saveRun(yield* Ref.get(runState));

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

              yield* store.saveRun(run);
              yield* store.saveThread(nextThread);
              yield* store.appendTranscript(thread.id, [statusEvent]);
              yield* unregisterLive(runId);
              yield* Deferred.succeed(finalized, run);
              return run;
            });

          const eventQueue = yield* Queue.unbounded<AgentEvent>();
          for (const event of lifecycleEvents) {
            yield* Queue.offer(eventQueue, event);
          }

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
                      yield* store.saveThread(updated);
                    }
                  }

                  const mapped = mapCursorAgentEvent(cursorEvent, {
                    runId,
                    threadId: thread.id,
                  });
                  if (mapped.length > 0) {
                    yield* store.appendTranscript(thread.id, mapped);
                    for (const event of mapped) {
                      yield* Queue.offer(eventQueue, event);
                    }
                  }
                }),
              ),
              Effect.ensuring(Queue.shutdown(eventQueue)),
            ),
          );

          const stderrFiber = yield* Effect.forkDaemon(
            Stream.runDrain(started.stderr).pipe(Effect.ignore),
          );

          const events: Stream.Stream<AgentEvent, ChatOrchestratorError> =
            Stream.fromQueue(eventQueue);

          const settleProcess = Effect.gen(function* () {
            const processExit = yield* started.exit;
            yield* Fiber.join(ingestFiber).pipe(Effect.ignore);
            yield* Fiber.join(stderrFiber).pipe(Effect.ignore);
            return processExit;
          });

          const exit = Effect.gen(function* () {
            const processExit = yield* settleProcess;
            const status: RunStatus =
              processExit.signal !== null
                ? "stopped"
                : processExit.code === 0
                  ? "completed"
                  : "failed";
            return yield* finalize(status, {
              code: processExit.code,
              signal: processExit.signal,
            });
          });

          const stop = Effect.gen(function* () {
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

          const active: ActiveRun = {
            run: yield* Ref.get(runState),
            thread: yield* Ref.get(threadState),
            events,
            exit,
            stop,
          };

          yield* registerLive({
            runId,
            threadId: thread.id,
            stop,
          });

          return active;
        });

      const stopRun = (runId: RunId) =>
        Effect.gen(function* () {
          const live = (yield* Ref.get(liveRuns)).get(runId);
          if (live === undefined) {
            return yield* MessageError.FailWith(`No active run '${runId}' to stop.`);
          }
          return yield* live.stop;
        });

      return {
        createThread,
        getThread,
        listThreads,
        getTranscript,
        getRun,
        startRun,
        stopRun,
      };
    }),
    dependencies: [
      Layer.provide(Layer.merge(ChatStore.Default, CursorService.Default), CursorContext.Default),
    ],
  },
) {}

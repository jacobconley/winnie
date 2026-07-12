import { CursorAgentEvent } from "@winnie/contracts/cursor-agent-events";
import type { MessageError } from "@winnie/utils/message-error";
import { Effect, Stream } from "effect";
import { dual } from "effect/Function";
import { NdjsonStream } from "./ndjson-stream.js";
import {
  type ProcessExit,
  type ProcessIoError,
  type ProcessRequest,
  ProcessRunner,
  type ProcessStartError,
} from "./process-runner.js";
import { compactArgs } from "./shell-utils.js";

/** Cursor args for each message */
export interface CursorAgentRunRequest {
  /** User message passed to `cursor-agent -p` for non-interactive print mode. */
  readonly prompt: string;
  /** Directory to spawn `cursor-agent` from; Cursor also has `--workspace` if cwd proves insufficient. */
  readonly workspacePath: string;
  /** Maps to `--force`, allowing tool execution unless explicitly denied. */
  readonly force?: boolean;
  /** Directory for Winnie-owned stdout/stderr logs; unrelated to Cursor CLI flags. */
  readonly logDirectory?: string;
  /** Maps to `--model`. @see https://cursor.com/docs/cli/reference/parameters */
  readonly model?: string;
  /** Cursor chat id for `--resume`; omit to start a new Cursor agent session. */
  readonly resume?: string;
  /** Maps to `--sandbox` (`enabled` or `disabled`). */
  readonly sandbox?: string;
}

export interface StartedCursorAgent {
  readonly request: CursorAgentRunRequest;
  readonly processRequest: ProcessRequest;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly events: Stream.Stream<CursorAgentEvent, ProcessIoError | MessageError>;
  readonly stderr: Stream.Stream<Uint8Array, ProcessIoError>;
  readonly exit: Effect.Effect<ProcessExit, ProcessStartError>;
  readonly kill: Effect.Effect<void>;
}

export interface CursorAgentRunResult {
  readonly request: CursorAgentRunRequest;
  readonly events: readonly CursorAgentEvent[];
  readonly exit: ProcessExit;
}

export interface CursorServiceOptions {
  readonly resolveExecutable: (name: string) => Effect.Effect<string, MessageError>;
}

/**
 * `cursor-agent` transport closed over a process runner + executable resolver.
 * Construct with {@link CursorService.make}; ops take this as the first argument.
 */
export interface CursorService {
  readonly processRunner: ProcessRunner;
  readonly resolveExecutable: (name: string) => Effect.Effect<string, MessageError>;
}

const makeCursorAgentArgs = (request: CursorAgentRunRequest): string[] =>
  compactArgs([
    "-p",
    request.prompt,
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    request.force && "--force",
    request.model && "--model",
    request.model,
    request.resume && "--resume",
    request.resume,
    request.sandbox && "--sandbox",
    request.sandbox,
  ]);

const makeProcessRequest = (args: {
  readonly command: string;
  readonly request: CursorAgentRunRequest;
}): ProcessRequest => ({
  args: makeCursorAgentArgs(args.request),
  command: args.command,
  cwd: args.request.workspacePath,
  label: "cursor-agent",
  ...(args.request.logDirectory === undefined ? {} : { logDirectory: args.request.logDirectory }),
});

const eventsFromStdout = (
  stdout: Stream.Stream<Uint8Array, ProcessIoError>,
): Stream.Stream<CursorAgentEvent, ProcessIoError | MessageError> =>
  NdjsonStream.bytesToJson(stdout).pipe(Stream.mapEffect(CursorAgentEvent.decode));

const createProcessRequest: {
  (
    service: CursorService,
    request: CursorAgentRunRequest,
  ): Effect.Effect<ProcessRequest, MessageError>;
  (
    request: CursorAgentRunRequest,
  ): (service: CursorService) => Effect.Effect<ProcessRequest, MessageError>;
} = dual(2, (service: CursorService, request: CursorAgentRunRequest) =>
  Effect.gen(function* () {
    const command = yield* service.resolveExecutable("cursor-agent");
    return makeProcessRequest({ command, request });
  }),
);

const start: {
  (
    service: CursorService,
    request: CursorAgentRunRequest,
  ): Effect.Effect<StartedCursorAgent, MessageError | ProcessStartError>;
  (
    request: CursorAgentRunRequest,
  ): (
    service: CursorService,
  ) => Effect.Effect<StartedCursorAgent, MessageError | ProcessStartError>;
} = dual(2, (service: CursorService, request: CursorAgentRunRequest) =>
  Effect.gen(function* () {
    const processRequest = yield* createProcessRequest(service, request);
    const started = yield* ProcessRunner.start(service.processRunner, processRequest);

    return {
      request,
      processRequest,
      stdoutLogPath: started.stdoutLogPath,
      stderrLogPath: started.stderrLogPath,
      events: eventsFromStdout(started.stdout),
      stderr: started.stderr,
      exit: started.exit,
      kill: started.kill,
    } satisfies StartedCursorAgent;
  }),
);

const run: {
  (
    service: CursorService,
    request: CursorAgentRunRequest,
  ): Effect.Effect<CursorAgentRunResult, MessageError | ProcessStartError | ProcessIoError>;
  (
    request: CursorAgentRunRequest,
  ): (
    service: CursorService,
  ) => Effect.Effect<CursorAgentRunResult, MessageError | ProcessStartError | ProcessIoError>;
} = dual(2, (service: CursorService, request: CursorAgentRunRequest) =>
  Effect.gen(function* () {
    const started = yield* start(service, request);

    const [events, , exit] = yield* Effect.all(
      [Stream.runCollect(started.events), Stream.runDrain(started.stderr), started.exit],
      { concurrency: "unbounded" },
    );

    return {
      request,
      events: [...events],
      exit,
    } satisfies CursorAgentRunResult;
  }),
);

export const CursorService = {
  make: (processRunner: ProcessRunner, options: CursorServiceOptions): CursorService => ({
    processRunner,
    resolveExecutable: options.resolveExecutable,
  }),
  createProcessRequest,
  start,
  run,
};

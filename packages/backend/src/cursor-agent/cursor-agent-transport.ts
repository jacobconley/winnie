import { CursorAgentEvent } from "@winnie/contracts/cursor-agent-events";
import type { MessageError } from "@winnie/utils/message-error";
import { Effect, Stream } from "effect";
import { NdjsonStream } from "./ndjson-stream.js";
import {
  type ProcessExit,
  type ProcessIoError,
  type ProcessRequest,
  ProcessRunner,
  type ProcessStartError,
} from "./process-runner.js";
import { ShellEnvironment } from "./shell-environment.js";
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

export class CursorService extends Effect.Service<CursorService>()(
  "@winnie/backend/CursorAgentTransport",
  {
    effect: Effect.gen(function* () {
      const processRunner = yield* ProcessRunner;
      const shellEnvironment = yield* ShellEnvironment;

      const createProcessRequest = (request: CursorAgentRunRequest) =>
        Effect.gen(function* () {
          const command = yield* shellEnvironment.resolveExecutable("cursor-agent");
          return makeProcessRequest({ command, request });
        });

      const start = (request: CursorAgentRunRequest) =>
        Effect.gen(function* () {
          const processRequest = yield* createProcessRequest(request);
          const started = yield* processRunner.start(processRequest);

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
        });

      const run = (request: CursorAgentRunRequest) =>
        Effect.gen(function* () {
          const started = yield* start(request);

          const [events, , exit] = yield* Effect.all(
            [Stream.runCollect(started.events), Stream.runDrain(started.stderr), started.exit],
            { concurrency: "unbounded" },
          );

          return {
            request,
            events: [...events],
            exit,
          } satisfies CursorAgentRunResult;
        });

      return {
        createProcessRequest,
        start,
        run,
      };
    }),
    dependencies: [ProcessRunner.Default],
  },
) {}

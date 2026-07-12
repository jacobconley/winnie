import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeStream } from "@effect/platform-node";
import { TryEffect } from "@winnie/utils/try";
import { Data, Effect, Stream } from "effect";
import { dual } from "effect/Function";

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly label?: string;
  readonly logDirectory?: string;
  readonly stdin?: string;
}

export interface ProcessExit {
  readonly request: ProcessRequest;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
}

export interface StartedProcess {
  readonly request: ProcessRequest;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly stdout: Stream.Stream<Uint8Array, ProcessIoError>;
  readonly stderr: Stream.Stream<Uint8Array, ProcessIoError>;
  readonly exit: Effect.Effect<ProcessExit, ProcessStartError>;
  readonly kill: Effect.Effect<void>;
}

export class ProcessStartError extends Data.TaggedError("ProcessStartError")<{
  readonly request: ProcessRequest;
  readonly cause: unknown;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly callSite?: string;
}> {}

export class ProcessIoError extends Data.TaggedError("ProcessIoError")<{
  readonly request: ProcessRequest;
  readonly cause: unknown;
  readonly stream: "stdout" | "stderr";
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly callSite?: string;
}> {}

export class ProcessExitError extends Data.TaggedError("ProcessExitError")<{
  readonly exit: ProcessExit;
}> {}

export type ProcessRunnerError = ProcessStartError | ProcessIoError | ProcessExitError;

/**
 * Argv process runner closed over a login-shell env.
 * Construct with {@link ProcessRunner.make}; ops take this as the first argument.
 */
export interface ProcessRunner {
  readonly shellEnv: NodeJS.ProcessEnv;
}

type LogPaths = {
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
};

const sanitizeLogName = (value: string): string => value.replaceAll(/[^a-zA-Z0-9._-]/g, "-");

const makeLogPaths = (request: ProcessRequest): Effect.Effect<LogPaths, ProcessStartError> =>
  TryEffect.promise({
    try: async () => {
      const logDirectory = request.logDirectory ?? path.join(tmpdir(), "winnie-process-logs");
      await mkdir(logDirectory, { recursive: true });

      const label = sanitizeLogName(request.label ?? path.basename(request.command));
      const id = randomUUID();

      return {
        stderrLogPath: path.join(logDirectory, `${label}-${id}.stderr.log`),
        stdoutLogPath: path.join(logDirectory, `${label}-${id}.stdout.log`),
      };
    },
    catch: (cause, { callSite }) =>
      new ProcessStartError({
        request,
        cause,
        stderrLogPath: "",
        stdoutLogPath: "",
        ...(callSite === undefined ? {} : { callSite }),
      }),
  });

const endFile = (file: WriteStream) =>
  Effect.async<void>((resume) => {
    file.end(() => resume(Effect.void));
  });

const writeToLogFile = (
  file: WriteStream,
  chunk: Uint8Array,
  request: ProcessRequest,
  stream: "stdout" | "stderr",
  logPaths: LogPaths,
) =>
  Effect.async<void, ProcessIoError>((resume) => {
    const ok = file.write(chunk, (cause) => {
      if (cause) {
        resume(
          Effect.fail(
            new ProcessIoError({
              request,
              cause,
              stream,
              ...logPaths,
            }),
          ),
        );
        return;
      }
      resume(Effect.void);
    });

    if (!ok) {
      file.once("drain", () => resume(Effect.void));
    }
  });

const byteStreamFor = (
  child: ChildProcessWithoutNullStreams,
  streamName: "stdout" | "stderr",
  file: WriteStream,
  request: ProcessRequest,
  logPaths: LogPaths,
): Stream.Stream<Uint8Array, ProcessIoError> =>
  NodeStream.fromReadable(
    () => child[streamName],
    (cause) =>
      new ProcessIoError({
        request,
        cause,
        stream: streamName,
        ...logPaths,
      }),
  ).pipe(
    Stream.tap((chunk) => writeToLogFile(file, chunk, request, streamName, logPaths)),
    Stream.ensuring(endFile(file)),
  );

const startProcess = (
  request: ProcessRequest,
  shellEnv: NodeJS.ProcessEnv,
): Effect.Effect<StartedProcess, ProcessStartError> =>
  Effect.gen(function* () {
    const logPaths = yield* makeLogPaths(request);

    const child = yield* TryEffect.sync({
      try: () => {
        const spawned = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: { ...shellEnv, ...request.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        if (request.stdin !== undefined) {
          spawned.stdin.end(request.stdin);
        } else {
          spawned.stdin.end();
        }

        return spawned;
      },
      catch: (cause, { callSite }) =>
        new ProcessStartError({
          request,
          cause,
          ...logPaths,
          ...(callSite === undefined ? {} : { callSite }),
        }),
    });

    const stdoutFile = createWriteStream(logPaths.stdoutLogPath, { flags: "w" });
    const stderrFile = createWriteStream(logPaths.stderrLogPath, { flags: "w" });

    const exitPromise = new Promise<ProcessExit>((resolve, reject) => {
      child.once("error", (cause) => {
        reject(
          new ProcessStartError({
            request,
            cause,
            ...logPaths,
          }),
        );
      });
      child.once("close", (code, signal) => {
        resolve({
          request,
          code,
          signal,
          ...logPaths,
        });
      });
    });

    const exit = TryEffect.promise({
      try: () => exitPromise,
      catch: (cause, { callSite }) =>
        cause instanceof ProcessStartError
          ? cause
          : new ProcessStartError({
              request,
              cause,
              ...logPaths,
              ...(callSite === undefined ? {} : { callSite }),
            }),
    });

    return {
      request,
      ...logPaths,
      stdout: byteStreamFor(child, "stdout", stdoutFile, request, logPaths),
      stderr: byteStreamFor(child, "stderr", stderrFile, request, logPaths),
      exit,
      kill: Effect.sync(() => {
        child.kill();
      }),
    };
  });

const runProcess = (
  request: ProcessRequest,
  shellEnv: NodeJS.ProcessEnv,
  options?: { readonly failOnNonZero?: boolean },
): Effect.Effect<ProcessExit, ProcessStartError | ProcessIoError | ProcessExitError> =>
  Effect.gen(function* () {
    const started = yield* startProcess(request, shellEnv);

    const [, , exit] = yield* Effect.all(
      [Stream.runDrain(started.stdout), Stream.runDrain(started.stderr), started.exit],
      { concurrency: "unbounded" },
    );

    if ((options?.failOnNonZero ?? true) && exit.code !== 0) {
      return yield* Effect.fail(new ProcessExitError({ exit }));
    }

    return exit;
  });

const start: {
  (
    runner: ProcessRunner,
    request: ProcessRequest,
  ): Effect.Effect<StartedProcess, ProcessStartError>;
  (
    request: ProcessRequest,
  ): (runner: ProcessRunner) => Effect.Effect<StartedProcess, ProcessStartError>;
} = dual(2, (runner: ProcessRunner, request: ProcessRequest) =>
  startProcess(request, runner.shellEnv),
);

const run: {
  (
    runner: ProcessRunner,
    request: ProcessRequest,
    options?: { readonly failOnNonZero?: boolean },
  ): Effect.Effect<ProcessExit, ProcessStartError | ProcessIoError | ProcessExitError>;
  (
    request: ProcessRequest,
    options?: { readonly failOnNonZero?: boolean },
  ): (
    runner: ProcessRunner,
  ) => Effect.Effect<ProcessExit, ProcessStartError | ProcessIoError | ProcessExitError>;
} = dual(
  (args) =>
    args.length >= 2 && typeof args[0] === "object" && args[0] !== null && "shellEnv" in args[0],
  (
    runner: ProcessRunner,
    request: ProcessRequest,
    options?: { readonly failOnNonZero?: boolean },
  ) => runProcess(request, runner.shellEnv, options),
);

export const ProcessRunner = {
  make: (shellEnv: NodeJS.ProcessEnv): ProcessRunner => ({ shellEnv }),
  start,
  run,
};

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Data, Effect } from "effect";
import { ShellEnvironment } from "./shell-environment.js";

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

export class ProcessStartError extends Data.TaggedError("ProcessStartError")<{
  readonly request: ProcessRequest;
  readonly cause: unknown;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
}> {}

export class ProcessExitError extends Data.TaggedError("ProcessExitError")<{
  readonly exit: ProcessExit;
}> {}

export type ProcessRunnerError = ProcessStartError | ProcessExitError;

const sanitizeLogName = (value: string): string => value.replaceAll(/[^a-zA-Z0-9._-]/g, "-");

const makeLogPaths = async (request: ProcessRequest) => {
  const logDirectory = request.logDirectory ?? path.join(tmpdir(), "winnie-process-logs");
  await mkdir(logDirectory, { recursive: true });

  const label = sanitizeLogName(request.label ?? path.basename(request.command));
  const id = randomUUID();

  return {
    stderrLogPath: path.join(logDirectory, `${label}-${id}.stderr.log`),
    stdoutLogPath: path.join(logDirectory, `${label}-${id}.stdout.log`),
  };
};

const runProcess = (
  request: ProcessRequest,
  shellEnv: NodeJS.ProcessEnv,
  options?: { readonly failOnNonZero?: boolean },
) =>
  Effect.tryPromise({
    try: async () => {
      const logPaths = await makeLogPaths(request);
      const stdoutFile = createWriteStream(logPaths.stdoutLogPath, { flags: "w" });
      const stderrFile = createWriteStream(logPaths.stderrLogPath, { flags: "w" });

      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: { ...shellEnv, ...request.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.pipe(stdoutFile);
      child.stderr.pipe(stderrFile);

      if (request.stdin !== undefined) {
        child.stdin.end(request.stdin);
      } else {
        child.stdin.end();
      }

      return await new Promise<ProcessExit>((resolve, reject) => {
        child.on("error", (cause) => {
          reject(
            new ProcessStartError({
              request,
              cause,
              ...logPaths,
            }),
          );
        });

        child.on("close", (code, signal) => {
          stdoutFile.end();
          stderrFile.end();

          const exit: ProcessExit = {
            request,
            code,
            signal,
            ...logPaths,
          };

          if ((options?.failOnNonZero ?? true) && code !== 0) {
            reject(new ProcessExitError({ exit }));
            return;
          }

          resolve(exit);
        });
      });
    },
    catch: (cause) =>
      cause instanceof ProcessStartError || cause instanceof ProcessExitError
        ? cause
        : new ProcessStartError({
            request,
            cause,
            stderrLogPath: "",
            stdoutLogPath: "",
          }),
  });

export class ProcessRunner extends Effect.Service<ProcessRunner>()(
  "@winnie/orchestrator/ProcessRunner",
  {
    effect: Effect.gen(function* () {
      const shellEnvironment = yield* ShellEnvironment;
      const shellEnv = yield* shellEnvironment.get;

      return {
        run: (request: ProcessRequest, options?: { readonly failOnNonZero?: boolean }) =>
          runProcess(request, shellEnv, options),
      };
    }),
    dependencies: [ShellEnvironment.Default],
  },
) {}

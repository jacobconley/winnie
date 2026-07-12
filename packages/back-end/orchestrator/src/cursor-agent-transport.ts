import { Effect } from "effect";
import { type ProcessRequest, ProcessRunner } from "./process-runner.js";
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

export class CursorService extends Effect.Service<CursorService>()(
  "@winnie/orchestrator/CursorAgentTransport",
  {
    effect: Effect.gen(function* () {
      const processRunner = yield* ProcessRunner;
      const shellEnvironment = yield* ShellEnvironment;

      const createProcessRequest = (request: CursorAgentRunRequest) =>
        Effect.gen(function* () {
          const command = yield* shellEnvironment.resolveExecutable("cursor-agent");
          return makeProcessRequest({ command, request });
        });

      return {
        createProcessRequest,
        run: (request: CursorAgentRunRequest) =>
          Effect.gen(function* () {
            const processRequest = yield* createProcessRequest(request);
            return yield* processRunner.run(processRequest);
          }),
      };
    }),
    dependencies: [ProcessRunner.Default],
  },
) {}

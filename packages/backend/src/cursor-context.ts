import { spawn } from "node:child_process";
import { MessageError } from "@winnie/utils/message-error";
import { Context, Effect } from "effect";

export interface CursorContextOptions {
  readonly dataDirectory: string;
}

const getConfiguredShell = () => process.env.SHELL ?? "/bin/zsh";

const quoteShellWord = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const parseNullDelimitedEnv = (value: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};

  for (const entry of value.split("\0")) {
    if (entry.length === 0) continue;

    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) continue;

    env[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1);
  }

  return env;
};

const runLoginShell = (
  script: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ readonly stdout: string; readonly stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(getConfiguredShell(), ["-lc", script], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim();
      reject(
        new Error(
          detail.length > 0
            ? `Login shell exited with code ${code ?? "null"}: ${detail}`
            : `Login shell exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });

const discoverEnvironment = MessageError.TryPromise(
  async () => parseNullDelimitedEnv((await runLoginShell("env -0")).stdout),
  (error, builder) => builder.line("Failed to discover the user shell environment.").cause(error),
);

const resolveExecutableInEnv = (env: NodeJS.ProcessEnv, name: string) =>
  MessageError.TryPromise(
    async () => {
      const { stdout } = await runLoginShell(`command -v ${quoteShellWord(name)}`, env);
      const executable = stdout.trim();

      if (executable.length === 0) {
        throw new Error(`Could not find executable '${name}' in the user shell PATH.`);
      }

      return executable;
    },
    (error, builder) => builder.line(`Failed to resolve executable '${name}'.`).cause(error),
  );

/**
 * Process-level bootstrap: data root, login-shell env, executable lookup.
 * Chat thread paths live under AgentChatStorage (`threadsRoot`).
 */
export interface CursorContextService {
  readonly dataDirectory: string;
  readonly shellEnv: NodeJS.ProcessEnv;
  readonly resolveExecutable: (name: string) => Effect.Effect<string, MessageError>;
}

const makeCursorContext = (
  options: CursorContextOptions,
): Effect.Effect<CursorContextService, MessageError> =>
  Effect.gen(function* () {
    const shellEnv = yield* discoverEnvironment;

    return {
      dataDirectory: options.dataDirectory,
      shellEnv,
      resolveExecutable: (name: string) => resolveExecutableInEnv(shellEnv, name),
    };
  });

/**
 * Sole process-global Effect Tag. Construct with {@link CursorContext.make};
 * Layer wiring happens at the harness / app edge.
 */
export class CursorContext extends Context.Tag("@winnie/backend/CursorContext")<
  CursorContext,
  CursorContextService
>() {
  static make = makeCursorContext;
}

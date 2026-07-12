import { spawn } from "node:child_process";
import { MessageError } from "@winnie/utils/message-error";
import { Effect } from "effect";

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

const resolveExecutable = (env: NodeJS.ProcessEnv, name: string) =>
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

export class ShellEnvironment extends Effect.Service<ShellEnvironment>()(
  "@winnie/orchestrator/ShellEnvironment",
  {
    effect: Effect.gen(function* () {
      const env = yield* discoverEnvironment;

      return {
        get: Effect.succeed(env),
        resolveExecutable: (name: string) => resolveExecutable(env, name),
      };
    }),
  },
) {}

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeStream } from "@effect/platform-node";
import { TryEffect } from "@winnie/utils/try";
import { Data, Effect, Stream } from "effect";
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

export interface ProcessOutputChunk {
	readonly stream: "stdout" | "stderr";
	readonly chunk: Uint8Array;
}

export interface StartedProcess {
	readonly request: ProcessRequest;
	readonly stdoutLogPath: string;
	readonly stderrLogPath: string;
	readonly output: Stream.Stream<ProcessOutputChunk, ProcessRunnerError>;
	readonly exit: Effect.Effect<ProcessExit, ProcessRunnerError>;
	readonly kill: Effect.Effect<void, ProcessRunnerError>;
}

export class ProcessStartError extends Data.TaggedError("ProcessStartError")<{
	readonly request: ProcessRequest;
	readonly cause: unknown;
	readonly stdoutLogPath: string;
	readonly stderrLogPath: string;
	readonly callSite?: string;
}> {}

export class ProcessExitError extends Data.TaggedError("ProcessExitError")<{
	readonly exit: ProcessExit;
}> {}

export type ProcessRunnerError = ProcessStartError | ProcessExitError;

const sanitizeLogName = (value: string): string =>
	value.replaceAll(/[^a-zA-Z0-9._-]/g, "-");

const makeLogPaths = async (request: ProcessRequest) => {
	const logDirectory =
		request.logDirectory ?? path.join(tmpdir(), "winnie-process-logs");
	await mkdir(logDirectory, { recursive: true });

	const label = sanitizeLogName(
		request.label ?? path.basename(request.command),
	);
	const id = randomUUID();

	return {
		stderrLogPath: path.join(logDirectory, `${label}-${id}.stderr.log`),
		stdoutLogPath: path.join(logDirectory, `${label}-${id}.stdout.log`),
	};
};

const endFile = (file: WriteStream) =>
	Effect.async<void>((resume) => {
		file.end(() => resume(Effect.void));
	});

const writeToLogFile = (
	file: WriteStream,
	chunk: Uint8Array,
	request: ProcessRequest,
	logPaths: { readonly stdoutLogPath: string; readonly stderrLogPath: string },
) =>
	Effect.async<void, ProcessStartError>((resume) => {
		const ok = file.write(chunk, (cause) => {
			if (cause) {
				resume(
					Effect.fail(
						new ProcessStartError({
							request,
							cause,
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

const outputStreamFor = (
	child: ChildProcessWithoutNullStreams,
	streamName: "stdout" | "stderr",
	file: WriteStream,
	request: ProcessRequest,
	logPaths: { readonly stdoutLogPath: string; readonly stderrLogPath: string },
): Stream.Stream<ProcessOutputChunk, ProcessStartError> =>
	NodeStream.fromReadable(
		() => child[streamName],
		(cause) =>
			new ProcessStartError({
				request,
				cause,
				...logPaths,
			}),
	).pipe(
		Stream.map(
			(chunk): ProcessOutputChunk => ({
				stream: streamName,
				chunk,
			}),
		),
		Stream.tap((item) => writeToLogFile(file, item.chunk, request, logPaths)),
		Stream.ensuring(endFile(file)),
	);

const startProcess = (request: ProcessRequest, shellEnv: NodeJS.ProcessEnv) =>
	TryEffect.promise({
		try: async (): Promise<StartedProcess> => {
			const logPaths = await makeLogPaths(request);
			const stdoutFile = createWriteStream(logPaths.stdoutLogPath, {
				flags: "w",
			});
			const stderrFile = createWriteStream(logPaths.stderrLogPath, {
				flags: "w",
			});

			const child = spawn(request.command, [...request.args], {
				cwd: request.cwd,
				env: { ...shellEnv, ...request.env },
				stdio: ["pipe", "pipe", "pipe"],
			});

			if (request.stdin !== undefined) {
				child.stdin.end(request.stdin);
			} else {
				child.stdin.end();
			}

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

			const output = Stream.merge(
				outputStreamFor(child, "stdout", stdoutFile, request, logPaths),
				outputStreamFor(child, "stderr", stderrFile, request, logPaths),
			);

			const exit = TryEffect.promise({
				try: () => exitPromise,
				catch: (cause, { callSite }) =>
					cause instanceof ProcessStartError ||
					cause instanceof ProcessExitError
						? cause
						: new ProcessStartError({
								request,
								cause,
								...logPaths,
								...(callSite === undefined ? {} : { callSite }),
							}),
			});

			const kill = Effect.sync(() => {
				child.kill();
			});

			return {
				request,
				...logPaths,
				output,
				exit,
				kill,
			};
		},
		catch: (cause, { callSite }) =>
			cause instanceof ProcessStartError
				? cause
				: new ProcessStartError({
						request,
						cause,
						stderrLogPath: "",
						stdoutLogPath: "",
						...(callSite === undefined ? {} : { callSite }),
					}),
	});

const runProcess = (
	request: ProcessRequest,
	shellEnv: NodeJS.ProcessEnv,
	options?: { readonly failOnNonZero?: boolean },
) =>
	Effect.gen(function* () {
		const started = yield* startProcess(request, shellEnv);

		const [, exit] = yield* Effect.all(
			[Stream.runDrain(started.output), started.exit],
			{
				concurrency: 2,
			},
		);

		if ((options?.failOnNonZero ?? true) && exit.code !== 0) {
			return yield* Effect.fail(new ProcessExitError({ exit }));
		}

		return exit;
	});

export class ProcessRunner extends Effect.Service<ProcessRunner>()(
	"@winnie/orchestrator/ProcessRunner",
	{
		effect: Effect.gen(function* () {
			const shellEnvironment = yield* ShellEnvironment;
			const shellEnv = yield* shellEnvironment.get;

			return {
				start: (request: ProcessRequest) => startProcess(request, shellEnv),
				run: (
					request: ProcessRequest,
					options?: { readonly failOnNonZero?: boolean },
				) => runProcess(request, shellEnv, options),
			};
		}),
		dependencies: [ShellEnvironment.Default],
	},
) {}

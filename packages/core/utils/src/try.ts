import { Effect } from "effect";

export interface TryCallSite {
  readonly callSite: string | undefined;
}

/**
 * Shared catch / call-site options for {@link TryEffect.sync} and {@link TryEffect.promise}.
 */
export interface TryCatchOptions<E> {
  readonly catch: (error: unknown, context: TryCallSite) => E;
  /**
   * Which stack frame to report as the construction call site.
   *
   * Internally we snapshot `new Error().stack` as:
   * - `[0]` — `"Error"`
   * - `[1]` — the private capture helper
   * - `[2]` — the {@link TryEffect} helper (`Try.sync` / `Try.promise`)
   * - `[3]` — the direct caller of that helper
   * - `[4]` — the caller's caller, and so on
   *
   * `framesToSkip` is added to index `2`, so:
   * - `1` (default) → frame `[3]`, the direct caller of `Try.sync` / `Try.promise`
   * - `2` → frame `[4]`, for thin wrappers (for example `MessageError.Try`) that should
   *   attribute the failure to *their* caller instead of the wrapper line
   *
   * Custom wrappers should use `framesToSkip` rather than reimplementing capture.
   */
  readonly framesToSkip?: number;
}

const captureCallSite = (framesToSkip = 1): string | undefined => {
  const stack = new Error().stack;
  if (!stack) return undefined;
  return stack.split("\n")[2 + framesToSkip]?.trim();
};

/**
 * Call-site-aware replacements for `Effect.try` / `Effect.tryPromise`.
 *
 * Use these so failure handlers receive `{ callSite }` pointing at where the
 * Effect was *constructed*, not only where the underlying throw happened.
 */
export const TryEffect = {
  /**
   * Synchronous try/catch as an Effect, with a construction-time call site.
   *
   * @see TryCatchOptions.framesToSkip for how call-site frames are chosen
   */
  sync: <A, E>(
    options: {
      readonly try: () => A;
    } & TryCatchOptions<E>,
  ): Effect.Effect<A, E> => {
    const callSite = captureCallSite(options.framesToSkip ?? 1);
    return Effect.try({
      try: options.try,
      catch: (error) => options.catch(error, { callSite }),
    });
  },

  /**
   * Promise try/catch as an Effect, with a construction-time call site.
   *
   * @see TryCatchOptions.framesToSkip for how call-site frames are chosen
   */
  promise: <A, E>(
    options: {
      readonly try: () => PromiseLike<A>;
    } & TryCatchOptions<E>,
  ): Effect.Effect<A, E> => {
    const callSite = captureCallSite(options.framesToSkip ?? 1);
    return Effect.tryPromise({
      try: options.try,
      catch: (error) => options.catch(error, { callSite }),
    });
  },
} as const;

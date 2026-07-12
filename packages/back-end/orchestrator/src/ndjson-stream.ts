import { MessageError } from "@winnie/utils/message-error";
import { Stream } from "effect";

/**
 * NDJSON framing helpers for byte streams (e.g. subprocess stdout).
 */
export const NdjsonStream = {
  /**
   * Decode byte chunks to UTF-8 text and split into newline-delimited lines.
   * Carries a partial trailing line across chunks (via Effect's `Stream.splitLines`).
   */
  bytesToLines: <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E, R> =>
    bytes.pipe(Stream.decodeText(), Stream.splitLines),

  /**
   * Parse non-empty lines as JSON. Empty / whitespace-only lines are skipped.
   * Parse failures become {@link MessageError}.
   */
  linesToJson: <E, R>(
    lines: Stream.Stream<string, E, R>,
  ): Stream.Stream<unknown, E | MessageError, R> =>
    lines.pipe(
      Stream.filter((line) => line.trim().length > 0),
      Stream.mapEffect((line) =>
        MessageError.Try(
          () => JSON.parse(line) as unknown,
          (error, builder) =>
            builder.line("Failed to parse NDJSON line as JSON.").line(line).cause(error),
        ),
      ),
    ),

  /** Convenience: bytes → lines → JSON values. */
  bytesToJson: <E, R>(
    bytes: Stream.Stream<Uint8Array, E, R>,
  ): Stream.Stream<unknown, E | MessageError, R> =>
    NdjsonStream.linesToJson(NdjsonStream.bytesToLines(bytes)),
} as const;

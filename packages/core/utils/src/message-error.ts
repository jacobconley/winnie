import { Data, Effect } from "effect";
import { MessageBuilder } from "./message-builder.js";
import { TryEffect } from "./try.js";

type MessageFactory = string | ((builder: MessageBuilder) => MessageBuilder);

const renderMessage = (value: MessageFactory): string =>
  typeof value === "string" ? value : value(MessageBuilder.empty).toString();

/**
 * Boundary / user-facing error. Prefer domain TaggedErrors inside libraries;
 * convert to MessageError at CLI or UI edges.
 */
export class MessageError extends Data.TaggedError("MessageError")<{
  /**
   * If `null`, there will be no exit message.
   * Use {@link MessageError.Empty} for intentional quiet termination.
   */
  readonly message: string | null;
}> {
  static Empty = () => new MessageError({ message: null });
  static FailEmpty = () => Effect.fail(MessageError.Empty());

  static Build = (value: MessageFactory) => new MessageError({ message: renderMessage(value) });

  static FailWith = (value: MessageFactory) => Effect.fail(MessageError.Build(value));

  static FromCause = (cause: unknown, label?: string) => {
    if (cause instanceof MessageError && cause.message === null) {
      return cause;
    }

    let builder = MessageBuilder.empty;
    if (label !== undefined) {
      builder = builder.line(label);
    }
    builder = builder.cause(cause);
    return new MessageError({ message: builder.toString() });
  };

  static Try = <A>(
    fn: () => A,
    catcher?: (error: unknown, builder: MessageBuilder) => MessageBuilder | string,
  ): Effect.Effect<A, MessageError> =>
    TryEffect.sync({
      try: fn,
      // Skip MessageError.Try so callSite points at the external caller.
      framesToSkip: 2,
      catch: (error, { callSite }) => {
        if (catcher) {
          return MessageError.Build((builder) => {
            const result = catcher(error, builder);
            return typeof result === "string" ? builder.line(result) : result;
          });
        }

        let builder = MessageBuilder.empty;
        if (callSite !== undefined) {
          builder = builder.line(callSite);
        }
        return new MessageError({
          message: builder.cause(error, { stack: true }).toString(),
        });
      },
    });

  static TryPromise = <A>(
    fn: () => PromiseLike<A>,
    catcher?: (error: unknown, builder: MessageBuilder) => MessageBuilder | string,
  ): Effect.Effect<A, MessageError> =>
    TryEffect.promise({
      try: fn,
      // Skip MessageError.TryPromise so callSite points at the external caller.
      framesToSkip: 2,
      catch: (error, { callSite }) => {
        if (catcher) {
          return MessageError.Build((builder) => {
            const result = catcher(error, builder);
            return typeof result === "string" ? builder.line(result) : result;
          });
        }

        let builder = MessageBuilder.empty;
        if (callSite !== undefined) {
          builder = builder.line(callSite);
        }
        return new MessageError({
          message: builder.cause(error, { stack: true }).toString(),
        });
      },
    });

  render(): string {
    return this.message ?? "";
  }
}

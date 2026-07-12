/**
 * Cursor `stream-json` event schemas and helpers.
 *
 * Schemas live next to the wire format they validate. Decode at the boundary with
 * {@link CursorAgentEvent.decode} and keep fields tolerant — Cursor may add
 * properties over time (`onExcessProperty: "ignore"`).
 *
 * @see https://cursor.com/docs/cli/reference/output-format
 */
import { MessageError } from "@winnie/utils/message-error";
import { Effect, Schema } from "effect";

const parseOptions = { onExcessProperty: "ignore" as const };

const TextContentBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

const MessageContent = Schema.Array(
  Schema.Union(
    TextContentBlock,
    Schema.Struct({
      type: Schema.String,
    }),
  ),
);

const System = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  apiKeySource: Schema.optional(Schema.String),
  permissionMode: Schema.optional(Schema.String),
});

const User = Schema.Struct({
  type: Schema.Literal("user"),
  message: Schema.Struct({
    role: Schema.Literal("user"),
    content: MessageContent,
  }),
  session_id: Schema.optional(Schema.String),
});

const Assistant = Schema.Struct({
  type: Schema.Literal("assistant"),
  message: Schema.Struct({
    role: Schema.Literal("assistant"),
    content: MessageContent,
  }),
  session_id: Schema.optional(Schema.String),
  timestamp_ms: Schema.optional(Schema.Number),
  model_call_id: Schema.optional(Schema.String),
});

const ToolCall = Schema.Struct({
  type: Schema.Literal("tool_call"),
  subtype: Schema.optional(Schema.String),
  call_id: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  model_call_id: Schema.optional(Schema.String),
  timestamp_ms: Schema.optional(Schema.Number),
  /** Tool-specific payloads vary widely; keep loose for now. */
  tool_call: Schema.optional(Schema.Unknown),
});

const Result = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
  session_id: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
  duration_ms: Schema.optional(Schema.Number),
  duration_api_ms: Schema.optional(Schema.Number),
  request_id: Schema.optional(Schema.String),
});

/** Unknown / future event kinds — keep `type` and do not fail the stream. */
const Unknown = Schema.Struct({
  type: Schema.String,
});

const Any = Schema.Union(System, User, Assistant, ToolCall, Result, Unknown);

const decodeAny = Schema.decodeUnknown(Any, parseOptions);

type AnyEvent = Schema.Schema.Type<typeof Any>;
type SystemEvent = Schema.Schema.Type<typeof System>;
type UserEvent = Schema.Schema.Type<typeof User>;
type AssistantEvent = Schema.Schema.Type<typeof Assistant>;
type ToolCallEvent = Schema.Schema.Type<typeof ToolCall>;
type ResultEvent = Schema.Schema.Type<typeof Result>;
type UnknownEvent = Schema.Schema.Type<typeof Unknown>;

/**
 * Cursor agent `stream-json` wire events.
 */
export const CursorAgentEvent = {
  System,
  User,
  Assistant,
  ToolCall,
  Result,
  Unknown,
  Schema: Any,

  decode: (value: unknown): Effect.Effect<AnyEvent, MessageError> =>
    decodeAny(value).pipe(
      Effect.mapError((error) =>
        MessageError.Build((builder) =>
          builder.line("Failed to decode cursor-agent stream-json event.").cause(error),
        ),
      ),
    ),

  /** Concatenated text from an assistant event's content blocks. */
  text: (event: AssistantEvent): string =>
    event.message.content
      .flatMap((block) => (block.type === "text" && "text" in block ? [block.text] : []))
      .join(""),

  /**
   * Whether this event is a *live* text delta under `--stream-partial-output`.
   *
   * Cursor emits several `assistant` shapes for the same turn:
   * - streaming delta: has `timestamp_ms`, no `model_call_id` → use these for UI
   * - buffered flush before a tool call: has `model_call_id` → skip (duplicate)
   * - buffered flush at end of turn: no `timestamp_ms` → skip (duplicate)
   *
   * For the canonical final answer, prefer the `result` event instead.
   */
  isStreamingDelta: (event: AnyEvent): event is AssistantEvent =>
    Schema.is(Assistant)(event) &&
    event.timestamp_ms !== undefined &&
    event.model_call_id === undefined,
} as const;

export type CursorAgentEvent = AnyEvent;

export namespace CursorAgentEvent {
  export type System = SystemEvent;
  export type User = UserEvent;
  export type Assistant = AssistantEvent;
  export type ToolCall = ToolCallEvent;
  export type Result = ResultEvent;
  export type Unknown = UnknownEvent;
}

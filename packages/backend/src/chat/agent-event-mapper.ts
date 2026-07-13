import type { AgentEvent } from "@winnie/contracts/agent-events";
import { CursorAgentEvent } from "@winnie/contracts/cursor-agent-events";
import type { RunId, ThreadId } from "@winnie/contracts/ids";

export interface AgentEventMapperContext {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly timestamp?: string;
}

const nowIso = (timestamp?: string) => timestamp ?? new Date().toISOString();

/**
 * Map a Cursor wire event into zero or more Winnie {@link AgentEvent}s.
 * Streaming text deltas become `assistant.textDelta`; other wire events are
 * ignored here (session id / lifecycle are handled by AgentChatThread).
 */
export const mapCursorAgentEvent = (
  event: CursorAgentEvent,
  context: AgentEventMapperContext,
): readonly AgentEvent[] => {
  if (!CursorAgentEvent.isStreamingDelta(event)) {
    return [];
  }

  const delta = CursorAgentEvent.text(event);
  if (delta.length === 0) {
    return [];
  }

  return [
    {
      type: "assistant.textDelta",
      runId: context.runId,
      threadId: context.threadId,
      delta,
      timestamp: nowIso(context.timestamp),
    },
  ];
};

export const cursorSessionIdFromEvent = (event: CursorAgentEvent): string | undefined => {
  if (
    (event.type === "system" || event.type === "result" || event.type === "assistant") &&
    "session_id" in event &&
    typeof event.session_id === "string" &&
    event.session_id.length > 0
  ) {
    return event.session_id;
  }
  return undefined;
};

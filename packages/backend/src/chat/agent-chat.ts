import { randomUUID } from "node:crypto";
import type { ThreadId } from "@winnie/contracts/ids";
import { ThreadId as ThreadIdNs } from "@winnie/contracts/ids";
import type { Thread } from "@winnie/contracts/thread";
import type { MessageError } from "@winnie/utils/message-error";
import { Effect } from "effect";
import { dual } from "effect/Function";
import type { CursorService } from "../cursor-agent/cursor-agent-transport.js";
import type { AgentChatStorage } from "./agent-chat-storage.js";
import { AgentChatStorage as Storage } from "./agent-chat-storage.js";
import type { AgentChatThread } from "./agent-chat-thread.js";
import { AgentChatThread as AgentChatThreadNs } from "./agent-chat-thread.js";

export interface CreateThreadRequest {
  readonly workspacePath: string;
}

/**
 * Process-scoped chat handle: storage + cursor transport.
 */
export interface AgentChat {
  readonly storage: AgentChatStorage;
  readonly cursor: CursorService;
}

const freshThreadId = () => ThreadIdNs.make(randomUUID());
const isoNow = () => new Date().toISOString();

const makeAgentChat = (input: {
  readonly dataDirectory: string;
  readonly cursor: CursorService;
}): AgentChat => ({
  storage: Storage.make(input.dataDirectory),
  cursor: input.cursor,
});

const createThread: {
  (chat: AgentChat, request: CreateThreadRequest): Effect.Effect<AgentChatThread, MessageError>;
  (request: CreateThreadRequest): (chat: AgentChat) => Effect.Effect<AgentChatThread, MessageError>;
} = dual(2, (chat: AgentChat, request: CreateThreadRequest) =>
  Effect.gen(function* () {
    const timestamp = isoNow();
    const thread: Thread = {
      id: freshThreadId(),
      workspacePath: request.workspacePath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    yield* Storage.saveThread(chat.storage, thread);
    return yield* AgentChatThreadNs.make(chat, thread.id);
  }),
);

const openThread: {
  (chat: AgentChat, threadId: ThreadId): Effect.Effect<AgentChatThread, MessageError>;
  (threadId: ThreadId): (chat: AgentChat) => Effect.Effect<AgentChatThread, MessageError>;
} = dual(2, (chat: AgentChat, threadId: ThreadId) =>
  Effect.gen(function* () {
    yield* Storage.loadThread(chat.storage, threadId);
    return yield* AgentChatThreadNs.make(chat, threadId);
  }),
);

const listThreads = (chat: AgentChat): Effect.Effect<readonly Thread[], MessageError> =>
  Storage.listThreads(chat.storage);

export const AgentChat = {
  make: makeAgentChat,
  createThread,
  openThread,
  listThreads,
};

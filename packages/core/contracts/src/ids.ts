import { Brand } from "@winnie/utils/brand";

export type ThreadId = Brand<string, "ThreadId">;
export type RunId = Brand<string, "RunId">;
export type TaskId = Brand<string, "TaskId">;

export const ThreadId = {
  make: (value: string): ThreadId => Brand.make("ThreadId")(value),
} as const;

export const RunId = {
  make: (value: string): RunId => Brand.make("RunId")(value),
} as const;

export const TaskId = {
  make: (value: string): TaskId => Brand.make("TaskId")(value),
} as const;

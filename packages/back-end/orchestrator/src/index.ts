import type { Task } from "@winnie/contracts";

export interface Orchestrator {
  listTasks(): readonly Task[];
}

export const createInMemoryOrchestrator = (): Orchestrator => {
  const tasks: Task[] = [];

  return {
    listTasks: () => [...tasks],
  };
};

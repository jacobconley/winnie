import { createInMemoryOrchestrator } from "@winnie/orchestrator";
import * as vscode from "vscode";

export const activate = (context: vscode.ExtensionContext): void => {
  const orchestrator = createInMemoryOrchestrator();

  const showStatus = vscode.commands.registerCommand("winnie.showStatus", async () => {
    const taskCount = orchestrator.listTasks().length;
    await vscode.window.showInformationMessage(`Winnie is ready. Tracking ${taskCount} tasks.`);
  });

  context.subscriptions.push(showStatus);
};

export const deactivate = (): void => {};

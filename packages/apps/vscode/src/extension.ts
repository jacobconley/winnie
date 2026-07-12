import * as vscode from "vscode";

export const activate = (context: vscode.ExtensionContext): void => {
  const showStatus = vscode.commands.registerCommand("winnie.showStatus", async () => {
    await vscode.window.showInformationMessage("Winnie is ready.");
  });

  context.subscriptions.push(showStatus);
};

export const deactivate = (): void => {};

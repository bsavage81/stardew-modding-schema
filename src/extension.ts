import * as vscode from "vscode";
import { setupSchemaLanguageService } from "./schemaService";
import { registerUbDiagnostics } from "./ubDiagnostics";
import { registerUbThemesSupport } from "./ubThemes";

export function activate(context: vscode.ExtensionContext): void {
  console.log("Stardew Modding Extension is now active!");

  setupSchemaLanguageService(context);
  registerUbDiagnostics(context);
  registerUbThemesSupport(context);

  // Optional: keep your i18n watcher if you still want it
  const i18nFileWatcher = vscode.workspace.createFileSystemWatcher("**/i18n/*.json");
  i18nFileWatcher.onDidChange((uri) => {
    vscode.window.showInformationMessage(`Translation file changed: ${uri.fsPath}`);
  });
  i18nFileWatcher.onDidCreate((uri) => {
    vscode.window.showInformationMessage(`Translation file created: ${uri.fsPath}`);
  });
  i18nFileWatcher.onDidDelete((uri) => {
    vscode.window.showInformationMessage(`Translation file deleted: ${uri.fsPath}`);
  });
  context.subscriptions.push(i18nFileWatcher);
}

export function deactivate(): void {
  // nothing special to clean up beyond registered disposables
}

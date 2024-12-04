import * as vscode from 'vscode';
import { JSONSchema } from 'vscode-json-languageservice';

const contentPatcherSchema: JSONSchema = {
    $schema: "https://smapi.io/schemas/content-patcher.json"
};

const smapiManifestSchema: JSONSchema = {
    $schema: "https://smapi.io/schemas/manifest.json"
};

const i18nSchema: JSONSchema = {
    $schema: "https://smapi.io/schemas/i18n.json"
};

export function activate(context: vscode.ExtensionContext) {
    console.log('Stardew Valley Modding Extension is now active!');

    // Register file watchers for content.json and manifest.json
    const stardewFileSelector = ['**/content.json', '**/manifest.json'];
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
        `{${stardewFileSelector.join(',')}}`
    );

    fileWatcher.onDidChange((uri) => {
        vscode.window.showInformationMessage(`File changed: ${uri.fsPath}`);
    });

    fileWatcher.onDidCreate((uri) => {
        vscode.window.showInformationMessage(`File created: ${uri.fsPath}`);
    });

    fileWatcher.onDidDelete((uri) => {
        vscode.window.showInformationMessage(`File deleted: ${uri.fsPath}`);
    });

    context.subscriptions.push(fileWatcher);

    // Register a file watcher for translation files in the i18n folder
    const i18nFileWatcher = vscode.workspace.createFileSystemWatcher('**/i18n/*.json');

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

export function deactivate() {}

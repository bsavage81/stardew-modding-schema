import * as vscode from 'vscode';
import { JSONSchema } from 'vscode-json-languageservice';

const contentPatcherSchema: JSONSchema = {
    $schema: "https://smapi.io/schemas/content-patcher.json"
};

const smapiManifestSchema: JSONSchema = {
    $schema: "https://smapi.io/schemas/manifest.json"
};


export function activate(context: vscode.ExtensionContext) {
    console.log('Stardew Valley Modding Extension is now active!');

    // Register a file-specific action
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
}

export function deactivate() {}

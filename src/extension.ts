import * as vscode from 'vscode';

let cachedBundleThemes: string[] | null = null;
let bundleThemesPromise: Promise<string[]> | null = null;
let ubDiagnostics: vscode.DiagnosticCollection;

/**
 * Invalidate the in-memory cache of BundleThemes so we rescan sources.
 */
function invalidateBundleThemesCache(): void {
    cachedBundleThemes = null;
    bundleThemesPromise = null;
}

/**
 * Scan the workspace and optional external UB ShopTypes.json
 * to collect all known BundleThemes / ShopTypes:
 *  - content.json EditData -> UnlockableBundles/BundleThemes
 *  - any *BundleThemes*.json in the workspace
 *  - ShopTypes.json from the configured UB install path
 */
async function getBundleThemes(): Promise<string[]> {
    if (cachedBundleThemes) {
        return cachedBundleThemes;
    }
    if (bundleThemesPromise) {
        return bundleThemesPromise;
    }

    bundleThemesPromise = (async () => {
        const themes = new Set<string>();

        // 1) content.json (EditData -> UnlockableBundles/BundleThemes)
        const contentFiles = await vscode.workspace.findFiles('**/content.json');

        for (const file of contentFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();

                const json = JSON.parse(text) as any;
                const changes = json?.Changes;
                if (!Array.isArray(changes)) {
                    continue;
                }

                for (const change of changes) {
                    if (
                        change &&
                        change.Action === 'EditData' &&
                        change.Target === 'UnlockableBundles/BundleThemes' &&
                        change.Entries &&
                        typeof change.Entries === 'object'
                    ) {
                        for (const key of Object.keys(change.Entries)) {
                            themes.add(key);
                        }
                    }
                }
            } catch {
                // Ignore parse or IO errors
                continue;
            }
        }

        // 2) Any *BundleThemes*.json in the workspace
        const bundleThemesFiles = await vscode.workspace.findFiles('**/*BundleThemes*.json');

        for (const file of bundleThemesFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                const json = JSON.parse(text) as any;

                // Either { "Entries": { ... } } or { "ThemeKey": { ... } }
                if (json && typeof json === 'object') {
                    if (json.Entries && typeof json.Entries === 'object') {
                        for (const key of Object.keys(json.Entries)) {
                            themes.add(key);
                        }
                    } else {
                        for (const key of Object.keys(json)) {
                            themes.add(key);
                        }
                    }
                }
            } catch {
                continue;
            }
        }

        // 3) ShopTypes.json from the UB mod install (configured path)
        const config = vscode.workspace.getConfiguration('stardewModdingSchema');
        const shopTypesPath = config.get<string>('unlockableBundles.shopTypesPath')?.trim();

        if (shopTypesPath) {
            try {
                const uri = vscode.Uri.file(shopTypesPath);
                const data = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(data).toString('utf8');
                const json = JSON.parse(text) as any;

                // Assume top-level keys are theme IDs
                if (json && typeof json === 'object') {
                    for (const key of Object.keys(json)) {
                        themes.add(key);
                    }
                }
            } catch {
                // Ignore bad path; diagnostics will warn
            }
        }

        cachedBundleThemes = Array.from(themes).sort();
        bundleThemesPromise = null;
        return cachedBundleThemes;
    })();

    return bundleThemesPromise;
}

/**
 * Detect whether a given document is one we care about for UB warnings:
 *  - content.json
 *  - any JSON under a /data/ folder (data/**.json)
 */
function isUbRelevantDocument(doc: vscode.TextDocument): boolean {
    if (doc.languageId !== 'json') {
        return false;
    }

    const fileName = doc.fileName.toLowerCase();
    const isContentJson = fileName.endsWith('content.json');
    const isDataJson = /[\\/](data)[\\/].+\.json$/i.test(fileName);

    return isContentJson || isDataJson;
}

/**
 * Check the given document for Unlockable Bundles usage and warn
 * if ShopTypes.json is not configured or not accessible.
 */
async function updateUbDiagnostics(doc: vscode.TextDocument): Promise<void> {
    if (!isUbRelevantDocument(doc)) {
        ubDiagnostics.delete(doc.uri);
        return;
    }

    const text = doc.getText();

    const hasUbMarkers =
        text.includes('UnlockableBundles/') ||
        text.includes('DLX.Bundles') ||
        text.includes('"ShopType"') ||
        text.includes('"SpecialPlacementRequirements"');

    if (!hasUbMarkers) {
        ubDiagnostics.delete(doc.uri);
        return;
    }

    const config = vscode.workspace.getConfiguration('stardewModdingSchema');
    const shopTypesPath = config.get<string>('unlockableBundles.shopTypesPath')?.trim();

    let hasValidShopTypes = false;

    if (shopTypesPath) {
        try {
            const uri = vscode.Uri.file(shopTypesPath);
            await vscode.workspace.fs.stat(uri);
            hasValidShopTypes = true;
        } catch {
            hasValidShopTypes = false;
        }
    }

    if (hasValidShopTypes) {
        ubDiagnostics.delete(doc.uri);
        return;
    }

    const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        'Unlockable Bundles usage detected, but the ShopTypes.json path is not configured or not accessible. Set "stardewModdingSchema.unlockableBundles.shopTypesPath" in settings so ShopType completions and validation are accurate.',
        vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'Stardew Modding Schema';

    ubDiagnostics.set(doc.uri, [diagnostic]);
}

export function activate(context: vscode.ExtensionContext): void {
    console.log('Stardew Valley Modding Extension is now active!');

    // Diagnostics for UB-related warnings
    ubDiagnostics = vscode.languages.createDiagnosticCollection('stardew-ub');
    context.subscriptions.push(ubDiagnostics);

    // Run diagnostics for already-open documents
    vscode.workspace.textDocuments.forEach((doc: vscode.TextDocument) => {
        void updateUbDiagnostics(doc);
    });

    // Update diagnostics when documents are opened/changed/closed
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc: vscode.TextDocument) => {
            void updateUbDiagnostics(doc);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            void updateUbDiagnostics(e.document);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc: vscode.TextDocument) => {
            ubDiagnostics.delete(doc.uri);
        })
    );

    // React to configuration changes (ShopTypes.json path)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            if (e.affectsConfiguration('stardewModdingSchema.unlockableBundles.shopTypesPath')) {
                vscode.workspace.textDocuments.forEach((doc: vscode.TextDocument) => {
                    void updateUbDiagnostics(doc);
                });
                invalidateBundleThemesCache();
            }
        })
    );

    // File watchers for content.json + manifest.json
    const stardewFileSelector = ['**/content.json', '**/manifest.json'];
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
        `{${stardewFileSelector.join(',')}}`
    );

    fileWatcher.onDidChange((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`File changed: ${uri.fsPath}`);
        if (uri.fsPath.toLowerCase().endsWith('content.json')) {
            invalidateBundleThemesCache();
        }
    });

    fileWatcher.onDidCreate((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`File created: ${uri.fsPath}`);
        if (uri.fsPath.toLowerCase().endsWith('content.json')) {
            invalidateBundleThemesCache();
        }
    });

    fileWatcher.onDidDelete((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`File deleted: ${uri.fsPath}`);
        if (uri.fsPath.toLowerCase().endsWith('content.json')) {
            invalidateBundleThemesCache();
        }
    });

    context.subscriptions.push(fileWatcher);

    // i18n watcher
    const i18nFileWatcher = vscode.workspace.createFileSystemWatcher('**/i18n/*.json');

    i18nFileWatcher.onDidChange((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`Translation file changed: ${uri.fsPath}`);
    });

    i18nFileWatcher.onDidCreate((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`Translation file created: ${uri.fsPath}`);
    });

    i18nFileWatcher.onDidDelete((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`Translation file deleted: ${uri.fsPath}`);
    });

    context.subscriptions.push(i18nFileWatcher);

    // BundleThemes watcher
    const bundleThemesFileWatcher =
        vscode.workspace.createFileSystemWatcher('**/*BundleThemes*.json');

    bundleThemesFileWatcher.onDidChange((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`BundleThemes file changed: ${uri.fsPath}`);
        invalidateBundleThemesCache();
    });

    bundleThemesFileWatcher.onDidCreate((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`BundleThemes file created: ${uri.fsPath}`);
        invalidateBundleThemesCache();
    });

    bundleThemesFileWatcher.onDidDelete((uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`BundleThemes file deleted: ${uri.fsPath}`);
        invalidateBundleThemesCache();
    });

    context.subscriptions.push(bundleThemesFileWatcher);

    // Completion provider for ShopType
    const builtInShopTypes = ['Dialogue', 'SpeechBubble', 'ParrotPerch', 'CCBundle'];

    const shopTypeCompletionProvider = vscode.languages.registerCompletionItemProvider(
        { language: 'json', pattern: '**/content.json' },
        {
            async provideCompletionItems(
                document: vscode.TextDocument,
                position: vscode.Position,
                _token: vscode.CancellationToken,
                _context: vscode.CompletionContext
            ): Promise<vscode.CompletionItem[] | undefined> {
                const line = document.lineAt(position.line).text;

                if (!line.includes('"ShopType"')) {
                    return;
                }

                const colonIndex = line.indexOf(':');
                if (colonIndex === -1 || position.character <= colonIndex) {
                    return;
                }

                const items: vscode.CompletionItem[] = [];

                // Built-in types
                for (const type of builtInShopTypes) {
                    const item = new vscode.CompletionItem(
                        type,
                        vscode.CompletionItemKind.EnumMember
                    );
                    item.detail = 'Unlockable Bundles ShopType (built-in)';
                    item.insertText = type;
                    items.push(item);
                }

                // Themes from workspace + ShopTypes.json
                const themes = await getBundleThemes();
                for (const theme of themes) {
                    if (builtInShopTypes.includes(theme)) {
                        continue;
                    }
                    const item = new vscode.CompletionItem(
                        theme,
                        vscode.CompletionItemKind.EnumMember
                    );
                    item.detail = 'Unlockable Bundles ShopType (BundleTheme)';
                    item.insertText = theme;
                    items.push(item);
                }

                return items;
            }
        },
        '"' // trigger char
    );

    context.subscriptions.push(shopTypeCompletionProvider);
}

export function deactivate(): void {
    // nothing to clean up manually beyond disposables
}

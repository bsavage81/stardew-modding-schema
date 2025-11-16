import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

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

        // ─────────────────────────────────────
        // 1) content.json (EditData -> UnlockableBundles/BundleThemes)
        //    Use jsonc so comments/trailing commas don't break us.
        // ─────────────────────────────────────
        const contentFiles = await vscode.workspace.findFiles('**/content.json');

        for (const file of contentFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();

                const errors: jsonc.ParseError[] = [];
                const json = jsonc.parse(text, errors, { allowTrailingComma: true }) as any;

                // Even if there are minor parse errors, try to use what we got
                if (!json || typeof json !== 'object') {
                    continue;
                }

                const changes = json.Changes;
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

        // ─────────────────────────────────────
        // 2) Any *BundleThemes*.json in the workspace
        //    Also parsed with jsonc for comments/trailing comma support.
        // ─────────────────────────────────────
        const bundleThemesFiles = await vscode.workspace.findFiles('**/*BundleThemes*.json');

        for (const file of bundleThemesFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();

                const errors: jsonc.ParseError[] = [];
                const json = jsonc.parse(text, errors, { allowTrailingComma: true }) as any;

                if (!json || typeof json !== 'object') {
                    continue;
                }

                // Two likely shapes:
                // 1) { "ThemeKey": { ... }, "OtherTheme": { ... } }
                // 2) { "Entries": { "ThemeKey": { ... }, ... } }
                if (json.Entries && typeof json.Entries === 'object') {
                    for (const key of Object.keys(json.Entries)) {
                        themes.add(key);
                    }
                } else {
                    for (const key of Object.keys(json)) {
                        themes.add(key);
                    }
                }
            } catch {
                continue;
            }
        }

        // ─────────────────────────────────────
        // 3) ShopTypes.json from the UB mod install (configured path)
        //    Parsed with jsonc so comments / trailing commas are fine.
        // ─────────────────────────────────────
        const config = vscode.workspace.getConfiguration('stardewModdingSchema');
        const shopTypesPath = config.get<string>('unlockableBundles.shopTypesPath')?.trim();

        if (shopTypesPath) {
            try {
                const uri = vscode.Uri.file(shopTypesPath);
                const data = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(data).toString('utf8');

                const errors: jsonc.ParseError[] = [];
                const json = jsonc.parse(text, errors, { allowTrailingComma: true }) as any;

                if (json && typeof json === 'object') {
                    for (const key of Object.keys(json)) {
                        themes.add(key);
                    }
                }
            } catch {
                // If the path is wrong or file is unreadable, just ignore it here.
                // The diagnostics logic will handle warning the user.
            }
        }

        cachedBundleThemes = Array.from(themes).sort();
        bundleThemesPromise = null;

        console.log(
            `[Stardew Modding Schema] Loaded ${cachedBundleThemes.length} bundle themes / shop types for completion.`
        );

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
    if (doc.languageId !== 'json' && doc.languageId !== 'jsonc') {
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
    console.log('Stardew Modding Extension is now active!');

    ubDiagnostics = vscode.languages.createDiagnosticCollection('stardew-ub');
    context.subscriptions.push(ubDiagnostics);

    vscode.workspace.textDocuments.forEach((doc: vscode.TextDocument) => {
        void updateUbDiagnostics(doc);
    });

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
        vscode.window.showInformationMessage(`Bundl
            eThemes file deleted: ${uri.fsPath}`);
        invalidateBundleThemesCache();
    });

    context.subscriptions.push(bundleThemesFileWatcher);

    // ─────────────────────────────────────────────
    // Completion provider for ShopType
    // ─────────────────────────────────────────────

    const builtInShopTypes = ['Dialogue', 'SpeechBubble', 'ParrotPerch', 'CCBundle'];

    const shopTypeCompletionProvider = vscode.languages.registerCompletionItemProvider(
        [
            { language: 'json', pattern: '**/content.json' },
            { language: 'jsonc', pattern: '**/content.json' }
        ],
        {
            async provideCompletionItems(
                document: vscode.TextDocument,
                position: vscode.Position
            ): Promise<vscode.CompletionItem[] | undefined> {
                const line = document.lineAt(position.line).text;

                // Only on "ShopType" lines
                if (!line.includes('"ShopType"')) {
                    return;
                }

                const colonIndex = line.indexOf(':');
                if (colonIndex === -1 || position.character <= colonIndex) {
                    return;
                }

                // Figure out the range we want to replace:
                // from just after the opening quote up to and including the closing quote.
                let replaceRange: vscode.Range | undefined;
                let addComma = true;

                const firstQuote = line.indexOf('"', colonIndex);
                if (firstQuote !== -1) {
                    const secondQuote = line.indexOf('"', firstQuote + 1);
                    if (secondQuote !== -1) {
                        // Check if there's already a comma right after the closing quote
                        const after = line[secondQuote + 1];
                        if (after === ',') {
                            addComma = false;
                        }

                        const startPos = new vscode.Position(position.line, firstQuote + 1);
                        const endPos = new vscode.Position(position.line, secondQuote + 1); // include closing quote
                        replaceRange = new vscode.Range(startPos, endPos);
                    }
                }

                const items: vscode.CompletionItem[] = [];

                const makeItem = (label: string, detail: string): vscode.CompletionItem => {
                    const item = new vscode.CompletionItem(
                        label,
                        vscode.CompletionItemKind.EnumMember
                    );
                    item.detail = detail;

                    if (replaceRange) {
                        // Use a snippet so we can move the cursor after the quote (and optional comma)
                        const snippetText = addComma ? `${label}",$0` : `${label}"$0`;
                        item.range = replaceRange;
                        item.insertText = new vscode.SnippetString(snippetText);
                    } else {
                        // Fallback: just insert plain text at cursor
                        item.insertText = label;
                    }

                    return item;
                };

                // Built-in ShopType values
                for (const type of builtInShopTypes) {
                    items.push(
                        makeItem(type, 'Unlockable Bundles ShopType (built-in)')
                    );
                }

                // Themes from workspace + ShopTypes.json
                const themes = await getBundleThemes();
                for (const theme of themes) {
                    if (builtInShopTypes.includes(theme)) {
                        continue;
                    }
                    items.push(
                        makeItem(
                            theme,
                            'Unlockable Bundles ShopType (BundleTheme / ShopTypes.json)'
                        )
                    );
                }

                return items;
            }
        },
        '"' // trigger when typing quote for the value
    );

    context.subscriptions.push(shopTypeCompletionProvider);
}

export function deactivate(): void {
    // nothing special to clean up beyond registered disposables
}

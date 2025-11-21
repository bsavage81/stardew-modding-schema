import * as vscode from "vscode";
import * as jsonc from "jsonc-parser";

let cachedBundleThemes: string[] | null = null;
let bundleThemesPromise: Promise<string[]> | null = null;

export function invalidateBundleThemesCache(): void {
  cachedBundleThemes = null;
  bundleThemesPromise = null;
}

/**
 * Scan workspace + optional ShopTypes.json to collect BundleThemes/ShopTypes.
 */
export async function getBundleThemes(): Promise<string[]> {
  if (cachedBundleThemes) return cachedBundleThemes;
  if (bundleThemesPromise) return bundleThemesPromise;

  bundleThemesPromise = (async () => {
    const themes = new Set<string>();

    // 1) content.json EditData -> UnlockableBundles/BundleThemes
    const contentFiles = await vscode.workspace.findFiles("**/content.json");
    for (const file of contentFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        const errors: jsonc.ParseError[] = [];
        const json = jsonc.parse(text, errors, { allowTrailingComma: true }) as any;
        if (!json || typeof json !== "object") continue;
        const changes = json.Changes;
        if (!Array.isArray(changes)) continue;

        for (const change of changes) {
          if (
            change &&
            change.Action === "EditData" &&
            change.Target === "UnlockableBundles/BundleThemes" &&
            change.Entries &&
            typeof change.Entries === "object"
          ) {
            for (const key of Object.keys(change.Entries)) {
              themes.add(key);
            }
          }
        }
      } catch {
        continue;
      }
    }

    // 2) any *BundleThemes*.json
    const bundleThemesFiles = await vscode.workspace.findFiles("**/*BundleThemes*.json");
    for (const file of bundleThemesFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        const errors: jsonc.ParseError[] = [];
        const json = jsonc.parse(text, errors, { allowTrailingComma: true }) as any;
        if (!json || typeof json !== "object") continue;

        if (json.Entries && typeof json.Entries === "object") {
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

    // 3) ShopTypes.json from configuration
    const config = vscode.workspace.getConfiguration("stardewModdingSchema");
    const shopTypesPath = config.get<string>("unlockableBundles.shopTypesPath")?.trim();

    if (shopTypesPath) {
      try {
        const uri = vscode.Uri.file(shopTypesPath);
        const data = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(data).toString("utf8");
        const errors: jsonc.ParseError[] = [];
        const json = jsonc.parse(text, errors, { allowTrailingComma: true }) as any;
        if (json && typeof json === "object") {
          for (const key of Object.keys(json)) {
            themes.add(key);
          }
        }
      } catch {
        // ignore; diagnostics will warn user
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
 * Register ShopType completion provider + file watchers that invalidate the theme cache.
 */
export function registerUbThemesSupport(context: vscode.ExtensionContext): void {
  const builtInShopTypes = ["Dialogue", "SpeechBubble", "ParrotPerch", "CCBundle"];

  const provider = vscode.languages.registerCompletionItemProvider(
    [
      { language: "json", pattern: "**/content.json" },
      { language: "jsonc", pattern: "**/content.json" }
    ],
    {
      async provideCompletionItems(document, position) {
        const line = document.lineAt(position.line).text;

        if (!line.includes('"ShopType"')) return;

        const colonIndex = line.indexOf(":");
        if (colonIndex === -1 || position.character <= colonIndex) return;

        let replaceRange: vscode.Range | undefined;
        let addComma = true;

        const firstQuote = line.indexOf('"', colonIndex);
        if (firstQuote !== -1) {
          const secondQuote = line.indexOf('"', firstQuote + 1);
          if (secondQuote !== -1) {
            const after = line[secondQuote + 1];
            if (after === ",") {
              addComma = false;
            }

            const startPos = new vscode.Position(position.line, firstQuote + 1);
            const endPos = new vscode.Position(position.line, secondQuote + 1);
            replaceRange = new vscode.Range(startPos, endPos);
          }
        }

        const makeItem = (label: string, detail: string): vscode.CompletionItem => {
          const item = new vscode.CompletionItem(
            label,
            vscode.CompletionItemKind.EnumMember
          );
          item.detail = detail;

          if (replaceRange) {
            const snippetText = addComma ? `${label}",$0` : `${label}"$0`;
            item.range = replaceRange;
            item.insertText = new vscode.SnippetString(snippetText);
          } else {
            item.insertText = label;
          }

          return item;
        };

        const items: vscode.CompletionItem[] = [];

        for (const type of builtInShopTypes) {
          items.push(makeItem(type, "Unlockable Bundles ShopType (built-in)"));
        }

        const themes = await getBundleThemes();
        for (const theme of themes) {
          if (builtInShopTypes.includes(theme)) continue;
          items.push(
            makeItem(theme, "Unlockable Bundles ShopType (BundleTheme / ShopTypes.json)")
          );
        }

        return items;
      }
    },
    '"' // trigger on quote
  );

  context.subscriptions.push(provider);

  // Watch content.json and *BundleThemes*.json to invalidate cache
  const contentWatcher = vscode.workspace.createFileSystemWatcher("**/content.json");
  contentWatcher.onDidChange(() => invalidateBundleThemesCache());
  contentWatcher.onDidCreate(() => invalidateBundleThemesCache());
  contentWatcher.onDidDelete(() => invalidateBundleThemesCache());
  context.subscriptions.push(contentWatcher);

  const themesWatcher = vscode.workspace.createFileSystemWatcher("**/*BundleThemes*.json");
  themesWatcher.onDidChange(() => invalidateBundleThemesCache());
  themesWatcher.onDidCreate(() => invalidateBundleThemesCache());
  themesWatcher.onDidDelete(() => invalidateBundleThemesCache());
  context.subscriptions.push(themesWatcher);
}

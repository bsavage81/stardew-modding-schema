import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as jsonc from "jsonc-parser";

let cachedBundleThemes: string[] | null = null;
let bundleThemesPromise: Promise<string[]> | null = null;

function invalidateBundleThemesCache(): void {
  cachedBundleThemes = null;
  bundleThemesPromise = null;
}

/**
 * Resolve the expected ShopTypes.json path:
 *   <modsRoot>\Unlockable Bundles\assets\Data\ShopTypes.json
 */
function resolveUbShopTypesPath(): string | null {
  const config = vscode.workspace.getConfiguration("stardewModdingSchema");
  const modsRootRaw = config.get<string>("modsRoot") ?? "";
  const modsRoot = modsRootRaw.trim();

  if (!modsRoot) {
    return null;
  }

  return path.join(
    modsRoot,
    "Unlockable Bundles",
    "assets",
    "Data",
    "ShopTypes.json"
  );
}

/**
 * Collect all known UB BundleThemes / ShopTypes from:
 *  1) CP patches targeting UnlockableBundles/BundleThemes
 *     (in content.json and nested data/Data JSON files)
 *  2) *BundleThemes*.json files in the workspace
 *  3) ShopTypes.json at <modsRoot>\Unlockable Bundles\assets\Data\ShopTypes.json
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

    // 1) CP patches (UnlockableBundles/BundleThemes via EditData)
    //    in content.json/.jsonc and nested data/Data JSON files
    const contentJson = await vscode.workspace.findFiles("**/content.json");
    const contentJsonc = await vscode.workspace.findFiles("**/content.jsonc");
    const dataJson = await vscode.workspace.findFiles(
      "**/{data,Data}/**/*.json"
    );
    const dataJsonc = await vscode.workspace.findFiles(
      "**/{data,Data}/**/*.jsonc"
    );

    const ubPatchFiles = [
      ...contentJson,
      ...contentJsonc,
      ...dataJson,
      ...dataJsonc,
    ];

    for (const file of ubPatchFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();

        const errors: jsonc.ParseError[] = [];
        const json = jsonc.parse(text, errors, {
          allowTrailingComma: true,
        }) as any;
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

    // 2) Any *BundleThemes*.json in the workspace
    const bundleThemesFiles = await vscode.workspace.findFiles(
      "**/*BundleThemes*.json"
    );
    for (const file of bundleThemesFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();

        const errors: jsonc.ParseError[] = [];
        const json = jsonc.parse(text, errors, {
          allowTrailingComma: true,
        }) as any;
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

    // 3) ShopTypes.json from modsRoot\Unlockable Bundles\assets\Data\ShopTypes.json
    const shopTypesPath = resolveUbShopTypesPath();
    if (shopTypesPath && fs.existsSync(shopTypesPath)) {
      try {
        const data = fs.readFileSync(shopTypesPath, "utf8");
        const errors: jsonc.ParseError[] = [];
        const json = jsonc.parse(data, errors, {
          allowTrailingComma: true,
        }) as any;
        if (json && typeof json === "object") {
          for (const key of Object.keys(json)) {
            themes.add(key);
          }
        }
      } catch {
        // ignore; UB diagnostics will warn if needed
      }
    }

    cachedBundleThemes = Array.from(themes).sort();
    bundleThemesPromise = null;

    console.log(
      `[Stardew Modding Schema] Loaded ${cachedBundleThemes.length} bundle themes / ShopTypes for completion.`
    );

    return cachedBundleThemes;
  })();

  return bundleThemesPromise;
}

export function registerUbThemesSupport(
  context: vscode.ExtensionContext
): void {
  const builtInShopTypes = [
    "Dialogue",
    "SpeechBubble",
    "ParrotPerch",
    "CCBundle",
  ];

  // Apply completion to CP content.json and any data/Data JSON (e.g. UB Bundles assets)
  const selector: vscode.DocumentSelector = [
    { pattern: "**/*.json" },
    { pattern: "!**/manifest.json" },
  ];

  const provider = vscode.languages.registerCompletionItemProvider(
    selector,
    {
      async provideCompletionItems(document, position) {
        const line = document.lineAt(position.line).text;

        // Only handle lines with "ShopType"
        if (!line.includes('"ShopType"')) {
          return;
        }

        const colonIndex = line.indexOf(":");
        if (colonIndex === -1 || position.character <= colonIndex) {
          return;
        }

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

        const items: vscode.CompletionItem[] = [];
        const makeItem = (
          label: string,
          detail: string
        ): vscode.CompletionItem => {
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

        // Built-in ShopTypes
        for (const type of builtInShopTypes) {
          items.push(makeItem(type, "Unlockable Bundles ShopType (built-in)"));
        }

        // Themes from content + BundleThemes + ShopTypes.json
        const themes = await getBundleThemes();
        for (const theme of themes) {
          if (builtInShopTypes.includes(theme)) continue;

          items.push(
            makeItem(
              theme,
              "Unlockable Bundles ShopType (BundleTheme / ShopTypes.json)"
            )
          );
        }

        return items;
      },
    },
    '"' // trigger on quote
  );

  context.subscriptions.push(provider);

  // Invalidate cache when modsRoot changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("stardewModdingSchema.modsRoot")) {
        invalidateBundleThemesCache();
      }
    })
  );

  // Invalidate cache when BundleThemes JSON files change
  const bundleThemesFileWatcher = vscode.workspace.createFileSystemWatcher(
    "**/*BundleThemes*.json"
  );

  bundleThemesFileWatcher.onDidChange(() => invalidateBundleThemesCache());
  bundleThemesFileWatcher.onDidCreate(() => invalidateBundleThemesCache());
  bundleThemesFileWatcher.onDidDelete(() => invalidateBundleThemesCache());

  context.subscriptions.push(bundleThemesFileWatcher);
}

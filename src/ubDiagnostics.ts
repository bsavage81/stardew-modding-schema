import * as vscode from "vscode";
import * as path from "path";

let ubDiagnostics: vscode.DiagnosticCollection;

/**
 * Only care about:
 *  - content.json
 *  - any JSON under a /data/ folder
 */
function isUbRelevantDocument(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== "json" && doc.languageId !== "jsonc") {
    return false;
  }

  const fileName = doc.fileName.toLowerCase();
  const isContentJson = fileName.endsWith("content.json");
  const isDataJson = /[\\/](data)[\\/].+\.json$/i.test(doc.fileName);

  return isContentJson || isDataJson;
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
 * Check a document for Unlockable Bundles usage and warn if:
 *  - modsRoot is not configured, or
 *  - ShopTypes.json is missing at the required path.
 */
async function updateUbDiagnostics(doc: vscode.TextDocument): Promise<void> {
  if (!isUbRelevantDocument(doc)) {
    ubDiagnostics.delete(doc.uri);
    return;
  }

  const text = doc.getText();

  const hasUbMarkers =
    text.includes("UnlockableBundles/") ||
    text.includes("DLX.Bundles") ||
    text.includes('"ShopType"') ||
    text.includes('"SpecialPlacementRequirements"');

  if (!hasUbMarkers) {
    ubDiagnostics.delete(doc.uri);
    return;
  }

  const config = vscode.workspace.getConfiguration("stardewModdingSchema");
  const modsRootRaw = config.get<string>("modsRoot") ?? "";
  const modsRoot = modsRootRaw.trim();

  // If modsRoot isn't set, emit a clear diagnostic about that.
  if (!modsRoot) {
    const message =
      'Unlockable Bundles usage detected, but "stardewModdingSchema.modsRoot" is not configured. ' +
      'Set your Stardew Mods folder so ShopTypes.json can be found at "<modsRoot>\\Unlockable Bundles\\assets\\Data\\ShopTypes.json".';

    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      message,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = "Stardew Modding Schema";

    ubDiagnostics.set(doc.uri, [diagnostic]);
    return;
  }

  const shopTypesPath = resolveUbShopTypesPath();
  let hasValidShopTypes = false;

  if (shopTypesPath) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(shopTypesPath));
      hasValidShopTypes = true;
    } catch {
      hasValidShopTypes = false;
    }
  }

  if (hasValidShopTypes) {
    ubDiagnostics.delete(doc.uri);
    return;
  }

  const message = `Unlockable Bundles usage detected, but ShopTypes.json was not found at the required path:\n${shopTypesPath}`;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(0, 0, 0, 1),
    message,
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = "Stardew Modding Schema";

  ubDiagnostics.set(doc.uri, [diagnostic]);
}

export function registerUbDiagnostics(context: vscode.ExtensionContext): void {
  ubDiagnostics = vscode.languages.createDiagnosticCollection("stardew-ub");
  context.subscriptions.push(ubDiagnostics);

  // Initial pass on already-open docs
  vscode.workspace.textDocuments.forEach((doc) => {
    void updateUbDiagnostics(doc);
  });

  // React to document lifecycle
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      void updateUbDiagnostics(doc);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      void updateUbDiagnostics(e.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      ubDiagnostics.delete(doc.uri);
    })
  );

  // Re-run diagnostics if modsRoot changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("stardewModdingSchema.modsRoot")) {
        vscode.workspace.textDocuments.forEach((doc) => {
          void updateUbDiagnostics(doc);
        });
      }
    })
  );
}

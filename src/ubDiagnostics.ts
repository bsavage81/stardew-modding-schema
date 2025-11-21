import * as vscode from "vscode";
import { invalidateBundleThemesCache } from "./ubThemes";

let ubDiagnostics: vscode.DiagnosticCollection;

function isUbRelevantDocument(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== "json" && doc.languageId !== "jsonc") {
    return false;
  }

  const fileName = doc.fileName.toLowerCase();
  const isContentJson = fileName.endsWith("content.json");
  const isDataJson = /[\\/](data)[\\/].+\.json$/i.test(fileName);

  return isContentJson || isDataJson;
}

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
  const shopTypesPath = config.get<string>("unlockableBundles.shopTypesPath")?.trim();

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

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      void updateUbDiagnostics(doc);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      void updateUbDiagnostics(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      ubDiagnostics.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("stardewModdingSchema.unlockableBundles.shopTypesPath")) {
        // ShopTypes path changed – refresh diagnostics and invalidate UB themes cache.
        vscode.workspace.textDocuments.forEach((doc) => {
          void updateUbDiagnostics(doc);
        });
        invalidateBundleThemesCache();
      }
    })
  );
}

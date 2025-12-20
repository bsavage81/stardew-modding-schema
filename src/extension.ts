// src/extension.ts
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { registerUbDiagnostics } from "./ubDiagnostics";
import { registerUbThemesSupport } from "./ubThemes";
import { registerStardewIntelliSense } from "./stardewIntelliSense";
import { rebuildInstalledItemIndex } from "./installedIndex";

// Support multiple watchers if we end up watching multiple roots later
let modsWatchers: vscode.FileSystemWatcher[] = [];

// Unique ID so we can find/remove our own json.schemas entry
const SCHEMA_ASSOC_ID = "stardewModdingSchema.modsRootSchema";

// Debounce rebuilds triggered by watcher/config changes
let autoRebuildTimer: NodeJS.Timeout | undefined;
let autoRebuildQueuedReason: string | undefined;

// tweak if you want it more/less aggressive
const AUTO_REBUILD_DEBOUNCE_MS = 2000;

function dirExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function getDefaultGameRootsWindows(): string[] {
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const systemDrive = process.env["SystemDrive"] || "C:";

  return [
    // Steam
    path.join(pf86, "Steam", "steamapps", "common", "Stardew Valley"),

    // GOG Galaxy default
    path.join(pf86, "GOG Galaxy", "Games", "Stardew Valley"),

    // GOG common alternate
    path.join(systemDrive, "GOG Games", "Stardew Valley"),

    // Xbox app (as provided)
    path.join(systemDrive, "XboxGames", "Stardew Valley"),
  ];
}

/**
 * Returns candidate Mods roots in priority order.
 * Prefer Stardrop Installed Mods if present.
 */
function getDefaultModsRoots(): string[] {
  if (process.platform !== "win32") return [];

  const roots: string[] = [];
  const gameRoots = getDefaultGameRootsWindows();

  // Prefer Stardrop folder first
  for (const gameRoot of gameRoots) {
    roots.push(path.join(gameRoot, "Mods", "Stardrop Installed Mods"));
  }
  // Then plain Mods
  for (const gameRoot of gameRoots) {
    roots.push(path.join(gameRoot, "Mods"));
  }

  // Keep only those that exist, de-dupe
  const seen = new Set<string>();
  const existing: string[] = [];
  for (const r of roots) {
    const norm = path.normalize(r);
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (dirExists(norm)) existing.push(norm);
  }

  return existing;
}

/**
 * If modsRoot isn't set, try to auto-detect and set it.
 * This keeps the rest of the extension (installedIndex, watcher, schema association) working unchanged.
 */
async function ensureModsRootConfigured(): Promise<string> {
  const stardewConfig = vscode.workspace.getConfiguration("stardewModdingSchema");
  const currentRaw = stardewConfig.get<string>("modsRoot") ?? "";
  const current = currentRaw.trim();

  if (current) return current;

  const defaults = getDefaultModsRoots();
  if (defaults.length === 0) {
    console.log(
      "[Stardew Modding Schema] modsRoot not set and no default Mods folder found."
    );
    return "";
  }

  const detected = defaults[0];

  try {
    await stardewConfig.update(
      "modsRoot",
      detected,
      vscode.ConfigurationTarget.Global
    );

    console.log(
      `[Stardew Modding Schema] modsRoot was not set; auto-detected and saved: ${detected}`
    );
  } catch (err) {
    console.log(
      `[Stardew Modding Schema] Failed to save auto-detected modsRoot; using for this session only: ${detected}`
    );
    console.log(err);
  }

  return detected;
}

async function updateJsonSchemaAssociations(
  context: vscode.ExtensionContext,
  modsRootOverride?: string
): Promise<void> {
  const stardewConfig = vscode.workspace.getConfiguration("stardewModdingSchema");
  const modsRootRaw =
    modsRootOverride ?? (stardewConfig.get<string>("modsRoot") ?? "");
  const modsRoot = modsRootRaw.trim();

  const jsonConfig = vscode.workspace.getConfiguration("json");
  const current = (jsonConfig.get<any[]>("schemas") ?? []).slice();

  // Remove any previous entry we added
  const filtered = current.filter((s) => !s || s.schemaId !== SCHEMA_ASSOC_ID);

  if (!modsRoot) {
    if (filtered.length !== current.length) {
      await jsonConfig.update(
        "schemas",
        filtered,
        vscode.ConfigurationTarget.Workspace
      );
      console.log(
        "[Stardew Modding Schema] modsRoot not set; removed JSON schema association."
      );
    } else {
      console.log(
        "[Stardew Modding Schema] modsRoot not set; no JSON schema association to remove."
      );
    }
    return;
  }

  const modsFolderName = path.basename(modsRoot);
  if (!modsFolderName) {
    console.log(
      "[Stardew Modding Schema] Could not determine folder name from modsRoot; skipping JSON schema association."
    );
    return;
  }

  const schemaUri = vscode.Uri.file(
    context.asAbsolutePath("schemas/stardew-content.schema.json")
  ).toString();

  const newEntry = {
    fileMatch: [`**/${modsFolderName}/**/*.json`],
    url: schemaUri,
    schemaId: SCHEMA_ASSOC_ID,
  };

  filtered.push(newEntry);

  await jsonConfig.update(
    "schemas",
    filtered,
    vscode.ConfigurationTarget.Workspace
  );

  console.log(
    `[Stardew Modding Schema] JSON schema associated with **/${modsFolderName}/**/*.json → ${schemaUri}`
  );
}

function disposeModsWatchers(): void {
  for (const w of modsWatchers) w.dispose();
  modsWatchers = [];
}

function scheduleAutoRebuild(
  context: vscode.ExtensionContext,
  reason: string,
  delayMs = AUTO_REBUILD_DEBOUNCE_MS
): void {
  autoRebuildQueuedReason = reason;

  if (autoRebuildTimer) {
    clearTimeout(autoRebuildTimer);
  }

  autoRebuildTimer = setTimeout(() => {
    const why = autoRebuildQueuedReason ?? "unknown";
    autoRebuildQueuedReason = undefined;
    autoRebuildTimer = undefined;

    console.log(`[Stardew Modding Schema] Auto rebuild triggered (debounced): ${why}`);
    void rebuildInstalledItemIndex(context, { auto: true });
  }, delayMs);
}

function setupModsWatcher(
  context: vscode.ExtensionContext,
  modsRootOverride?: string
): void {
  const config = vscode.workspace.getConfiguration("stardewModdingSchema");
  const modsRootRaw = modsRootOverride ?? (config.get<string>("modsRoot") ?? "");
  const modsRoot = modsRootRaw.trim();

  disposeModsWatchers();

  if (!modsRoot) {
    console.log(
      "[Stardew Modding Schema] modsRoot not set; skipping mods watcher."
    );
    return;
  }

  // Keep the original broad watcher:
  const pattern = new vscode.RelativePattern(modsRoot, "**/*.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const onChange = (uri: vscode.Uri) => {
    scheduleAutoRebuild(context, `mods watcher: ${uri.fsPath}`);
  };

  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  watcher.onDidDelete(onChange);

  context.subscriptions.push(watcher);
  modsWatchers.push(watcher);

  console.log(`[Stardew Modding Schema] Watching modsRoot: ${modsRoot} (**/*.json, debounced)`);
}

export function activate(context: vscode.ExtensionContext): void {
  console.log("Stardew Modding Schema is now active!");

  registerUbDiagnostics(context);
  registerUbThemesSupport(context);

  registerStardewIntelliSense(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stardewModdingSchema.rebuildInstalledItemIndex",
      () => {
        void rebuildInstalledItemIndex(context, { auto: false });
      }
    )
  );

  void (async () => {
    const effectiveModsRoot = await ensureModsRootConfigured();

    setupModsWatcher(context, effectiveModsRoot);
    void updateJsonSchemaAssociations(context, effectiveModsRoot);

    // Debounced startup rebuild
    scheduleAutoRebuild(context, "startup", 250);
  })();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("stardewModdingSchema.modsRoot")) {
        setupModsWatcher(context);
        void updateJsonSchemaAssociations(context);
        scheduleAutoRebuild(context, "modsRoot setting changed", 250);
      }
    })
  );

  const i18nFileWatcher = vscode.workspace.createFileSystemWatcher(
    "**/i18n/*.json"
  );

  const logI18nChange = (prefix: string, uri: vscode.Uri) => {
    console.log(`[Stardew Modding Schema] ${prefix} ${uri.fsPath}`);
  };

  i18nFileWatcher.onDidChange((uri) =>
    logI18nChange("Translation file changed:", uri)
  );
  i18nFileWatcher.onDidCreate((uri) =>
    logI18nChange("Translation file created:", uri)
  );
  i18nFileWatcher.onDidDelete((uri) =>
    logI18nChange("Translation file deleted:", uri)
  );

  context.subscriptions.push(i18nFileWatcher);
}

export function deactivate(): void {
  disposeModsWatchers();
  if (autoRebuildTimer) {
    clearTimeout(autoRebuildTimer);
    autoRebuildTimer = undefined;
  }
}

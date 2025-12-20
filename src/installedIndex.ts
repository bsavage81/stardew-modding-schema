// src/installedIndex.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parse, ParseError } from "jsonc-parser";

export interface RebuildIndexOptions {
  auto?: boolean;
}

interface InstalledItemInfo {
  modId: string; // manifest.UniqueID
  modName: string; // manifest.Name
  name: string; // item display name
}

type KnownModsMap = Map<string, string>; // UniqueID -> Name

// -----------------------------------------------------------------------------
// FIX: Single-flight rebuild + auto coalescing
// - Prevents multiple rebuilds running at once
// - Coalesces spammy auto rebuild triggers into at most 1 extra run
// -----------------------------------------------------------------------------
// Also adds START/END markers with a run id so we can confirm whether we're
// actually rebuilding repeatedly, or just logging a lot during one run.
// -----------------------------------------------------------------------------
let rebuildInFlight: Promise<void> | null = null;
let pendingAutoRebuild = false;

let rebuildRunId = 0;

// Optional: throttle auto rebuilds so file watcher storms don't cause a loop of
// "finish rebuild -> immediately start another".
let lastAutoRebuildAt = 0;
const AUTO_REBUILD_MIN_MS = 10_000; // 10s

// -----------------------------------------------------------------------------
// Debug logging control (Installed Indexer)
// Enable with env var:
//   STARDEW_SCHEMA_DEBUG_INSTALLED_INDEX=1
// -----------------------------------------------------------------------------
function installedIndexDebugEnabled(): boolean {
  return process.env.STARDEW_SCHEMA_DEBUG_INSTALLED_INDEX === "1";
}

function dbg(msg: string): void {
  if (installedIndexDebugEnabled()) {
    console.log(msg);
  }
}

async function runRebuildGuarded(
  context: vscode.ExtensionContext,
  auto: boolean,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
  if (rebuildInFlight) {
    if (auto) {
      pendingAutoRebuild = true;
      return;
    }

    try {
      await rebuildInFlight;
    } catch {
      // ignore; proceed
    }
  }

  const myRunId = ++rebuildRunId;
  const started = Date.now();

  console.log(
    `[Stardew Modding Schema] Installed index rebuild START (#${myRunId}, auto=${auto})`
  );

  const task = (async () => {
    try {
      await doRebuildInstalledItemIndex(context, auto, progress);
    } catch (err) {
      console.error(
        `[Stardew Modding Schema] Installed index rebuild FAILED (#${myRunId}).`
      );
      console.error(err);
    }
  })();

  rebuildInFlight = task;

  try {
    await task;
  } finally {
    rebuildInFlight = null;

    const ms = Date.now() - started;
    console.log(
      `[Stardew Modding Schema] Installed index rebuild END (#${myRunId}) in ${ms}ms`
    );
  }

  if (auto && pendingAutoRebuild) {
    pendingAutoRebuild = false;
    await runRebuildGuarded(context, true);
  }
}

/**
 * Utility: expand CP-style DynamicTokens like {{ID}}, {{ASSETS}}, etc.
 * - Skips special tokens 'i18n' and 'modid' (they are handled elsewhere).
 * - Case-insensitive on token names (CP behavior).
 */
function expandDynamicTokens(
  input: string,
  dynamicTokens?: Map<string, string>
): string {
  if (!dynamicTokens || dynamicTokens.size === 0) return input;

  return input.replace(/\{\{\s*([^}:]+?)\s*}}/g, (match, tokenName) => {
    const lower = tokenName.trim().toLowerCase();
    if (lower === "i18n" || lower === "modid") {
      return match; // leave for i18n / ModId handling
    }
    const val = dynamicTokens.get(lower);
    return typeof val === "string" ? val : match;
  });
}

/**
 * True if a string still contains *any* CP-style {{Token}} placeholder.
 * Used to defer Include FromFile existence checks when tokens can't be resolved yet.
 */
function hasAnyCpToken(s: string): boolean {
  return /\{\{[^}]+\}\}/.test(s);
}

function isObjectRecord(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readJsoncFile(fullPath: string): any | null {
  try {
    const text = fs.readFileSync(fullPath, "utf8");
    const errors: ParseError[] = [];
    const json = parse(text, errors, { allowTrailingComma: true }) as any;
    if (!json || typeof json !== "object") return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Expand simple {{Token}} replacements repeatedly to support nested cases like:
 *   "{{i18n: item.{{Color}}Dye.name}}"
 *
 * This ONLY expands tokens present in tokenMap (case-insensitive),
 * while still skipping i18n/modid placeholders (handled elsewhere).
 */
function expandTokensDeep(
  input: string,
  tokenMap?: Map<string, string>,
  maxPasses = 10
): string {
  if (!tokenMap || tokenMap.size === 0) return input;

  let value = input;

  for (let pass = 0; pass < maxPasses; pass++) {
    const next = value.replace(/\{\{\s*([^}:]+?)\s*}}/g, (match, tokenName) => {
      const lower = tokenName.trim().toLowerCase();
      if (lower === "i18n" || lower === "modid") {
        return match;
      }
      const val = tokenMap.get(lower);
      return typeof val === "string" ? val : match;
    });

    if (next === value) return value;
    value = next;
  }

  return value;
}

function expandTokensInAny(value: any, tokenMap?: Map<string, string>): any {
  if (!tokenMap || tokenMap.size === 0) return value;

  if (typeof value === "string") {
    return expandTokensDeep(value, tokenMap);
  }

  if (Array.isArray(value)) {
    return value.map((v) => expandTokensInAny(v, tokenMap));
  }

  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      const newKey = typeof k === "string" ? expandTokensDeep(k, tokenMap) : k;
      out[newKey] = expandTokensInAny(v, tokenMap);
    }
    return out;
  }

  return value;
}

/**
 * Try to make a Stardew [LocalizedText ...] key readable.
 *
 * Examples:
 *  "[LocalizedText Strings\\Objects:IceOrbRing_Name]" -> "Ice Orb Ring"
 *  "[LocalizedText Strings\\BigCraftables:Keg_Name]"  -> "Keg"
 */
function friendlyFromLocalizedTextKey(rawKey: string): string {
  if (!rawKey) return rawKey;

  const key = rawKey.replace(/^"+|"+$/g, "").trim();

  const colonIdx = key.lastIndexOf(":");
  let tail = colonIdx >= 0 ? key.slice(colonIdx + 1) : key;

  tail = tail.trim();

  tail = tail.replace(/_(DisplayName|Name|title|Title|label|Label)$/i, "");
  tail = tail.replace(/\.?(DisplayName|Name)$/i, "");

  tail = tail.replace(/_/g, " ");
  tail = tail.replace(/([a-z0-9])([A-Z])/g, "$1 $2");

  tail = tail.replace(/\s+/g, " ").trim();

  return tail || rawKey;
}

/**
 * Replace any occurrences of:
 *   [LocalizedText ...]
 * within a string with a friendlier version.
 */
function resolveLocalizedTextInString(input: string): string {
  if (typeof input !== "string" || !input) return input;

  return input.replace(
    /\[\s*LocalizedText\s+([^\]]+?)\s*]/gi,
    (_m, innerKey) => {
      const friendly = friendlyFromLocalizedTextKey(String(innerKey ?? ""));
      return friendly || _m;
    }
  );
}

/**
 * Resolve Content Patcher i18n tokens anywhere in a string:
 *   "{{i18n:Some.Key}}"
 *
 * Supports multiple tokens in one string.
 * Supports simple nesting by running multiple passes, but ONLY resolves
 * i18n tokens whose inner key does not contain braces on that pass.
 */
function resolveI18nTokensInString(
  input: string,
  modI18n: Map<string, string>,
  maxPasses = 10
): string {
  if (typeof input !== "string" || !input) return input;
  if (!modI18n || modI18n.size === 0) return input;

  let value = input;

  const re = /\{\{\s*i18n\s*:\s*([^{}]+?)\s*}}/gi;

  for (let pass = 0; pass < maxPasses; pass++) {
    const next = value.replace(re, (_m, rawKey) => {
      const key = String(rawKey ?? "").trim();
      if (!key) return _m;

      const translated = modI18n.get(key);
      if (translated && translated.trim()) return translated.trim();

      return key;
    });

    if (next === value) break;
    value = next;
  }

  return value;
}

/**
 * Apply all "make it readable" transforms for names:
 * - Expand DynamicTokens
 * - Expand {{modid}}
 * - Resolve CP i18n tokens anywhere in the string
 * - Resolve [LocalizedText ...] tokens to friendlier text
 */
function makeNameReadable(
  input: string,
  modI18n: Map<string, string>,
  modId: string,
  dynamicTokens?: Map<string, string>
): string {
  let s = input ?? "";
  if (typeof s !== "string") s = String(s);

  s = expandDynamicTokens(s, dynamicTokens);
  s = s.replace(/\{\{\s*modid\s*\}\}/gi, modId);

  s = resolveI18nTokensInString(s, modI18n);
  s = resolveLocalizedTextInString(s);

  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Loads all vanilla + custom qualified IDs from:
 *  - data/stardew-ids.json(c)
 *  - data/custom-ids.json(c)
 *
 * These should NOT be treated as mod-added IDs.
 */
function loadBaseQualifiedIds(context: vscode.ExtensionContext): Set<string> {
  const base = new Set<string>();
  const dataDir = context.asAbsolutePath("data");

  function load(file: string) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) return;
    try {
      const text = fs.readFileSync(full, "utf8");
      const errors: ParseError[] = [];
      const json = parse(text, errors, { allowTrailingComma: true }) as any;
      if (!json || typeof json !== "object") return;

      const categoryTypes = json.categoryTypes;
      if (!categoryTypes) return;

      for (const category of Object.keys(categoryTypes)) {
        const arr = (json as any)[category];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && item.qualifiedId) {
              base.add(String(item.qualifiedId).trim());
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  load("stardew-ids.jsonc");
  load("stardew-ids.json");
  load("custom-ids.jsonc");
  load("custom-ids.json");

  console.log(
    `[Stardew Modding Schema] Loaded ${base.size} base qualified IDs.`
  );
  return base;
}

/**
 * Load i18n key→value map for a directory that has i18n/*.json / i18n/*.jsonc.
 *
 * Supports both:
 *  - i18n/default.json, i18n/en.json, etc.
 *  - i18n/default/default.json, i18n/default/handbook.json, i18n/en/en.json, ...
 *
 * We ONLY load locales:
 *  - default
 *  - en
 *  - en-*
 */
function loadModI18n(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  const i18nRoot = path.join(dir, "i18n");

  if (!fs.existsSync(i18nRoot) || !fs.statSync(i18nRoot).isDirectory()) {
    return map;
  }

  const isDefaultOrEnglishName = (name: string): boolean => {
    const lower = name.toLowerCase().replace(/\.jsonc?$/, "");
    if (lower === "default") return true;
    if (lower === "en") return true;
    if (lower.startsWith("en-")) return true;
    return false;
  };

  const loadI18nFile = (fullPath: string) => {
    try {
      const text = fs.readFileSync(fullPath, "utf8");
      const errors: ParseError[] = [];
      const json = parse(text, errors, { allowTrailingComma: true }) as any;
      if (!json || typeof json !== "object") return;

      for (const key of Object.keys(json)) {
        const val = json[key];
        if (typeof val === "string") {
          map.set(key, val);
        }
      }
    } catch {
      // ignore
    }
  };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(i18nRoot, { withFileTypes: true });
  } catch {
    return map;
  }

  // Case 1: files directly under i18n/
  for (const entry of entries) {
    if (entry.isFile()) {
      const name = entry.name;
      if (
        (name.toLowerCase().endsWith(".json") ||
          name.toLowerCase().endsWith(".jsonc")) &&
        isDefaultOrEnglishName(name)
      ) {
        loadI18nFile(path.join(i18nRoot, name));
      }
    }
  }

  // Case 2: locale subfolders
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const localeName = entry.name;
    if (!isDefaultOrEnglishName(localeName)) continue;

    const localeDir = path.join(i18nRoot, localeName);
    let localeEntries: fs.Dirent[];
    try {
      localeEntries = fs.readdirSync(localeDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEntry of localeEntries) {
      if (!fileEntry.isFile()) continue;
      const fname = fileEntry.name.toLowerCase();
      if (!fname.endsWith(".json") && !fname.endsWith(".jsonc")) continue;

      loadI18nFile(path.join(localeDir, fileEntry.name));
    }
  }

  return map;
}

/**
 * Load mod-level DynamicTokens from the root content.json of a CP mod.
 * These are applied to *all* JSON files in the mod.
 */
function loadModDynamicTokens(modDir: string): Map<string, string> {
  const map = new Map<string, string>();
  const contentPath = path.join(modDir, "content.json");

  if (!fs.existsSync(contentPath)) {
    return map;
  }

  try {
    const text = fs.readFileSync(contentPath, "utf8");
    const errors: ParseError[] = [];
    const json = parse(text, errors, { allowTrailingComma: true }) as any;
    if (!json || typeof json !== "object") return map;

    if (Array.isArray(json.DynamicTokens)) {
      for (const tokenDef of json.DynamicTokens) {
        if (
          tokenDef &&
          typeof tokenDef === "object" &&
          typeof tokenDef.Name === "string"
        ) {
          const nameLower = tokenDef.Name.trim().toLowerCase();
          const val = tokenDef.Value;
          if (typeof val === "string" && val.trim()) {
            map.set(nameLower, val.trim());
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return map;
}

/**
 * Read UniqueID + Name from a manifest.json (or fall back to folder name).
 */
function readManifestIdentity(modDir: string): { modId: string; modName: string } {
  const folderName = path.basename(modDir);

  let modId = folderName;
  let modName = folderName;

  const manifestPath = path.join(modDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { modId, modName };
  }

  try {
    const text = fs.readFileSync(manifestPath, "utf8");
    const errors: ParseError[] = [];
    const json = parse(text, errors, { allowTrailingComma: true }) as any;

    if (json && typeof json === "object") {
      const rawUniqueId =
        json.UniqueID ?? json.UniqueId ?? json.uniqueID ?? json.uniqueId;

      if (typeof rawUniqueId === "string" && rawUniqueId.trim()) {
        modId = rawUniqueId.trim();
      }

      const rawName = json.Name;
      if (typeof rawName === "string" && rawName.trim()) {
        modName = rawName.trim();
      } else {
        modName = modId;
      }
    }
  } catch {
    // ignore
  }

  return { modId, modName };
}

function buildKnownModsMap(modDirs: string[]): KnownModsMap {
  const map: KnownModsMap = new Map();

  for (const dir of modDirs) {
    const id = readManifestIdentity(dir);
    if (id.modId && id.modId.trim()) {
      map.set(id.modId.trim(), id.modName || id.modId.trim());
    }
  }

  return map;
}

/**
 * For “reference indexing” (machine rules, recipes, shop lists, etc),
 * try to infer the owning mod based on common ID patterns.
 */
function resolveOwningModForInnerId(
  innerId: string,
  currentModId: string,
  currentModName: string,
  knownMods: KnownModsMap
): { modId: string; modName: string } {
  if (typeof innerId !== "string" || !innerId.trim()) {
    return { modId: currentModId, modName: currentModName };
  }

  const s = innerId.trim();

  // Common case: <UniqueID>_<LocalId>
  const underscoreIdx = s.indexOf("_");
  if (underscoreIdx > 0) {
    const candidate = s.slice(0, underscoreIdx);
    const knownName = knownMods.get(candidate);
    if (knownName) {
      return { modId: candidate, modName: knownName };
    }
  }

  // Conservative fallback: exact known ID prefix with dot
  for (const [knownId, knownName] of knownMods.entries()) {
    if (s === knownId || s.startsWith(knownId + ".")) {
      return { modId: knownId, modName: knownName };
    }
  }

  return { modId: currentModId, modName: currentModName };
}

/**
 * Map Content Patcher EditData targets → category + prefix.
 */
const TARGET_TO_CATEGORY: Record<string, { prefix: string; category: string }> = {
  "Data/Objects": { prefix: "O", category: "objects" },
  "Data/BigCraftables": { prefix: "BC", category: "bigCraftables" },
  "Data/Weapons": { prefix: "W", category: "weapons" },
  "Data/Furniture": { prefix: "F", category: "furniture" },
  "Data/Boots": { prefix: "B", category: "boots" },
  "Data/Hats": { prefix: "H", category: "hats" },
  "Data/Shirts": { prefix: "S", category: "shirts" },
  "Data/Pants": { prefix: "P", category: "pants" },
  "Data/Tools": { prefix: "T", category: "tools" },
};

const PREFIX_TO_CATEGORY_KEY: Record<string, string> = {
  O: "objects",
  BC: "bigCraftables",
  F: "furniture",
  B: "boots",
  H: "hats",
  S: "shirts",
  P: "pants",
  T: "tools",
  W: "weapons",
};

const REFERENCE_TARGETS = new Set<string>([
  "Data/Machines",
  "Data/CookingRecipes",
  "Data/CraftingRecipes",
  "Data/Shops",
  "Data/Events",
  "Data/NPCGiftTastes",
  "Data/Locations",
]);

/**
 * Resolve a human-friendly display name for an added item.
 *
 * Updated: resolves i18n tokens inside strings and LocalizedText keys to readable text.
 */
function resolveItemDisplayName(
  entryData: any,
  innerId: string,
  modI18n: Map<string, string>,
  modId: string,
  dynamicTokens?: Map<string, string>
): string {
  let nameCandidate: string | undefined;

  if (entryData && typeof entryData === "object") {
    if (typeof entryData.DisplayName === "string") {
      nameCandidate = entryData.DisplayName.trim();
    } else if (typeof entryData.Displayname === "string") {
      nameCandidate = entryData.Displayname.trim();
    } else if (typeof entryData.Name === "string") {
      nameCandidate = entryData.Name.trim();
    }
  }

  if (!nameCandidate) {
    return innerId;
  }

  const readable = makeNameReadable(nameCandidate, modI18n, modId, dynamicTokens);
  return readable || innerId;
}

/**
 * Inline Data/Furniture parser
 */
function resolveFurnitureInlineDisplayName(
  rawValue: string,
  innerId: string,
  modI18n: Map<string, string>,
  modId: string,
  dynamicTokens?: Map<string, string>
): string {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return innerId;
  }

  const expanded = expandDynamicTokens(rawValue, dynamicTokens);
  const parts = expanded.split("/");

  const internalName = (parts[0] ?? "").trim();
  const displayPart = (parts[7] ?? "").trim();

  if (!displayPart) {
    return internalName || innerId;
  }

  const readable = makeNameReadable(displayPart, modI18n, modId, dynamicTokens);
  return readable || internalName || innerId;
}

/**
 * Inline Data/Boots parser
 */
function resolveBootsInlineDisplayName(
  rawValue: string,
  innerId: string,
  modI18n: Map<string, string>,
  modId: string,
  dynamicTokens?: Map<string, string>
): string {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return innerId;
  }

  const expanded = expandDynamicTokens(rawValue, dynamicTokens);
  const parts = expanded.split("/");

  const internalName = (parts[0] ?? "").trim();
  const displayPart = (parts[6] ?? "").trim();

  if (!displayPart) {
    return internalName || innerId;
  }

  const readable = makeNameReadable(displayPart, modI18n, modId, dynamicTokens);
  return readable || internalName || innerId;
}

/**
 * Inline Data/Hats parser
 */
function resolveHatsInlineDisplayName(
  rawValue: string,
  innerId: string,
  modI18n: Map<string, string>,
  modId: string,
  dynamicTokens?: Map<string, string>
): string {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return innerId;
  }

  const expanded = expandDynamicTokens(rawValue, dynamicTokens);
  const parts = expanded.split("/");

  const internalName = (parts[0] ?? "").trim();
  const displayPart = (parts[5] ?? "").trim();

  if (!displayPart) {
    return internalName || innerId;
  }

  const readable = makeNameReadable(displayPart, modI18n, modId, dynamicTokens);
  return readable || internalName || innerId;
}

function buildIncludeTokenMap(
  modId: string,
  dynamicTokens?: Map<string, string>,
  localTokens?: any
): Map<string, string> {
  const tokenMap = new Map<string, string>();

  if (dynamicTokens) {
    for (const [k, v] of dynamicTokens.entries()) {
      tokenMap.set(String(k).trim().toLowerCase(), String(v ?? "").trim());
    }
  }

  if (localTokens && typeof localTokens === "object") {
    for (const [k, v] of Object.entries(localTokens)) {
      tokenMap.set(String(k).trim().toLowerCase(), String(v ?? "").trim());
    }
  }

  // Always include modid so LocalTokens can reference it if desired.
  tokenMap.set("modid", modId);

  return tokenMap;
}

function splitFromFileValue(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (typeof raw !== "string") {
    return [];
  }

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// Include warning/log dedupe
// -----------------------------------------------------------------------------
const warnedMissingIncludes = new Set<string>();
const warnedDeferredIncludes = new Set<string>();

// Debug-level dedupe so "INCLUDE resolved" doesn't appear 500 times even with debug on.
const debugResolvedIncludes = new Set<string>();

function resetIncludeLogCaches(): void {
  warnedMissingIncludes.clear();
  warnedDeferredIncludes.clear();
  debugResolvedIncludes.clear();
}

function expandIncludePatches(
  changes: any[],
  modDir: string,
  modId: string,
  dynamicTokens?: Map<string, string>
): any[] {
  const expanded: any[] = [];

  dbg(
    `[InstalledIndex] expandIncludePatches: modId='${modId}', modDir='${modDir}', changes=${
      Array.isArray(changes) ? changes.length : 0
    }`
  );

  for (const patch of changes) {
    if (!patch || typeof patch !== "object") continue;

    if (patch.Action !== "Include") {
      expanded.push(patch);
      continue;
    }

    const fromFiles = splitFromFileValue((patch as any).FromFile);

    if (fromFiles.length === 0) {
      dbg(
        `[InstalledIndex] INCLUDE skipped: empty/invalid FromFile (type=${typeof (patch as any).FromFile})`
      );
      expanded.push(patch);
      continue;
    }

    const tokenMap = buildIncludeTokenMap(modId, dynamicTokens, patch.LocalTokens);

    if (patch.LocalTokens && typeof patch.LocalTokens === "object") {
      const keys = Object.keys(patch.LocalTokens);
      dbg(`[InstalledIndex] INCLUDE LocalTokens keys: ${keys.join(", ")}`);
    } else {
      dbg(`[InstalledIndex] INCLUDE LocalTokens: <none>`);
    }

    for (const fromFileRaw of fromFiles) {
      const fromFile = fromFileRaw.trim();
      if (!fromFile) continue;

      // Expand what we safely can (DynamicTokens + LocalTokens). This helps
      // resolve straightforward cases, while still leaving i18n/modid for later.
      const fromFileExpanded = expandTokensDeep(fromFile, tokenMap);
      const fromFileHasTokens = hasAnyCpToken(fromFileExpanded);

      // If FromFile still contains {{...}} after expansion, we cannot resolve it
      // at scan time. Defer/skip to avoid false "missing file" spam.
      if (fromFileHasTokens) {
        const key = `${modId}::${fromFileExpanded}`;
        if (!warnedDeferredIncludes.has(key)) {
          warnedDeferredIncludes.add(key);
          dbg(
            `[InstalledIndex] INCLUDE deferred (unresolved tokens): FromFile='${fromFile}' -> '${fromFileExpanded}'`
          );
        }
        expanded.push(patch);
        continue;
      }

      const includeAbs = path.resolve(modDir, fromFileExpanded);
      const exists = fs.existsSync(includeAbs);

      const resolvedKey = `${modId}::${includeAbs}`;
      if (!debugResolvedIncludes.has(resolvedKey)) {
        debugResolvedIncludes.add(resolvedKey);
        dbg(
          `[InstalledIndex] INCLUDE resolved: FromFile='${fromFileExpanded}' -> '${includeAbs}' (exists=${exists})`
        );
      }

      if (!exists) {
        const warnKey = `${modId}::${includeAbs}`;
        if (!warnedMissingIncludes.has(warnKey)) {
          warnedMissingIncludes.add(warnKey);
          console.warn(
            `[InstalledIndex] INCLUDE missing file: '${includeAbs}' (FromFile='${fromFileExpanded}')`
          );
        }
        expanded.push(patch);
        continue;
      }

      const includedJson = readJsoncFile(includeAbs);
      if (!includedJson) {
        console.warn(`[InstalledIndex] INCLUDE failed to parse: '${includeAbs}'`);
        expanded.push(patch);
        continue;
      }

      const includedExpanded = expandTokensInAny(includedJson, tokenMap);

      if (installedIndexDebugEnabled()) {
        const expandedTextProbe = JSON.stringify(includedExpanded);
        const stillHasColorToken = expandedTextProbe.includes("{{Color}}");
        const stillHasColorTokenLower = expandedTextProbe
          .toLowerCase()
          .includes("{{color}}");

        dbg(
          `[InstalledIndex] INCLUDE expanded: stillHas('{{Color}}')=${stillHasColorToken}, stillHas('{{color}}')=${stillHasColorTokenLower}`
        );
      }

      const includedChanges = Array.isArray((includedExpanded as any).Changes)
        ? (includedExpanded as any).Changes
        : [];

      dbg(
        `[InstalledIndex] INCLUDE expanded changes count: ${includedChanges.length}`
      );

      if (includedChanges.length > 0) {
        for (const child of includedChanges) {
          if (patch.When && child && typeof child === "object" && !child.When) {
            (child as any).When = patch.When;
          }
          expanded.push(child);
        }
      } else {
        expanded.push(includedExpanded);
      }
    }
  }

  dbg(`[InstalledIndex] expandIncludePatches result: expanded=${expanded.length}`);

  return expanded;
}

function extractQualifiedIdsFromText(
  raw: string,
  modId: string,
  dynamicTokens?: Map<string, string>
): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];

  let s = raw;
  s = expandDynamicTokens(s, dynamicTokens);
  s = s.replace(/\{\{\s*modid\s*\}\}/gi, modId);

  const out: string[] = [];
  const re = /\(([A-Z]+)\)([A-Za-z0-9._-]+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const prefix = m[1];
    const inner = m[2];
    if (!prefix || !inner) continue;
    out.push(`(${prefix})${inner}`);
  }
  return out;
}

function collectQualifiedIdsFromAny(
  value: any,
  modId: string,
  dynamicTokens?: Map<string, string>,
  into?: Set<string>
): Set<string> {
  const set = into ?? new Set<string>();

  if (typeof value === "string") {
    for (const qid of extractQualifiedIdsFromText(value, modId, dynamicTokens)) {
      set.add(qid);
    }
    return set;
  }

  if (Array.isArray(value)) {
    for (const v of value) {
      collectQualifiedIdsFromAny(v, modId, dynamicTokens, set);
    }
    return set;
  }

  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      collectQualifiedIdsFromAny(v, modId, dynamicTokens, set);
    }
    return set;
  }

  return set;
}

function shouldSkipDirectIndexingAsTemplate(filePath: string, json: any): boolean {
  const base = path.basename(filePath).toLowerCase();

  if (base.includes("template")) {
    if (json && typeof json === "object" && Array.isArray((json as any).Changes)) {
      return true;
    }
  }

  return false;
}

function addReferenceQualifiedIdsToIndex(
  found: Set<string>,
  currentModId: string,
  currentModName: string,
  knownMods: KnownModsMap,
  baseQualifiedIds: Set<string>,
  qualifiedIdToInfo: Map<string, InstalledItemInfo>
): void {
  for (const qid of found) {
    if (baseQualifiedIds.has(qid)) continue;
    if (qualifiedIdToInfo.has(qid)) continue;

    const m = /^\(([A-Z]+)\)(.+)$/.exec(qid);
    if (!m) continue;

    const prefix = m[1];
    const inner = m[2];

    if (!PREFIX_TO_CATEGORY_KEY[prefix]) continue;

    const owner = resolveOwningModForInnerId(
      inner,
      currentModId,
      currentModName,
      knownMods
    );

    qualifiedIdToInfo.set(qid, {
      modId: owner.modId,
      modName: owner.modName,
      name: inner,
    });
  }
}

function scanContentJson(
  filePath: string,
  modDir: string,
  modId: string,
  modName: string,
  modI18n: Map<string, string>,
  baseQualifiedIds: Set<string>,
  qualifiedIdToInfo: Map<string, InstalledItemInfo>,
  knownMods: KnownModsMap,
  modDynamicTokens?: Map<string, string>
): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const errors: ParseError[] = [];
  const json = parse(text, errors, { allowTrailingComma: true }) as any;
  if (!json || typeof json !== "object") return;

  const rel = path.relative(modDir, filePath).replace(/\\/g, "/");
  const hasChanges = Array.isArray((json as any).Changes);

  const hasInclude =
    hasChanges &&
    (json as any).Changes.some((p: any) => {
      if (!p || typeof p !== "object") return false;
      if (p.Action !== "Include") return false;
      // FromFile can be string or array; allow both
      return typeof p.FromFile === "string" || Array.isArray(p.FromFile);
    });

  if (installedIndexDebugEnabled() && (hasInclude || rel.toLowerCase().includes("data/objects."))) {
    dbg(
      `[InstalledIndex] SCAN file='${rel}' modId='${modId}' hasChanges=${hasChanges} changesCount=${
        hasChanges ? (json as any).Changes.length : 0
      } hasInclude=${hasInclude}`
    );
  }

  if (shouldSkipDirectIndexingAsTemplate(filePath, json)) {
    if (installedIndexDebugEnabled() && (hasInclude || rel.toLowerCase().includes("template"))) {
      dbg(`[InstalledIndex] SKIP template direct indexing: '${rel}'`);
    }
    return;
  }

  // Merge mod-level dynamic tokens + file-level DynamicTokens
  const dynamicTokens = new Map<string, string>();
  if (modDynamicTokens) {
    for (const [k, v] of modDynamicTokens.entries()) {
      dynamicTokens.set(k, v);
    }
  }
  if (Array.isArray((json as any).DynamicTokens)) {
    for (const tokenDef of (json as any).DynamicTokens) {
      if (
        tokenDef &&
        typeof tokenDef === "object" &&
        typeof tokenDef.Name === "string"
      ) {
        const nameLower = tokenDef.Name.trim().toLowerCase();
        const val = tokenDef.Value;
        if (typeof val === "string" && val.trim()) {
          dynamicTokens.set(nameLower, val.trim());
        }
      }
    }
  }

  const changesRaw = (json as any).Changes;
  if (!Array.isArray(changesRaw)) return;

  const changes = expandIncludePatches(changesRaw, modDir, modId, dynamicTokens);

  if (installedIndexDebugEnabled() && (hasInclude || rel.toLowerCase().includes("data/objects."))) {
    const includeCount = changesRaw.filter((p: any) => p?.Action === "Include").length;
    dbg(
      `[InstalledIndex] SCAN expanded changes: raw=${changesRaw.length} includes=${includeCount} expanded=${changes.length}`
    );
  }

  for (const patch of changes) {
    if (!patch || typeof patch !== "object") continue;

    // Reference indexing
    if (
      patch.Action === "EditData" &&
      typeof patch.Target === "string" &&
      REFERENCE_TARGETS.has(patch.Target)
    ) {
      const entries = (patch as any).Entries;

      if (entries && typeof entries === "object") {
        const found = collectQualifiedIdsFromAny(entries, modId, dynamicTokens);
        addReferenceQualifiedIdsToIndex(
          found,
          modId,
          modName,
          knownMods,
          baseQualifiedIds,
          qualifiedIdToInfo
        );
      } else {
        const found = collectQualifiedIdsFromAny(patch, modId, dynamicTokens);
        addReferenceQualifiedIdsToIndex(
          found,
          modId,
          modName,
          knownMods,
          baseQualifiedIds,
          qualifiedIdToInfo
        );
      }
      continue;
    }

    if (patch.Action !== "EditData") continue;
    if (typeof patch.Target !== "string") continue;

    const targetInfo = TARGET_TO_CATEGORY[patch.Target];
    if (!targetInfo) continue;

    if (patch.TargetField) {
      continue;
    }

    const entries = (patch as any).Entries;
    if (!entries || typeof entries !== "object") continue;

    for (const key of Object.keys(entries)) {
      const rawInnerId = key.trim();
      if (!rawInnerId) continue;

      if (rawInnerId === "When") {
        continue;
      }

      const entryData = (entries as any)[key];

      let innerId = expandDynamicTokens(rawInnerId, dynamicTokens);
      innerId = innerId.replace(/\{\{\s*modid\s*\}\}/gi, modId);

      const qualifiedId = `(${targetInfo.prefix})${innerId}`;

      if (qualifiedId.includes("{{") || qualifiedId.includes("}}")) {
        dbg(
          `[InstalledIndex] INDEX token still present: ${qualifiedId} (from file ${path
            .relative(modDir, filePath)
            .replace(/\\/g, "/")})`
        );
      }

      if (baseQualifiedIds.has(qualifiedId)) continue;

      let displayName: string;
      if (patch.Target === "Data/Furniture" && typeof entryData === "string") {
        displayName = resolveFurnitureInlineDisplayName(
          entryData,
          innerId,
          modI18n,
          modId,
          dynamicTokens
        );
      } else if (patch.Target === "Data/Boots" && typeof entryData === "string") {
        displayName = resolveBootsInlineDisplayName(
          entryData,
          innerId,
          modI18n,
          modId,
          dynamicTokens
        );
      } else if (patch.Target === "Data/Hats" && typeof entryData === "string") {
        displayName = resolveHatsInlineDisplayName(
          entryData,
          innerId,
          modI18n,
          modId,
          dynamicTokens
        );
      } else {
        displayName = resolveItemDisplayName(
          entryData,
          innerId,
          modI18n,
          modId,
          dynamicTokens
        );
      }

      if (!qualifiedIdToInfo.has(qualifiedId)) {
        qualifiedIdToInfo.set(qualifiedId, {
          modId,
          modName,
          name: displayName,
        });
      }

      // Data/Objects alias indexing when entryData.Name differs from key
      if (
        patch.Target === "Data/Objects" &&
        isObjectRecord(entryData) &&
        typeof (entryData as any).Name === "string" &&
        (entryData as any).Name.trim()
      ) {
        let nameInnerId = (entryData as any).Name.trim();
        nameInnerId = expandDynamicTokens(nameInnerId, dynamicTokens);
        nameInnerId = nameInnerId.replace(/\{\{\s*modid\s*\}\}/gi, modId);

        if (nameInnerId && nameInnerId !== innerId) {
          const aliasQualifiedId = `(${targetInfo.prefix})${nameInnerId}`;
          if (!baseQualifiedIds.has(aliasQualifiedId)) {
            const aliasDisplayName = resolveItemDisplayName(
              entryData,
              nameInnerId,
              modI18n,
              modId,
              dynamicTokens
            );

            if (!qualifiedIdToInfo.has(aliasQualifiedId)) {
              qualifiedIdToInfo.set(aliasQualifiedId, {
                modId,
                modName,
                name: aliasDisplayName,
              });
            }
          }
        }
      }
    }
  }
}

function scanModFolder(
  modDir: string,
  baseQualifiedIds: Set<string>,
  qualifiedIdToInfo: Map<string, InstalledItemInfo>,
  knownMods: KnownModsMap
): void {
  const folderName = path.basename(modDir);

  if (folderName.startsWith(".")) {
    console.log(
      `[Stardew Modding Schema] Skipping dot folder as mod: ${folderName}`
    );
    return;
  }

  const identity = readManifestIdentity(modDir);
  const modId = identity.modId;
  const modName = identity.modName;

  dbg(
    `[Stardew Modding Schema] Mod folder '${folderName}' → modId='${modId}', modName='${modName}'`
  );

  const modI18n = loadModI18n(modDir);
  const modDynamicTokens = loadModDynamicTokens(modDir);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        walk(full);
        continue;
      }

      if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
          scanContentJson(
            full,
            modDir,
            modId,
            modName,
            modI18n,
            baseQualifiedIds,
            qualifiedIdToInfo,
            knownMods,
            modDynamicTokens
          );
        }
      }
    }
  }

  walk(modDir);
}

function findModFolders(modsRoot: string): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 6) return;

    const manifest = path.join(dir, "manifest.json");
    if (fs.existsSync(manifest)) {
      results.push(dir);
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const childDir = path.join(dir, entry.name);
      walk(childDir, depth + 1);
    }
  }

  try {
    if (!fs.existsSync(modsRoot) || !fs.statSync(modsRoot).isDirectory()) {
      return results;
    }
  } catch {
    return results;
  }

  walk(modsRoot, 0);
  return results;
}

// -----------------------------------------------------------------------------
// Only write installed-mod-ids.json when it actually changed.
// -----------------------------------------------------------------------------
function stableStringify(value: any): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null || v === undefined) return v;

    if (typeof v !== "object") return v;

    if (seen.has(v)) {
      return v;
    }
    seen.add(v);

    if (Array.isArray(v)) {
      return v.map(normalize);
    }

    const out: Record<string, any> = {};
    for (const key of Object.keys(v).sort((a, b) => a.localeCompare(b))) {
      out[key] = normalize(v[key]);
    }
    return out;
  };

  return JSON.stringify(normalize(value), null, 2);
}

function tryReadJsoncObject(fullPath: string): any | null {
  if (!fs.existsSync(fullPath)) return null;

  try {
    const text = fs.readFileSync(fullPath, "utf8");
    const errors: ParseError[] = [];
    const json = parse(text, errors, { allowTrailingComma: true }) as any;

    if (!json || typeof json !== "object") return null;
    return json;
  } catch {
    return null;
  }
}

function writeFileIfChangedJson(
  fullPath: string,
  nextObject: any
): { changed: boolean } {
  const prevObject = tryReadJsoncObject(fullPath);
  const nextText = stableStringify(nextObject);

  if (prevObject) {
    const prevText = stableStringify(prevObject);
    if (prevText === nextText) {
      return { changed: false };
    }
  } else {
    // If it exists but doesn't parse (or doesn't exist), do a raw text compare as a last check.
    if (fs.existsSync(fullPath)) {
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        if (raw === nextText) return { changed: false };
      } catch {
        // ignore
      }
    }
  }

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, nextText, "utf8");
  return { changed: true };
}

async function doRebuildInstalledItemIndex(
  context: vscode.ExtensionContext,
  auto: boolean,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
  // Clear per-run caches to avoid memory growth and to keep logging sane
  resetIncludeLogCaches();

  const config = vscode.workspace.getConfiguration("stardewModdingSchema");
  const modsRoot = (config.get<string>("modsRoot") ?? "").trim();

  if (
    !modsRoot ||
    !fs.existsSync(modsRoot) ||
    !fs.statSync(modsRoot).isDirectory()
  ) {
    if (!auto) {
      const choice = await vscode.window.showErrorMessage(
        "Stardew Modding Schema: Valid 'modsRoot' folder is required.",
        "Open Settings"
      );
      if (choice === "Open Settings") {
        vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "stardewModdingSchema.modsRoot"
        );
      }
    }
    return;
  }

  if (progress) {
    progress.report({ message: "Loading base item IDs…", increment: 5 });
  }
  const baseQualifiedIds = loadBaseQualifiedIds(context);

  const qualifiedIdToInfo = new Map<string, InstalledItemInfo>();

  const modDirs = findModFolders(modsRoot);

  const knownMods = buildKnownModsMap(modDirs);
  dbg(`[Stardew Modding Schema] Known mods loaded: ${knownMods.size}`);

  if (!auto) {
    vscode.window.showInformationMessage(
      `Stardew Modding Schema: Detected ${modDirs.length} mod folders.`
    );
  } else {
    dbg(
      `[Stardew Modding Schema] Auto rebuild scanning ${modDirs.length} mod folders.`
    );
  }

  const totalMods = modDirs.length || 1;

  let processed = 0;
  for (const modDir of modDirs) {
    scanModFolder(modDir, baseQualifiedIds, qualifiedIdToInfo, knownMods);
    processed++;

    if (progress) {
      const increment = 85 / totalMods;
      progress.report({
        message: `Scanning mods… (${processed}/${totalMods})`,
        increment,
      });
    }
  }

  const categories: Record<string, any[]> = {
    objects: [],
    bigCraftables: [],
    boots: [],
    flooring: [],
    furniture: [],
    hats: [],
    mannequins: [],
    pants: [],
    shirts: [],
    tools: [],
    trinkets: [],
    wallpapers: [],
    weapons: [],
  };

  for (const [qualifiedId, info] of qualifiedIdToInfo.entries()) {
    const m = /^\(([A-Z]+)\)(.+)$/.exec(qualifiedId);
    if (!m) continue;
    const prefix = m[1];
    const inner = m[2];

    const entry = {
      id: inner,
      name: info.name || inner,
      qualifiedId,
      modId: info.modId,
      modName: info.modName,
    };

    switch (prefix) {
      case "O":
        categories.objects.push(entry);
        break;
      case "BC":
        categories.bigCraftables.push(entry);
        break;
      case "B":
        categories.boots.push(entry);
        break;
      case "F":
        categories.furniture.push(entry);
        break;
      case "H":
        categories.hats.push(entry);
        break;
      case "P":
        categories.pants.push(entry);
        break;
      case "S":
        categories.shirts.push(entry);
        break;
      case "T":
        categories.tools.push(entry);
        break;
      case "W":
        categories.weapons.push(entry);
        break;
      default:
        categories.objects.push(entry);
        break;
    }
  }

  for (const arr of Object.values(categories)) {
    arr.sort((a, b) => String(a.qualifiedId).localeCompare(String(b.qualifiedId)));
  }

  const out = {
    categoryTypes: {
      objects: "O",
      bigCraftables: "BC",
      boots: "B",
      flooring: "FL",
      furniture: "F",
      hats: "H",
      mannequins: "M",
      pants: "P",
      shirts: "S",
      tools: "T",
      trinkets: "TR",
      wallpapers: "WP",
      weapons: "W",
    },
    ...categories,
  };

  const outPath = context.asAbsolutePath("data/installed-mod-ids.json");

  if (progress) {
    progress.report({
      message: "Writing installed-mod-ids.json…",
      increment: 10,
    });
  }

  const { changed } = writeFileIfChangedJson(outPath, out);

  if (!auto) {
    if (changed) {
      vscode.window.showInformationMessage(
        "Installed item index updated. Reloading…"
      );
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    } else {
      vscode.window.showInformationMessage(
        "Installed item index is already up to date."
      );
    }
  } else {
    if (changed) {
      console.log("[Stardew Modding Schema] Installed mod index updated.");
    } else {
      dbg("[Stardew Modding Schema] Installed mod index unchanged.");
    }
  }
}

/**
 * Public entry point.
 * When auto = false, shows a toast progress bar while rebuilding.
 */
export async function rebuildInstalledItemIndex(
  context: vscode.ExtensionContext,
  options?: RebuildIndexOptions
): Promise<void> {
  const auto = options?.auto ?? false;

  if (auto) {
    const now = Date.now();
    if (now - lastAutoRebuildAt < AUTO_REBUILD_MIN_MS) {
      dbg(
        `[Stardew Modding Schema] Auto rebuild throttled (min ${AUTO_REBUILD_MIN_MS}ms).`
      );
      return;
    }
    lastAutoRebuildAt = now;

    await runRebuildGuarded(context, true);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Stardew Modding Schema: Rebuilding installed item index…",
      cancellable: false,
    },
    async (progress) => {
      await runRebuildGuarded(context, false, progress);
    }
  );
}

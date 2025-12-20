// src/stardewIds.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as jsonc from "jsonc-parser";

export type ItemSource = "vanilla" | "custom" | "installed";

export interface ItemEntry {
  id: string;
  name: string;
  qualifiedId: string;
  category: string;
  source: ItemSource;
  modId: string; // "Vanilla", "Custom", or actual manifest UniqueID for installed items
}

export interface ItemLookup {
  byQualifiedId: Map<string, ItemEntry>;
  byId: Map<string, ItemEntry[]>;
  byName: Map<string, ItemEntry[]>; // NEW: lookup by display name (lowercased)
}

/**
 * Try loading data/<baseName>.jsonc or data/<baseName>.json,
 * parsed as JSONC (so comments and trailing commas are OK).
 */
function loadDataFile(
  context: vscode.ExtensionContext,
  baseName: string
): any | null {
  const candidates = [`${baseName}.jsonc`, `${baseName}.json`];

  for (const fileName of candidates) {
    const fullPath = context.asAbsolutePath(path.join("data", fileName));
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    try {
      const text = fs.readFileSync(fullPath, "utf8");
      const errors: jsonc.ParseError[] = [];
      const json = jsonc.parse(text, errors, { allowTrailingComma: true });
      if (json && typeof json === "object") {
        return json;
      }
    } catch (err) {
      console.warn(
        `[Stardew Modding Schema] Failed to parse ${fileName}:`,
        err
      );
      return null;
    }
  }

  return null;
}

/**
 * Add items from a stardew-ids-style JSON into the lookup maps.
 * Respects categoryTypes, and will attach modId if present on each entry.
 */
function addItemsFromSource(
  json: any,
  source: ItemSource,
  defaultModId: string,
  lookup: ItemLookup
): void {
  if (!json || typeof json !== "object") return;

  const categoryTypes = json.categoryTypes as Record<string, string> | undefined;
  if (!categoryTypes || typeof categoryTypes !== "object") return;

  // For each category key (objects, bigCraftables, weapons, etc.)
  for (const categoryKey of Object.keys(categoryTypes)) {
    const prefix = categoryTypes[categoryKey]; // e.g. "O", "BC", "W"
    if (!prefix) continue;

    const itemsArray = json[categoryKey];
    if (!Array.isArray(itemsArray)) continue;

    for (const item of itemsArray) {
      if (!item || typeof item !== "object") continue;

      const idRaw = item.id;
      const name = String(item.name ?? "").trim();
      const qualifiedId = String(item.qualifiedId ?? "").trim();

      if (!name || !qualifiedId || idRaw === undefined || idRaw === null) {
        continue;
      }

      const id = String(idRaw);
      const modId =
        typeof item.modId === "string" && item.modId.trim().length > 0
          ? item.modId.trim()
          : defaultModId;

      const entry: ItemEntry = {
        id,
        name,
        qualifiedId,
        category: categoryKey,
        source,
        modId,
      };

      // byQualifiedId: last one wins (installed/custom can override vanilla)
      lookup.byQualifiedId.set(qualifiedId, entry);

      // byId: collect all entries matching this bare ID
      const list = lookup.byId.get(id) ?? [];
      list.push(entry);
      lookup.byId.set(id, list);

      // byName: lookup by display name (case-insensitive)
      const nameKey = name.toLowerCase();
      const nameList = lookup.byName.get(nameKey) ?? [];
      nameList.push(entry);
      lookup.byName.set(nameKey, nameList);
    }
  }
}

/**
 * Load vanilla, custom, and installed item IDs into lookup maps.
 */
export function loadStardewIds(
  context: vscode.ExtensionContext
): ItemLookup | null {
  const lookup: ItemLookup = {
    byQualifiedId: new Map<string, ItemEntry>(),
    byId: new Map<string, ItemEntry[]>(),
    byName: new Map<string, ItemEntry[]>(),
  };

  // 1) Vanilla
  const vanillaJson = loadDataFile(context, "stardew-ids");
  if (!vanillaJson) {
    console.warn(
      "[Stardew Modding Schema] data/stardew-ids.json(.jsonc) not found; item features disabled."
    );
    return null;
  }
  addItemsFromSource(vanillaJson, "vanilla", "Vanilla", lookup);

  // 2) Custom IDs (optional)
  const customJson = loadDataFile(context, "custom-ids");
  if (customJson) {
    addItemsFromSource(customJson, "custom", "Custom", lookup);
  }

  // 3) Installed mod IDs (optional; built from Mods folder)
  const installedJson = loadDataFile(context, "installed-mod-ids");
  if (installedJson) {
    addItemsFromSource(installedJson, "installed", "Installed", lookup);
  }

  console.log(
    `[Stardew Modding Schema] Loaded ${lookup.byQualifiedId.size} item entries (vanilla + custom + installed).`
  );

  return lookup;
}

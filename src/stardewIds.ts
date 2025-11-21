import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { JSONSchema } from "vscode-json-languageservice";
import { parse as parseJsonC, ParseError } from "jsonc-parser";

export type CategoryName =
  | "objects"
  | "bigCraftables"
  | "boots"
  | "flooring"
  | "furniture"
  | "hats"
  | "mannequins"
  | "pants"
  | "shirts"
  | "tools"
  | "trinkets"
  | "wallpapers"
  | "weapons";

export interface StardewItemEntry {
  id: number | string;
  name: string;
  qualifiedId: string; // e.g. "(O)24"
}

export interface StardewIdsRoot {
  categoryTypes?: Record<CategoryName, string>;
  objects?: StardewItemEntry[];
  bigCraftables?: StardewItemEntry[];
  boots?: StardewItemEntry[];
  flooring?: StardewItemEntry[];
  furniture?: StardewItemEntry[];
  hats?: StardewItemEntry[];
  mannequins?: StardewItemEntry[];
  pants?: StardewItemEntry[];
  shirts?: StardewItemEntry[];
  tools?: StardewItemEntry[];
  trinkets?: StardewItemEntry[];
  wallpapers?: StardewItemEntry[];
  weapons?: StardewItemEntry[];
}

export interface StardewItemLookups {
  raw: StardewIdsRoot;
  byQualifiedId: Map<
    string,
    StardewItemEntry & { category: CategoryName; source: "vanilla" | "custom" }
  >;
}

/**
 * Try to load and parse a JSON/JSONC file.
 * Allows comments and trailing commas.
 */
function tryLoadJsonC(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const text = fs.readFileSync(filePath, "utf8");
    const errors: ParseError[] = [];
    const json = parseJsonC(text, errors, { allowTrailingComma: true });

    if (errors.length > 0) {
      console.warn(
        "[Stardew Modding Schema] JSONC parse warnings for:",
        filePath,
        errors
      );
    }

    return json;
  } catch (err) {
    console.warn(
      "[Stardew Modding Schema] Failed to parse JSONC:",
      filePath,
      err
    );
    return null;
  }
}

/**
 * Load vanilla + custom ID data and merge them.
 *
 * Vanilla:
 *   data/stardew-ids.jsonc  or  data/stardew-ids.json
 *
 * Custom (optional):
 *   data/custom-ids.jsonc   or  data/custom-ids.json
 */
export function loadStardewIds(
  context: vscode.ExtensionContext
): StardewItemLookups | null {
  const coreCandidates = [
    context.asAbsolutePath(path.join("data", "stardew-ids.jsonc")),
    context.asAbsolutePath(path.join("data", "stardew-ids.json"))
  ];

  let coreRaw: StardewIdsRoot | null = null;
  let corePathUsed: string | null = null;

  for (const candidate of coreCandidates) {
    const json = tryLoadJsonC(candidate);
    if (json) {
      coreRaw = json as StardewIdsRoot;
      corePathUsed = candidate;
      break;
    }
  }

  if (!coreRaw) {
    console.warn(
      "[Stardew Modding Schema] stardew-ids.json(c) not found or invalid. Expected one of:",
      coreCandidates
    );
    return null;
  }

  const customCandidates = [
    context.asAbsolutePath(path.join("data", "custom-ids.jsonc")),
    context.asAbsolutePath(path.join("data", "custom-ids.json"))
  ];

  let customRaw: StardewIdsRoot | null = null;
  let customPathUsed: string | null = null;

  for (const candidate of customCandidates) {
    const json = tryLoadJsonC(candidate);
    if (json) {
      customRaw = json as StardewIdsRoot;
      customPathUsed = candidate;
      break;
    }
  }

  if (corePathUsed) {
    console.log(
      "[Stardew Modding Schema] Loaded vanilla IDs from:",
      corePathUsed
    );
  }
  if (customPathUsed) {
    console.log(
      "[Stardew Modding Schema] Loaded custom IDs from:",
      customPathUsed
    );
  }

  const byQualifiedId = new Map<
    string,
    StardewItemEntry & { category: CategoryName; source: "vanilla" | "custom" }
  >();

  const categories: CategoryName[] = [
    "objects",
    "bigCraftables",
    "boots",
    "flooring",
    "furniture",
    "hats",
    "mannequins",
    "pants",
    "shirts",
    "tools",
    "trinkets",
    "wallpapers",
    "weapons"
  ];

  function ingest(root: StardewIdsRoot, source: "vanilla" | "custom") {
    for (const category of categories) {
      const list = (root as any)[category] as StardewItemEntry[] | undefined;
      if (!list) continue;

      for (const entry of list) {
        if (!entry || !entry.qualifiedId || !entry.name) continue;

        const wrapped = { ...entry, category, source };
        // custom overrides vanilla on the same qualifiedId
        byQualifiedId.set(entry.qualifiedId, wrapped);
      }
    }
  }

  ingest(coreRaw, "vanilla");
  if (customRaw) {
    ingest(customRaw, "custom");
  }

  console.log(
    `[Stardew Modding Schema] Total unique qualified IDs loaded: ${byQualifiedId.size}`
  );

  return {
    raw: coreRaw,
    byQualifiedId
  };
}

/**
 * Build a runtime JSONSchema for item IDs from loaded lookups.
 * This is used only inside the language service for hover/completion.
 */
export function buildStardewItemIdSchema(
  lookups: StardewItemLookups | null
): JSONSchema {
  if (!lookups) {
    return {
      type: "string",
      description: "Stardew item ID or item query string."
    };
  }

  const enumValues: string[] = [];
  const enumDescriptions: string[] = [];

  for (const entry of lookups.byQualifiedId.values()) {
    enumValues.push(entry.qualifiedId);
    enumDescriptions.push(
      `${entry.name} (${entry.category}${
        entry.source === "custom" ? ", custom" : ""
      })`
    );
  }

  return {
    description:
      "Qualified item IDs like '(O)24', '(BC)16', '(W)7'. Includes vanilla + custom IDs at runtime.",
    anyOf: [
      {
        type: "string",
        enum: enumValues,
        enumDescriptions
      },
      {
        type: "string",
        description:
          "Any item ID or item query string (for JA items, flavored items, etc.)."
      }
    ]
  };
}

// src/recipeHover.ts
import * as vscode from "vscode";
import { parseTree, findNodeAtOffset, parse as parseJsonc } from "jsonc-parser";
import * as fs from "fs";
import * as path from "path";
import { ItemEntry, ItemLookup } from "./stardewIds";

/**
 * Minimal JSON AST node shape to avoid TS recursive type issues.
 */
interface JsonAstNode {
  type:
    | "object"
    | "array"
    | "property"
    | "string"
    | "number"
    | "boolean"
    | "null";
  offset: number;
  length: number;
  parent?: JsonAstNode;
  children?: JsonAstNode[];
  value?: unknown;
}

type RecipeKind = "cooking" | "crafting";

interface ParsedIngredient {
  rawId: string; // what the recipe string contains
  resolvedId: string; // after {{ModId}} resolution (used for lookups)
  quantity: number;
  label: string;
}

interface ParsedRecipe {
  kind: RecipeKind;
  ingredients: ParsedIngredient[];
  outputs: ParsedIngredient[];
  unlockSummary?: string;
  isBigCraftable?: boolean;
  displayName?: string;
}

// Common negative category IDs for ingredients/yields.
const CATEGORY_LABELS: Record<number, string> = {
  [-4]: "Fish (any)",
  [-5]: "Egg (any)",
  [-6]: "Milk (any)",
  [-7]: "Cooking ingredient",
  [-75]: "Artisan good",
  [-79]: "Mineral",
  [-80]: "Cooking",
};

/* ------------------------------------------------------------------------- */
/*  Manifest UniqueID resolution (JSONC-safe + cached)                        */
/* ------------------------------------------------------------------------- */

const manifestUniqueIdCache = new Map<string, string | null>();
const manifestParseWarned = new Set<string>();

/**
 * Try to find the manifest.json above the current document and read its UniqueID.
 * Uses JSONC parsing so it tolerates trailing commas/comments in manifests.
 */
function getManifestUniqueIdForDocument(
  document: vscode.TextDocument
): string | null {
  try {
    const fsPath = document.uri.fsPath;
    let dir = path.dirname(fsPath);

    for (let i = 0; i < 15; i++) {
      const manifestPath = path.join(dir, "manifest.json");

      if (fs.existsSync(manifestPath)) {
        // Cache by absolute manifest path
        if (manifestUniqueIdCache.has(manifestPath)) {
          return manifestUniqueIdCache.get(manifestPath) ?? null;
        }

        try {
          const text = fs.readFileSync(manifestPath, "utf8");

          // JSONC-safe parse (tolerates trailing commas/comments)
          const manifest = parseJsonc(text) as any;

          if (
            manifest &&
            typeof manifest.UniqueID === "string" &&
            manifest.UniqueID.trim().length > 0
          ) {
            const id = manifest.UniqueID.trim();
            manifestUniqueIdCache.set(manifestPath, id);
            return id;
          }

          manifestUniqueIdCache.set(manifestPath, null);
          return null;
        } catch (err) {
          // Cache failures too so we don't spam logs
          manifestUniqueIdCache.set(manifestPath, null);

          if (!manifestParseWarned.has(manifestPath)) {
            manifestParseWarned.add(manifestPath);
            console.warn(
              `[Stardew Modding Schema] Failed to parse manifest for UniqueID: ${manifestPath}`,
              err
            );
          }

          return null;
        }
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (err) {
    console.warn(
      "[Stardew Modding Schema] Failed to resolve manifest UniqueID:",
      err
    );
  }

  return null;
}

function resolveModIdPlaceholders(
  value: string,
  document: vscode.TextDocument
): string {
  if (!value) return value;

  if (
    !(/\{\{\s*ModId\s*\}\}/i.test(value) || /\{\{\s*ModID\s*\}\}/i.test(value))
  ) {
    return value;
  }

  const manifestId = getManifestUniqueIdForDocument(document);
  if (!manifestId) return value;

  return value
    .replace(/\{\{\s*ModID\s*\}\}/gi, manifestId)
    .replace(/\{\{\s*ModId\s*\}\}/gi, manifestId);
}

/* ------------------------------------------------------------------------- */
/*  Shared helpers                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Strip a CP category prefix like "(O)", "(BC)", "(W)", etc. from the start of a string.
 */
function stripCpPrefix(value: string): string {
  return value.replace(/^\([A-Za-z]+\)/, "");
}

function isNumericLike(value: string): boolean {
  return /^-?[0-9]+$/.test(value.trim());
}

function isPlaceholderToken(rawId: string): boolean {
  const t = rawId.trim();
  return /^__[^_]+__$/.test(t);
}

function placeholderDisplayName(rawId: string): string {
  const t = rawId.trim();
  if (t === "__INGREDIENT__") return "Enter an Ingredient";
  if (t === "__ITEM__") return "Enter an Item";
  return "Enter an Item";
}

/**
 * Strict item resolver (no fuzzy/suffix guessing).
 * Supports:
 * - exact qualified id
 * - numeric ids (and -category ids)
 * - exact id/name via optional maps (if present)
 * - exact "(O)xxx"/"(BC)xxx" convenience
 */
function resolveStrictItemEntry(
  rawToken: string,
  lookups: ItemLookup,
  preferBigCraftable: boolean
): { entry?: ItemEntry; categoryLabel?: string; normalizedId?: string } {
  const trimmed = rawToken.trim();
  if (!trimmed) return {};

  // Category IDs (negative)
  if (isNumericLike(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n) && n < 0 && CATEGORY_LABELS[n]) {
      return { categoryLabel: CATEGORY_LABELS[n], normalizedId: trimmed };
    }
  }

  // Exact qualified ID match
  const q = lookups.byQualifiedId.get(trimmed);
  if (q) return { entry: q };

  const dynamic = lookups as unknown as {
    byId?: Map<string, ItemEntry[]>;
    byName?: Map<string, ItemEntry[]>;
  };

  // Exact bare ID match
  if (dynamic.byId) {
    const arr = dynamic.byId.get(trimmed);
    if (arr && arr.length) return { entry: arr[0] };
  }

  // Numeric convenience: try (O)/(BC)
  if (/^[0-9]+$/.test(trimmed)) {
    const asQualified = preferBigCraftable ? `(BC)${trimmed}` : `(O)${trimmed}`;
    const nMatch =
      lookups.byQualifiedId.get(asQualified) ||
      lookups.byQualifiedId.get(`(O)${trimmed}`) ||
      lookups.byQualifiedId.get(`(BC)${trimmed}`) ||
      lookups.byQualifiedId.get(trimmed);

    if (nMatch) return { entry: nMatch };
  }

  // Exact name match (case-insensitive)
  if (dynamic.byName) {
    const arr = dynamic.byName.get(trimmed.toLowerCase());
    if (arr && arr.length) return { entry: arr[0] };
  }

  // Convenience: try exact "(O)token" / "(BC)token"
  const qp =
    lookups.byQualifiedId.get(`(O)${trimmed}`) ||
    lookups.byQualifiedId.get(`(BC)${trimmed}`);
  if (qp) return { entry: qp };

  // If token has a CP prefix already, also try matching by stripped body as an ID
  const stripped = stripCpPrefix(trimmed);
  if (stripped !== trimmed && dynamic.byId) {
    const arr = dynamic.byId.get(stripped);
    if (arr && arr.length) return { entry: arr[0] };
  }

  return {};
}

/* ------------------------------------------------------------------------- */
/*  AST helpers for recipes                                                  */
/* ------------------------------------------------------------------------- */

function findRecipeKindForNode(
  node: JsonAstNode,
  document?: vscode.TextDocument
): RecipeKind | null {
  let current: JsonAstNode | undefined = node;

  while (current) {
    if (
      current.type === "property" &&
      current.children &&
      current.children.length >= 2
    ) {
      const keyNode = current.children[0];
      const valueNode = current.children[1];

      if (keyNode.type === "string") {
        const keyName = String(keyNode.value ?? "");

        if (keyName === "Target" && valueNode.type === "string") {
          const target = String(valueNode.value ?? "");
          if (target === "Data/CookingRecipes") return "cooking";
          if (target === "Data/CraftingRecipes") return "crafting";
        }

        if (
          (keyName === "Entries" ||
            keyName === "Data" ||
            keyName === "Fields") &&
          current.parent?.type === "object"
        ) {
          const parentObj = current.parent;
          for (const child of parentObj.children ?? []) {
            if (
              child.type === "property" &&
              child.children &&
              child.children.length >= 2
            ) {
              const cKey = child.children[0];
              const cVal = child.children[1];

              if (
                cKey.type === "string" &&
                cVal.type === "string" &&
                cKey.value === "Target"
              ) {
                const targetVal = String(cVal.value ?? "");
                if (targetVal === "Data/CookingRecipes") return "cooking";
                if (targetVal === "Data/CraftingRecipes") return "crafting";
              }
            }
          }
        }
      }
    }

    current = current.parent;
  }

  if (document) {
    const fullPath = document.uri.fsPath.replace(/\\/g, "/").toLowerCase();
    if (
      fullPath.endsWith("/data/cookingrecipes.json") ||
      fullPath.endsWith("cookingrecipes.json")
    )
      return "cooking";
    if (
      fullPath.endsWith("/data/craftingrecipes.json") ||
      fullPath.endsWith("craftingrecipes.json")
    )
      return "crafting";
  }

  return null;
}

function isFullRecipeStringNode(
  node: JsonAstNode,
  document?: vscode.TextDocument,
  kind?: RecipeKind | null
): boolean {
  const propNode = node.parent;
  if (
    !propNode ||
    propNode.type !== "property" ||
    !propNode.children ||
    propNode.children.length < 2
  )
    return false;

  // must be the property VALUE node
  if (propNode.children[1] !== node) return false;

  const parentObj = propNode.parent;
  if (!parentObj || parentObj.type !== "object") return false;

  const maybeEntriesProp = parentObj.parent;
  if (
    maybeEntriesProp &&
    maybeEntriesProp.type === "property" &&
    maybeEntriesProp.children &&
    maybeEntriesProp.children.length >= 2
  ) {
    const keyNode = maybeEntriesProp.children[0];
    if (keyNode.type === "string") {
      const keyName = String(keyNode.value ?? "");
      if (keyName === "Entries" || keyName === "Data") return true;
    }
  }

  if (document && kind && !parentObj.parent) {
    const fullPath = document.uri.fsPath.replace(/\\/g, "/").toLowerCase();
    if (
      (kind === "cooking" &&
        (fullPath.endsWith("/data/cookingrecipes.json") ||
          fullPath.endsWith("cookingrecipes.json"))) ||
      (kind === "crafting" &&
        (fullPath.endsWith("/data/craftingrecipes.json") ||
          fullPath.endsWith("craftingrecipes.json")))
    ) {
      return true;
    }
  }

  return false;
}

function getRecipeFieldIndex(node: JsonAstNode): number | null {
  let current: JsonAstNode | undefined = node;

  while (current) {
    if (
      current.type === "property" &&
      current.children &&
      current.children.length >= 2
    ) {
      const keyNode = current.children[0];
      if (keyNode.type === "string") {
        const keyValue = String(keyNode.value ?? "");
        if (/^[0-9]+$/.test(keyValue)) {
          let ancestor: JsonAstNode | undefined = current.parent;
          while (ancestor) {
            if (
              ancestor.type === "property" &&
              ancestor.children &&
              ancestor.children.length >= 2 &&
              ancestor.children[0].type === "string" &&
              ancestor.children[0].value === "Fields"
            ) {
              return parseInt(keyValue, 10);
            }
            ancestor = ancestor.parent;
          }
        }
      }
    }
    current = current.parent;
  }

  return null;
}

/* ------------------------------------------------------------------------- */
/*  Field info + summary                                                     */
/* ------------------------------------------------------------------------- */

function getRecipeFieldInfo(
  kind: RecipeKind,
  index: number
): { title: string; description: string } {
  if (kind === "cooking") {
    switch (index) {
      case 0:
        return {
          title: "Field 0 – Ingredients",
          description:
            "Space-separated pairs: `<itemID> <count> [<itemID> <count> ...]`. Negative IDs are categories (e.g. -5 any egg, -6 any milk).",
        };
      case 1:
        return {
          title: "Field 1 – Unused (cooking)",
          description:
            "Pair of numbers in vanilla data, but unused by the game. You can leave this as-is or ignore it.",
        };
      case 2:
        return {
          title: "Field 2 – Yield",
          description:
            "Space-separated pairs: `<itemID> <count> [<itemID> <count> ...]`. Usually just one product; count can be omitted and defaults to 1.",
        };
      case 3:
        return {
          title: "Field 3 – Unlock conditions",
          description:
            "Unlock rule: `f <NPC> <hearts>` for friendship letter, `s <skill> <level>` for skill level, `default` for auto-learned, or any other value for custom/event unlocks.",
        };
      case 4:
        return {
          title: "Field 4 – Display name",
          description:
            "Optional name shown in-game. If omitted or `null`, defaults to the display name of the first product.",
        };
      default:
        return {
          title: `Field ${index}`,
          description: "This index is not normally used for cooking recipes.",
        };
    }
  }

  switch (index) {
    case 0:
      return {
        title: "Field 0 – Ingredients",
        description:
          "Space-separated pairs: `<itemID> <count> [<itemID> <count> ...]`. Negative IDs are categories (e.g. -5 any egg, -6 any milk).",
      };
    case 1:
      return {
        title: "Field 1 – Home/Field (unused)",
        description:
          "String `Home` or `Field` in vanilla data, but unused by the game; recipes work regardless. You can keep vanilla-style values for consistency.",
      };
    case 2:
      return {
        title: "Field 2 – Yield",
        description:
          "Space-separated pairs: `<itemID> <count> [<itemID> <count> ...]`. This is the product ID, and count can be omitted (defaults to 1).",
      };
    case 3:
      return {
        title: "Field 3 – Big craftable flag",
        description:
          "`true` if the product is a big craftable, otherwise `false`.",
      };
    case 4:
      return {
        title: "Field 4 – Unlock conditions",
        description:
          "Unlock rule: `s <skill> <level>` for skill level, `default` for auto-learned, or any other value for custom/event unlocks.",
      };
    case 5:
      return {
        title: "Field 5 – Display name",
        description:
          "Optional name shown in-game. If omitted or `null`, defaults to the display name of the first product.",
      };
    default:
      return {
        title: `Field ${index}`,
        description: "This index is not normally used for crafting recipes.",
      };
  }
}

function appendFieldSummaryLines(lines: string[], kind: RecipeKind): void {
  lines.push("");
  lines.push("**Field layout**");

  if (kind === "cooking") {
    lines.push("- `0`: Ingredients – `<itemID> <count>` ...");
    lines.push("- `1`: Unused number pair (ignored by the game)");
    lines.push("- `2`: Yield – `<itemID> <count>` ...");
    lines.push(
      "- `3`: Unlock – `f <NPC> <hearts>`, `s <skill> <level>`, `default`, or custom"
    );
    lines.push("- `4`: Display name (optional)");
  } else {
    lines.push("- `0`: Ingredients – `<itemID> <count>` ...");
    lines.push("- `1`: Home/Field (ignored by the game)");
    lines.push("- `2`: Yield – `<itemID> <count>` ...");
    lines.push("- `3`: Big craftable flag (`true`/`false`)");
    lines.push("- `4`: Unlock – `s <skill> <level>`, `default`, or custom");
    lines.push("- `5`: Display name (optional)");
  }
}

/* ------------------------------------------------------------------------- */
/*  Parsing + labels                                                         */
/* ------------------------------------------------------------------------- */

function labelForItemId(
  rawId: string,
  resolvedId: string,
  lookups: ItemLookup,
  preferBigCraftable: boolean = false
): string {
  const rawTrimmed = rawId.trim();
  const resolvedTrimmed = resolvedId.trim();
  if (!rawTrimmed) return rawId;

  const resolved = resolveStrictItemEntry(
    resolvedTrimmed,
    lookups,
    preferBigCraftable
  );

  if (resolved.categoryLabel && resolved.normalizedId) {
    return `${resolved.categoryLabel} (\`${resolved.normalizedId}\`)`;
  }

  if (resolved.entry) {
    // Show the display name + the raw token in parentheses (matches your “left side keeps {{ModId}}” goal)
    return `${resolved.entry.name} (\`${rawTrimmed}\`)`;
  }

  if (isPlaceholderToken(rawTrimmed)) {
    return `${placeholderDisplayName(rawTrimmed)} (\`${rawTrimmed}\`)`;
  }

  return rawTrimmed;
}

function parseIngredientList(
  document: vscode.TextDocument,
  text: string | undefined,
  lookups: ItemLookup,
  preferBigCraftable: boolean = false
): ParsedIngredient[] {
  if (!text) return [];

  const tokens = text.trim().split(/\s+/);
  const result: ParsedIngredient[] = [];

  for (let i = 0; i < tokens.length; i += 2) {
    const idTokenRaw = tokens[i];
    if (!idTokenRaw) break;

    const idTokenResolved = resolveModIdPlaceholders(idTokenRaw, document);

    const qtyToken = tokens[i + 1];
    const qty = qtyToken ? Number(qtyToken) || 1 : 1;

    result.push({
      rawId: idTokenRaw,
      resolvedId: idTokenResolved,
      quantity: qty,
      label: labelForItemId(
        idTokenRaw,
        idTokenResolved,
        lookups,
        preferBigCraftable
      ),
    });
  }

  return result;
}

function parseUnlockDescription(
  raw: string | undefined,
  kind: RecipeKind
): string | undefined {
  if (!raw) return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (trimmed === "default") return "Learned automatically (`default`).";

  const parts = trimmed.split(/\s+/);
  if (!parts.length) return undefined;

  const code = parts[0];

  if (code === "f" && kind === "cooking" && parts.length >= 3) {
    const npc = parts[1];
    const hearts = parts[2];
    return `Friendship: ${npc} (${hearts} hearts).`;
  }

  if (code === "s" && parts.length >= 3) {
    const skill = parts[1];
    const level = parts[2];
    return `Skill: ${skill} level ${level}.`;
  }

  return `Unlocked via: \`${trimmed}\`.`;
}

function parseFullRecipeString(
  document: vscode.TextDocument,
  raw: string,
  kind: RecipeKind,
  lookups: ItemLookup
): ParsedRecipe | null {
  const parts = raw.split("/");
  if (parts.length < 3) return null;

  const ingredientsPart = parts[0]?.trim() ?? "";
  const yieldPart = parts[2]?.trim() ?? "";

  let bigFlag = false;
  let unlockPart: string | undefined;
  let displayName: string | undefined;

  if (kind === "cooking") {
    unlockPart = parts[3]?.trim();
    displayName = parts[4]?.trim();
  } else {
    bigFlag = parts[3]?.trim().toLowerCase() === "true";
    unlockPart = parts[4]?.trim();
    displayName = parts[5]?.trim();
  }

  const ingredients = parseIngredientList(
    document,
    ingredientsPart,
    lookups,
    false
  );
  const outputs = parseIngredientList(document, yieldPart, lookups, bigFlag);
  const unlockSummary = parseUnlockDescription(unlockPart, kind);

  return {
    kind,
    ingredients,
    outputs,
    unlockSummary,
    isBigCraftable: bigFlag,
    displayName,
  };
}

/* ------------------------------------------------------------------------- */
/*  Embedded item-info blocks (mockup style)                                 */
/* ------------------------------------------------------------------------- */

function appendEmbeddedItemInfo(
  lines: string[],
  document: vscode.TextDocument,
  rawId: string,
  lookups: ItemLookup,
  preferBigCraftable: boolean,
  indent: string
): void {
  const rawTrimmed = rawId.trim();
  if (!rawTrimmed) return;

  const resolvedId = resolveModIdPlaceholders(rawTrimmed, document);

  // Category IDs
  if (isNumericLike(resolvedId)) {
    const n = Number(resolvedId);
    if (Number.isFinite(n) && n < 0 && CATEGORY_LABELS[n]) {
      lines.push(`${indent}- Category: \`objects\``);
      lines.push(`${indent}- ID: \`${rawTrimmed}\``);
      return;
    }
  }

  // Placeholder tokens like __INGREDIENT__
  if (isPlaceholderToken(rawTrimmed)) {
    lines.push(`${indent}- ID: \`${rawTrimmed}\``);
    lines.push(
      `${indent}- Qualified ID: Use the qualified ID - \`(O)item\` or \`(BC)item\``
    );
    lines.push(`${indent}- Category: \`objects\``);
    lines.push(`${indent}- Mod: \`Vanilla\``);
    lines.push(`${indent}- Source: \`vanilla\``);
    return;
  }

  const resolved = resolveStrictItemEntry(
    resolvedId,
    lookups,
    preferBigCraftable
  );

  if (resolved.categoryLabel && resolved.normalizedId) {
    lines.push(`${indent}- ID: \`${rawTrimmed}\``);
    lines.push(`${indent}- Qualified ID: \`${rawTrimmed}\``);
    lines.push(`${indent}- Category: \`objects\``);
    lines.push(`${indent}- Mod: \`Vanilla\``);
    lines.push(`${indent}- Source: \`vanilla\``);
    return;
  }

  if (!resolved.entry) {
    lines.push(`${indent}- ID: \`${rawTrimmed}\``);
    lines.push(`${indent}- Qualified ID: \`${rawTrimmed}\``);
    lines.push(`${indent}- Category: \`unknown\``);
    lines.push(`${indent}- Mod: \`unknown\``);
    lines.push(`${indent}- Source: \`unknown\``);
    return;
  }

  const e = resolved.entry;

  // IMPORTANT: show the resolved item info (this is what fixes {{ModId}} packs)
  lines.push(`${indent}- ID: \`${e.id}\``);
  lines.push(`${indent}- Qualified ID: \`${e.qualifiedId}\``);
  lines.push(`${indent}- Category: \`${e.category}\``);
  lines.push(`${indent}- Mod: \`${e.modId}\``);
  lines.push(`${indent}- Source: \`${e.source}\``);
}

function appendIngredientBlock(
  lines: string[],
  document: vscode.TextDocument,
  ing: ParsedIngredient,
  lookups: ItemLookup,
  preferBigCraftable: boolean
): void {
  // - 1 × Nectar
  //   - ID: ...
  lines.push(
    `- ${ing.quantity} × ${ing.label.replace(/\s*\(`.+?`\)\s*$/, "")}`
  );
  appendEmbeddedItemInfo(
    lines,
    document,
    ing.rawId,
    lookups,
    preferBigCraftable,
    "  "
  );
}

/* ------------------------------------------------------------------------- */
/*  Full/per-field recipe hovers                                             */
/* ------------------------------------------------------------------------- */

function buildFullRecipeHover(
  document: vscode.TextDocument,
  node: JsonAstNode,
  kind: RecipeKind,
  raw: string,
  lookups: ItemLookup
): vscode.Hover {
  const parsed = parseFullRecipeString(document, raw, kind, lookups);
  const lines: string[] = [];

  lines.push(
    `**${kind === "cooking" ? "Cooking recipe" : "Crafting recipe"}**`
  );

  if (parsed && parsed.displayName && parsed.displayName !== "null") {
    lines.push("");
    lines.push(`Display name: \`${parsed.displayName}\``);
  }

  if (parsed && parsed.ingredients.length) {
    lines.push("");
    lines.push("**Ingredients**");
    for (const ing of parsed.ingredients) {
      appendIngredientBlock(lines, document, ing, lookups, false);
    }
  }

  if (parsed && parsed.outputs.length) {
    lines.push("");
    lines.push("**Yields**");
    for (const out of parsed.outputs) {
      appendIngredientBlock(
        lines,
        document,
        out,
        lookups,
        !!parsed.isBigCraftable
      );
    }
  }

  if (parsed && parsed.unlockSummary) {
    lines.push("");
    lines.push("**Unlock**");
    lines.push(`- ${parsed.unlockSummary}`);
  }

  if (!parsed) {
    lines.push("");
    lines.push(`Raw recipe string: \`${raw}\``);
  }

  appendFieldSummaryLines(lines, kind);

  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = false;

  const range = new vscode.Range(
    document.positionAt(node.offset),
    document.positionAt(node.offset + node.length)
  );
  return new vscode.Hover(md, range);
}

function buildPerFieldRecipeHover(
  document: vscode.TextDocument,
  node: JsonAstNode,
  kind: RecipeKind,
  raw: string,
  fieldIndex: number,
  lookups: ItemLookup
): vscode.Hover {
  const trimmed = raw.trim();
  const lines: string[] = [];

  lines.push(
    `**${
      kind === "cooking" ? "Cooking" : "Crafting"
    } recipe – field ${fieldIndex}**`
  );

  if (!trimmed) {
    lines.push("");
    lines.push("_(empty value)_");
  } else {
    if (fieldIndex === 0 || fieldIndex === 2) {
      const isYield = fieldIndex === 2;
      const preferBig = kind === "crafting" && isYield;
      const list = parseIngredientList(document, trimmed, lookups, preferBig);

      lines.push("");
      lines.push(isYield ? "**Yield**" : "**Ingredients**");

      if (list.length) {
        for (const ing of list) {
          appendIngredientBlock(lines, document, ing, lookups, preferBig);
        }
      } else {
        lines.push(`Raw value: \`${trimmed}\``);
      }
    } else if (
      (kind === "cooking" && fieldIndex === 3) ||
      (kind === "crafting" && fieldIndex === 4)
    ) {
      const unlockSummary = parseUnlockDescription(trimmed, kind);
      lines.push("");
      lines.push("**Unlock**");
      if (unlockSummary) lines.push(`- ${unlockSummary}`);
      else lines.push(`Raw value: \`${trimmed}\``);
    } else if (kind === "crafting" && fieldIndex === 3) {
      const lower = trimmed.toLowerCase();
      const isTrue = lower === "true";
      const isFalse = lower === "false";

      lines.push("");
      lines.push("**Big craftable flag**");
      if (isTrue) lines.push("- `true` → product is a big craftable.");
      else if (isFalse) lines.push("- `false` → product is a regular object.");
      else
        lines.push(
          `Raw value: \`${trimmed}\` (expected \`true\` or \`false\`).`
        );
    } else {
      lines.push("");
      lines.push("**Value**");
      lines.push(`\`${trimmed}\``);
    }
  }

  const info = getRecipeFieldInfo(kind, fieldIndex);

  lines.push("");
  lines.push("**Field info**");
  lines.push(`- ${info.title}`);
  lines.push(`- ${info.description}`);

  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = false;

  const range = new vscode.Range(
    document.positionAt(node.offset),
    document.positionAt(node.offset + node.length)
  );
  return new vscode.Hover(md, range);
}

/* ------------------------------------------------------------------------- */
/*  Main hover selection                                                     */
/* ------------------------------------------------------------------------- */

function buildRecipeHoverForNode(
  document: vscode.TextDocument,
  node: JsonAstNode,
  lookups: ItemLookup
): vscode.Hover | null {
  if (node.type !== "string") return null;

  const kind = findRecipeKindForNode(node, document);
  if (!kind) return null;

  const raw = String(node.value ?? "");
  const trimmed = raw.trim();

  const fieldIndex = getRecipeFieldIndex(node);
  const isFull = isFullRecipeStringNode(node, document, kind);

  if (isFull && trimmed) {
    return buildFullRecipeHover(document, node, kind, trimmed, lookups);
  }

  if (fieldIndex !== null) {
    return buildPerFieldRecipeHover(
      document,
      node,
      kind,
      raw,
      fieldIndex,
      lookups
    );
  }

  return null;
}

export function buildRecipeHoverAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  lookups: ItemLookup
): vscode.Hover | null {
  try {
    const text = document.getText();
    const root = parseTree(text) as JsonAstNode | undefined;
    if (!root) return null;

    const offset = document.offsetAt(position);
    const node = findNodeAtOffset(root as any, offset) as
      | JsonAstNode
      | undefined;
    if (!node) return null;

    // If we’re on a property, jump to its value so hovering on `"key": "value"` works.
    if (
      node.type === "property" &&
      node.children &&
      node.children.length >= 2 &&
      node.children[1].type === "string"
    ) {
      return buildRecipeHoverForNode(document, node.children[1], lookups);
    }

    return buildRecipeHoverForNode(document, node, lookups);
  } catch {
    return null;
  }
}

export function registerRecipeHoverSupport(
  _context: vscode.ExtensionContext,
  lookups: ItemLookup
): vscode.Disposable {
  const selector: vscode.DocumentSelector = [
    { pattern: "**/*.json" },
    { pattern: "!**/manifest.json" },
  ];

  return vscode.languages.registerHoverProvider(selector, {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
      return buildRecipeHoverAtPosition(document, position, lookups);
    },
  });
}

// src/itemHover.ts
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

/* ------------------------------------------------------------------------- */
/*  AST helpers                                                              */
/* ------------------------------------------------------------------------- */

function stripCpPrefix(value: string): string {
  return value.replace(/^\([A-Za-z]+\)/, "");
}

function findEnclosingProperty(node: JsonAstNode): JsonAstNode | null {
  let current: JsonAstNode | undefined = node;
  while (current) {
    if (current.type === "property") return current;
    current = current.parent;
  }
  return null;
}

/**
 * True if this string node is the VALUE side of a JSON property.
 * (We use this to let itemHover still own the recipe key on the left.)
 */
function isPropertyValueStringNode(node: JsonAstNode): boolean {
  if (node.type !== "string") return false;
  const prop = node.parent;
  if (
    !prop ||
    prop.type !== "property" ||
    !prop.children ||
    prop.children.length < 2
  )
    return false;
  return prop.children[1] === node;
}

/**
 * Determine whether this node is inside an UnlockableBundles context.
 * We walk up the tree looking for a property "Target": "UnlockableBundles/..."
 */
function isUnderUnlockableBundles(node: JsonAstNode): boolean {
  let current: JsonAstNode | undefined = node;
  while (current) {
    if (
      current.type === "property" &&
      current.children &&
      current.children.length >= 2
    ) {
      const keyNode = current.children[0];
      const valueNode = current.children[1];

      if (
        keyNode.type === "string" &&
        keyNode.value === "Target" &&
        valueNode.type === "string"
      ) {
        const targetVal = String(valueNode.value ?? "");
        if (targetVal.startsWith("UnlockableBundles/")) return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/* ------------------------------------------------------------------------- */
/*  Recipe-context detection (so we don't double-hover with recipeHover.ts)  */
/* ------------------------------------------------------------------------- */

function findRecipeKindForNode(
  node: JsonAstNode,
  document: vscode.TextDocument
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

        // Direct Target
        if (keyName === "Target" && valueNode.type === "string") {
          const target = String(valueNode.value ?? "");
          if (target === "Data/CookingRecipes") return "cooking";
          if (target === "Data/CraftingRecipes") return "crafting";
        }

        // CP style: sibling Target in same object
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
                const t = String(cVal.value ?? "");
                if (t === "Data/CookingRecipes") return "cooking";
                if (t === "Data/CraftingRecipes") return "crafting";
              }
            }
          }
        }
      }
    }

    current = current.parent;
  }

  // Direct Data files fallback
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

  return null;
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
          // Ensure we're inside Fields
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

function isFullRecipeStringNode(node: JsonAstNode): boolean {
  const propNode = node.parent;
  if (
    !propNode ||
    propNode.type !== "property" ||
    !propNode.children ||
    propNode.children.length < 2
  )
    return false;

  // Must be the VALUE node, not the key.
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

  // Direct Data file root-level property value string
  if (!parentObj.parent) return true;

  return false;
}

/**
 * True if THIS string node is one recipeHover should own.
 * (Fields 0/2 strings or full recipe strings inside cooking/crafting contexts.)
 *
 * IMPORTANT: we only hand off VALUE-side strings, so itemHover can still own recipe keys.
 */
function isRecipeOwnedString(
  node: JsonAstNode,
  document: vscode.TextDocument
): boolean {
  const kind = findRecipeKindForNode(node, document);
  if (!kind) return false;

  // Only hand off VALUE strings.
  if (!isPropertyValueStringNode(node)) return false;

  const fieldIndex = getRecipeFieldIndex(node);
  if (fieldIndex === 0 || fieldIndex === 2) return true;

  if (isFullRecipeStringNode(node)) return true;

  return false;
}

/* ------------------------------------------------------------------------- */
/*  Token extraction (restored: keys + strings + numbers)                     */
/* ------------------------------------------------------------------------- */

interface ItemTokenInfo {
  token: string; // normalized token for direct lookup
  raw: string; // original raw string value
  range: vscode.Range;
  node: JsonAstNode;
  manifestId: string | null; // manifest UniqueID if we resolved {{ModId}}, otherwise null
}

/**
 * Extract the "item-ish" token under the cursor.
 * Works on:
 *  - property keys
 *  - string values
 *  - numeric values (with smart skipping)
 */
function getItemTokenAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): ItemTokenInfo | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const root = parseTree(text) as JsonAstNode | undefined;
  if (!root) return null;

  const node = findNodeAtOffset(root as any, offset) as JsonAstNode | undefined;
  if (!node) return null;

  let targetNode: JsonAstNode | undefined;

  // 1) Property: use its key
  if (node.type === "property" && node.children && node.children.length > 0) {
    targetNode = node.children[0];
  }
  // 2) Direct string/number value
  else if (node.type === "string" || node.type === "number") {
    targetNode = node;
  }
  // 3) Child that *is* the key of its property parent
  else if (
    node.parent &&
    node.parent.type === "property" &&
    node.parent.children &&
    node.parent.children[0] === node
  ) {
    targetNode = node;
  }

  if (!targetNode) return null;
  if (targetNode.type !== "string" && targetNode.type !== "number") return null;

  // If this is a numeric value under certain keys, we skip hover entirely (unless UB).
  if (targetNode.type === "number") {
    const propNode = findEnclosingProperty(targetNode);
    if (propNode && propNode.children && propNode.children.length >= 2) {
      const keyNode = propNode.children[0];
      if (keyNode.type === "string") {
        const keyName = String(keyNode.value ?? "");
        const isUbContext = isUnderUnlockableBundles(propNode);

        if (
          !isUbContext &&
          (keyName === "Category" ||
            keyName === "Price" ||
            keyName === "SpriteIndex" ||
            keyName === "RequiredCount" ||
            keyName === "MinutesUntilReady" ||
            keyName === "MinStack" ||
            keyName.startsWith("selph.ExtraMachineConfig.RequirementCount"))
        ) {
          return null;
        }
      }
    }
  }

  const rawValue = String(targetNode.value ?? "").trim();
  if (!rawValue) return null;

  // Ignore pure i18n-style tokens like "{{i18n:Key}}"
  if (/^\{\{[^}]+:[^}]+\}\}$/.test(rawValue)) return null;

  let token = rawValue;
  let manifestId: string | null = null;

  // Resolve {{ModId}} / {{ModID}} early, for both keys and values.
  if (
    /\{\{\s*ModId\s*\}\}/i.test(token) ||
    /\{\{\s*ModID\s*\}\}/i.test(token)
  ) {
    manifestId = getManifestUniqueIdForDocument(document);
    if (manifestId) {
      token = token
        .replace(/\{\{\s*ModID\s*\}\}/gi, manifestId)
        .replace(/\{\{\s*ModId\s*\}\}/gi, manifestId);
    }
  }

  // Handle "(O)388 2" or "388 1": only split if token starts with digits.
  if (/\s/.test(token) && /^[0-9]+(\s+|$)/.test(token)) {
    token = token.split(/\s+/)[0];
  }

  // Handle "Something:Else" formats by keeping the left part (matches older behavior)
  if (token.includes(":")) {
    token = token.split(":")[0];
  }

  const start = document.positionAt(targetNode.offset);
  const end = document.positionAt(targetNode.offset + targetNode.length);
  return {
    token,
    raw: rawValue,
    range: new vscode.Range(start, end),
    node: targetNode,
    manifestId,
  };
}

/* ------------------------------------------------------------------------- */
/*  Matching (mostly strict; limited ModId-suffix fallback only when needed)  */
/* ------------------------------------------------------------------------- */

function resolveStrictMatches(
  token: string,
  lookups: ItemLookup
): ItemEntry[] | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // 1) exact qualifiedId
  const q = lookups.byQualifiedId.get(trimmed);
  if (q) return [q];

  const dynamic = lookups as unknown as {
    byId?: Map<string, ItemEntry[]>;
    byName?: Map<string, ItemEntry[]>;
  };

  // 2) exact bare id
  if (dynamic.byId) {
    const arr = dynamic.byId.get(trimmed);
    if (arr && arr.length) return arr;
  }

  // 3) numeric convenience
  if (/^[0-9]+$/.test(trimmed)) {
    const hit =
      lookups.byQualifiedId.get(`(O)${trimmed}`) ||
      lookups.byQualifiedId.get(`(BC)${trimmed}`) ||
      lookups.byQualifiedId.get(trimmed);

    if (hit) return [hit];
  }

  // 4) exact name (case-insensitive)
  if (dynamic.byName) {
    const arr = dynamic.byName.get(trimmed.toLowerCase());
    if (arr && arr.length) return arr;
  }

  // 5) non-numeric convenience: exact "(O)token"/"(BC)token"
  const q2 =
    lookups.byQualifiedId.get(`(O)${trimmed}`) ||
    lookups.byQualifiedId.get(`(BC)${trimmed}`);
  if (q2) return [q2];

  return null;
}

/**
 * Limited fallback for {{ModId}} placeholder keys when mod ids contain dots/underscores
 * and the token isn't resolvable by strict maps.
 *
 * This is intentionally NOT general fuzzy matching.
 * It only runs when the *raw* text contained {{ModId}}/{{ModID}} (pre-resolve).
 */
function resolveModIdSuffixFallback(
  raw: string,
  lookups: ItemLookup
): ItemEntry[] | null {
  if (!(/\{\{ModId\}\}/i.test(raw) || /\{\{ModID\}\}/i.test(raw))) return null;

  const allEntries: ItemEntry[] = Array.from(lookups.byQualifiedId.values());

  let suffix = raw
    .replace(/\{\{\s*ModID\s*\}\}/gi, "")
    .replace(/\{\{\s*ModId\s*\}\}/gi, "")
    .trim();

  if (/\s/.test(suffix)) suffix = suffix.split(/\s+/)[0];

  // Drop leading "_" or "." after removing {{ModId}}
  suffix = suffix.replace(/^[._]/, "");

  const suffixBody = stripCpPrefix(suffix).toLowerCase();
  if (!suffixBody) return null;

  const matches = allEntries.filter((e) => {
    const idBody = stripCpPrefix(e.id).toLowerCase();
    const qBody = stripCpPrefix(e.qualifiedId).toLowerCase();
    return idBody.endsWith(suffixBody) || qBody.endsWith(suffixBody);
  });

  return matches.length ? matches : null;
}

/* ------------------------------------------------------------------------- */
/*  Registration                                                             */
/* ------------------------------------------------------------------------- */

export function registerItemHoverSupport(
  _context: vscode.ExtensionContext,
  lookups: ItemLookup
): vscode.Disposable {
  // Match ANY json anywhere.
  const selector: vscode.DocumentSelector = [
    { pattern: "**/*.json" },
    { pattern: "!**/manifest.json" },
  ];

  return vscode.languages.registerHoverProvider(selector, {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
      try {
        const info = getItemTokenAtPosition(document, position);
        if (!info) return;

        // If recipeHover should own this VALUE string (Fields 0/2 or full recipe strings), bail.
        if (
          info.node.type === "string" &&
          isRecipeOwnedString(info.node, document)
        )
          return;

        const { token, raw, range } = info;

        // Category hover for negative IDs
        if (/^-?[0-9]+$/.test(token.trim())) {
          const n = Number(token.trim());
          if (Number.isFinite(n) && n < 0 && CATEGORY_LABELS[n]) {
            const md = new vscode.MarkdownString(
              `**${CATEGORY_LABELS[n]}**\n\n- Category ID: \`${token.trim()}\``
            );
            md.isTrusted = false;
            return new vscode.Hover(md, range);
          }
        }

        // Strict matches first
        let entries = resolveStrictMatches(token, lookups);

        // Limited fallback only for raw {{ModId}} tokens
        if (!entries) {
          entries = resolveModIdSuffixFallback(raw, lookups);
        }

        if (!entries || !entries.length) return;

        const md = new vscode.MarkdownString();

        if (entries.length === 1) {
          const e = entries[0];
          md.appendMarkdown(`**${e.name}**  \n\n`);
          md.appendMarkdown(`- ID: \`${e.id}\`\n`);
          md.appendMarkdown(`- Qualified ID: \`${e.qualifiedId}\`\n`);
          md.appendMarkdown(`- Category: \`${e.category}\`\n`);
          md.appendMarkdown(`- Mod: \`${e.modId}\`\n`);
          md.appendMarkdown(`- Source: \`${e.source}\`\n`);
        } else {
          md.appendMarkdown(`**${token}**\n\nMatches:\n`);
          for (const e of entries.slice(0, 25)) {
            md.appendMarkdown(
              `- \`${e.qualifiedId}\` • ${e.name} • ID \`${e.id}\` • ${e.category} • ${e.source} (${e.modId})\n`
            );
          }
          if (entries.length > 25) {
            md.appendMarkdown(`\n_+${entries.length - 25} more_\n`);
          }
        }

        md.isTrusted = false;
        return new vscode.Hover(md, range);
      } catch {
        return;
      }
    },
  });
}

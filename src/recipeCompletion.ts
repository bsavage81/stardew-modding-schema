// src/recipeCompletion.ts
import * as vscode from "vscode";
import { parseTree, findNodeAtOffset } from "jsonc-parser";
import { ItemEntry, ItemLookup } from "./stardewIds";
import {
  buildSharedItemCompletionState,
  buildItemIdCompletionsForToken,
  DEFAULT_INGREDIENT_PLACEHOLDER,
} from "./__itemCompletionShared";

type RecipeKind = "cooking" | "crafting";

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

// Placeholder trigger (you asked for this)
const INGREDIENT_PLACEHOLDER = DEFAULT_INGREDIENT_PLACEHOLDER;

/* ------------------------------------------------------------------------- */
/*  Shared helpers                                                           */
/* ------------------------------------------------------------------------- */

function stripCpPrefix(value: string): string {
  return value.replace(/^\([A-Za-z]+\)/, "");
}

function escapeForSnippet(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/\}/g, "\\}");
}

/* ------------------------------------------------------------------------- */
/*  AST helpers                                                              */
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

        if (keyName === "Target" && valueNode.type === "string") {
          const target = String(valueNode.value ?? "");
          if (target === "Data/CookingRecipes") return "cooking";
          if (target === "Data/CraftingRecipes") return "crafting";
        }

        // Look for sibling Target if we are inside Entries/Data/Fields under a patch object
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

  // Fallback: vanilla game data files
  const fullPath = document.uri.fsPath.replace(/\\/g, "/").toLowerCase();
  if (
    fullPath.endsWith("/data/cookingrecipes.json") ||
    fullPath.endsWith("cookingrecipes.json")
  ) {
    return "cooking";
  }
  if (
    fullPath.endsWith("/data/craftingrecipes.json") ||
    fullPath.endsWith("craftingrecipes.json")
  ) {
    return "crafting";
  }

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

function isFullRecipeStringNodeForCompletion(
  node: JsonAstNode,
  document: vscode.TextDocument,
  kind: RecipeKind | null
): boolean {
  const propNode = node.parent;
  if (
    !propNode ||
    propNode.type !== "property" ||
    !propNode.children ||
    propNode.children.length < 2
  ) {
    return false;
  }

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

  // If it's a top-level object in a vanilla data file
  if (kind && !parentObj.parent) {
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

function isRecipeItemStringContext(
  node: JsonAstNode,
  document: vscode.TextDocument
): boolean {
  const kind = findRecipeKindForNode(node, document);
  if (!kind) return false;

  // CP Recipes field usage:
  // - Fields[0] ingredient string (cp)
  // - Fields[2] yield string (cp)
  const fieldIndex = getRecipeFieldIndex(node);
  if (fieldIndex === 0 || fieldIndex === 2) return true;

  // Vanilla-style full recipe string (value in Entries/Data)
  if (isFullRecipeStringNodeForCompletion(node, document, kind)) return true;

  return false;
}

function getStringNodeAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): JsonAstNode | null {
  const text = document.getText();
  const root = parseTree(text) as JsonAstNode | undefined;
  if (!root) return null;

  const offset = document.offsetAt(position);
  const node = findNodeAtOffset(root as any, offset) as JsonAstNode | undefined;
  if (!node) return null;

  if (
    node.type === "property" &&
    node.children &&
    node.children.length >= 2 &&
    node.children[1].type === "string"
  ) {
    return node.children[1];
  }

  if (node.type === "string") return node;

  return null;
}

function getRecipeKeyForStringNode(node: JsonAstNode): string | undefined {
  const propNode = node.parent;
  if (
    !propNode ||
    propNode.type !== "property" ||
    !propNode.children ||
    propNode.children.length < 2
  ) {
    return undefined;
  }

  const keyNode = propNode.children[0];
  if (keyNode.type !== "string") return undefined;

  const keyName = String(keyNode.value ?? "");
  if (/^[0-9]+$/.test(keyName)) return undefined;

  return keyName;
}

/* ------------------------------------------------------------------------- */
/*  Display/yield defaults                                                   */
/* ------------------------------------------------------------------------- */

function findBestItemEntryForRecipeKey(
  recipeKey: string | undefined,
  lookups: ItemLookup
): ItemEntry | undefined {
  if (!recipeKey) return undefined;

  const anyLookups = lookups as unknown as {
    byId?: Map<string, ItemEntry[]>;
    byName?: Map<string, ItemEntry[]>;
  };

  const allEntries: ItemEntry[] = Array.from(lookups.byQualifiedId.values());

  // If recipeKey includes {{ModId}} tokens, try suffix matching
  if (
    /\{\{\s*ModId\s*\}\}/i.test(recipeKey) ||
    /\{\{\s*ModID\s*\}\}/i.test(recipeKey)
  ) {
    let suffix = recipeKey
      .replace(/\{\{\s*ModID\s*\}\}/gi, "")
      .replace(/\{\{\s*ModId\s*\}\}/gi, "")
      .trim();

    suffix = suffix.replace(/^[._]/, "");
    const suffixBody = stripCpPrefix(suffix).toLowerCase();

    if (suffixBody.length > 0) {
      const match = allEntries.find((e) => {
        const idBody = stripCpPrefix(e.id).toLowerCase();
        const qBody = stripCpPrefix(e.qualifiedId).toLowerCase();
        return idBody.endsWith(suffixBody) || qBody.endsWith(suffixBody);
      });
      if (match) return match;
    }
  }

  const q = lookups.byQualifiedId.get(recipeKey);
  if (q) return q;

  if (anyLookups.byId) {
    const arr = anyLookups.byId.get(recipeKey);
    if (arr && arr.length) return arr[0];
  }

  if (anyLookups.byName) {
    const arr = anyLookups.byName.get(recipeKey.toLowerCase());
    if (arr && arr.length) return arr[0];
  }

  const tail = recipeKey.split(/[._]/).pop() ?? recipeKey;
  if (tail && tail !== recipeKey) {
    if (anyLookups.byId) {
      const arr = anyLookups.byId.get(tail);
      if (arr && arr.length) return arr[0];
    }
    if (anyLookups.byName) {
      const arr = anyLookups.byName.get(tail.toLowerCase());
      if (arr && arr.length) return arr[0];
    }
  }

  return undefined;
}

function deriveProductIdFromKey(
  recipeKey: string | undefined,
  lookups?: ItemLookup
): string {
  if (!recipeKey) return "";

  if (
    /\{\{\s*ModId\s*\}\}/i.test(recipeKey) ||
    /\{\{\s*ModID\s*\}\}/i.test(recipeKey)
  ) {
    return recipeKey;
  }

  if (lookups) {
    const matched = findBestItemEntryForRecipeKey(recipeKey, lookups);
    if (matched && matched.id && String(matched.id).trim().length > 0) {
      return String(matched.id).trim();
    }
  }

  return recipeKey;
}

function deriveDisplayNameFromKey(
  recipeKey: string | undefined,
  _kind: RecipeKind,
  lookups?: ItemLookup
): string {
  if (recipeKey && lookups) {
    const matched = findBestItemEntryForRecipeKey(recipeKey, lookups);
    if (matched && matched.name && matched.name.trim().length > 0) {
      return matched.name.trim();
    }
  }

  if (!recipeKey) return "";

  let base = recipeKey;
  const split = base.split(/[._]/);
  base = split[split.length - 1];
  base = base.replace(/_/g, " ");
  base = base.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  return base || "";
}

/* ------------------------------------------------------------------------- */
/*  Snippet helpers                                                          */
/* ------------------------------------------------------------------------- */

function makeSnippet(
  label: string,
  detail: string,
  insertText: string,
  documentation?: string
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    label,
    vscode.CompletionItemKind.Snippet
  );
  item.detail = detail;
  item.insertText = new vscode.SnippetString(insertText);
  if (documentation) item.documentation = new vscode.MarkdownString(documentation);
  return item;
}

function buildUnlockCompletions(kind: RecipeKind): vscode.CompletionItem[] {
  const docHeader =
    kind === "cooking"
      ? "**Cooking recipe unlock field** (field 3)\n\n"
      : "**Crafting recipe unlock field** (field 4)\n\n";

  return [
    makeSnippet(
      "default",
      "Unlock: learned automatically",
      "default",
      docHeader + "- `default`: recipe is learned automatically."
    ),
    makeSnippet(
      "f <NPC> <hearts>",
      "Unlock: friendship letter from NPC at hearts",
      "f ${1:NPCName} ${2:4}",
      docHeader + "- `f <NPC> <hearts>`: friendship letter unlock."
    ),
    makeSnippet(
      "s <skill> <level>",
      "Unlock: skill level",
      "s ${1:Farming} ${2:3}",
      docHeader + "- `s <skill> <level>`: skill level unlock."
    ),
  ];
}

function buildBigCraftableFlagCompletions(): vscode.CompletionItem[] {
  return [
    makeSnippet("true", "Product is a big craftable", "true"),
    makeSnippet("false", "Product is a regular object", "false"),
  ];
}

function buildIngredientOrYieldCompletions(
  kind: RecipeKind,
  fieldIndex: number
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  const isYield = fieldIndex === 2;

  if (isYield) {
    items.push(
      makeSnippet(
        "Yield template",
        "Template: itemID count [itemID count ...]",
        "${1:194} ${2:1}",
        `**${kind === "cooking" ? "Cooking" : "Crafting"} recipe field 2**\n\n- Yield: \`<itemID> <count>\`...`
      )
    );
  } else {
    // Keep the handy common-case snippet, but do NOT block other categories
    items.push(
      makeSnippet(
        "Ingredient – object (O)",
        "Start ingredient with (O) prefix",
        "(O)${1:388} ${2:1}"
      )
    );

    // Explicit placeholder trigger (so you can tab to it and then get ID suggestions)
    items.push(
      makeSnippet(
        INGREDIENT_PLACEHOLDER,
        `Ingredient placeholder trigger (“${INGREDIENT_PLACEHOLDER}”)`,
        INGREDIENT_PLACEHOLDER
      )
    );
  }

  return items;
}

/**
 * Full recipe skeleton snippets
 * - Ingredients default to (O) because it's the most common
 * - We still allow other categories when editing (BC/W/etc)
 * - Uses INGREDIENT_PLACEHOLDER so the shared completion builder can “wake up” on it.
 */
function buildFullRecipeCompletions(
  kind: RecipeKind,
  recipeKey: string | undefined,
  lookups: ItemLookup
): vscode.CompletionItem[] {
  const displayNameDefault = escapeForSnippet(
    deriveDisplayNameFromKey(recipeKey, kind, lookups)
  );
  const productIdRaw = deriveProductIdFromKey(recipeKey, lookups);

  const defaultProductIdCooking = escapeForSnippet(productIdRaw || "194");
  const defaultProductIdCraftObject = escapeForSnippet(productIdRaw || "390");
  const defaultProductIdCraftBig = escapeForSnippet(productIdRaw || "335");

  const ingredientPrefix = "(O)";

  if (kind === "cooking") {
    const single = makeSnippet(
      "Cooking recipe – simple",
      "ingredients/25 5/yield/unlock/displayName",
      `${ingredientPrefix}\${1:${INGREDIENT_PLACEHOLDER}} \${2:1}/25 5/\${3:${defaultProductIdCooking}} \${4:1}/\${5:default}/\${6:${displayNameDefault}}`
    );
    single.command = { command: "editor.action.triggerSuggest", title: "Suggest" };

    const multi = makeSnippet(
      "Cooking recipe – multi ingredient",
      "multi-ingredient/25 5/yield/unlock/displayName",
      `${ingredientPrefix}\${1:${INGREDIENT_PLACEHOLDER}} \${2:1} ${ingredientPrefix}\${3:${INGREDIENT_PLACEHOLDER}} \${4:1} ${ingredientPrefix}\${5:${INGREDIENT_PLACEHOLDER}} \${6:1}/25 5/\${7:${defaultProductIdCooking}} \${8:1}/\${9:default}/\${10:${displayNameDefault}}`
    );
    multi.command = { command: "editor.action.triggerSuggest", title: "Suggest" };

    return [single, multi];
  }

  const objectOutput = makeSnippet(
    "Crafting recipe – object",
    "ingredients/Home/yield/false/unlock/displayName",
    `${ingredientPrefix}\${1:${INGREDIENT_PLACEHOLDER}} \${2:1} ${ingredientPrefix}\${3:${INGREDIENT_PLACEHOLDER}} \${4:1}/Home/\${5:${defaultProductIdCraftObject}} \${6:1}/false/\${7:default}/\${8:${displayNameDefault}}`
  );
  objectOutput.command = { command: "editor.action.triggerSuggest", title: "Suggest" };

  const bigOutput = makeSnippet(
    "Crafting recipe – big craftable",
    "ingredients/Home/yield/true/unlock/displayName",
    `${ingredientPrefix}\${1:${INGREDIENT_PLACEHOLDER}} \${2:1} ${ingredientPrefix}\${3:${INGREDIENT_PLACEHOLDER}} \${4:1}/Home/\${5:${defaultProductIdCraftBig}} \${6:1}/true/\${7:default}/\${8:${displayNameDefault}}`
  );
  bigOutput.command = { command: "editor.action.triggerSuggest", title: "Suggest" };

  return [objectOutput, bigOutput];
}

/* ------------------------------------------------------------------------- */
/*  Token parsing                                                            */
/* ------------------------------------------------------------------------- */

function getTokenRangeInString(
  str: string,
  index: number
): { start: number; end: number } {
  if (index < 0) index = 0;
  if (index > str.length) index = str.length;

  let start = index;
  while (start > 0 && !/[\s\/,]/.test(str[start - 1])) start--;

  let end = index;
  while (end < str.length && !/[\s\/,]/.test(str[end])) end++;

  return { start, end };
}

function getSegmentBounds(
  str: string,
  tokenStart: number,
  tokenEnd: number
): { segStart: number; segEnd: number } {
  let segStart = tokenStart;
  while (segStart > 0 && str[segStart - 1] !== "/") segStart--;

  let segEnd = tokenEnd;
  while (segEnd < str.length && str[segEnd] !== "/") segEnd++;

  return { segStart, segEnd };
}

function getTokenIndexInSegment(
  str: string,
  segStart: number,
  segEnd: number,
  tokenStart: number,
  tokenEnd: number
): number {
  let idx = 0;
  let i = segStart;

  while (i < segEnd) {
    while (i < segEnd && /[\s,]/.test(str[i])) i++;
    if (i >= segEnd) break;

    const start = i;
    while (i < segEnd && !/[\s,]/.test(str[i])) i++;
    const end = i;

    if (start === tokenStart && end === tokenEnd) return idx;
    idx++;
  }

  return -1;
}

/* ------------------------------------------------------------------------- */
/*  Trailing comma helper                                                    */
/* ------------------------------------------------------------------------- */

function attachTrailingCommaIfNeeded(
  document: vscode.TextDocument,
  node: JsonAstNode,
  item: vscode.CompletionItem
): void {
  const text = document.getText();
  const endOffset = node.offset + node.length;
  const len = text.length;

  let i = endOffset;
  let sawNonWs = false;

  while (i < len) {
    const ch = text[i];

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    sawNonWs = true;

    if (ch === ",") return;
    if (ch === "}" || ch === "]") return;

    break;
  }

  if (!sawNonWs && i >= len) return;

  const insertPos = document.positionAt(endOffset);
  const edit = new vscode.TextEdit(new vscode.Range(insertPos, insertPos), ",");

  if (!item.additionalTextEdits) item.additionalTextEdits = [];
  item.additionalTextEdits.push(edit);
}

/* ------------------------------------------------------------------------- */
/*  Dropdown completion provider                                             */
/* ------------------------------------------------------------------------- */

export function registerRecipeCompletionSupport(
  context: vscode.ExtensionContext,
  lookups: ItemLookup
): vscode.Disposable {
  // Must match itemCompletion’s chaining command name
  const triggerSuggestCmd = "stardewModdingSchema.triggerSuggestAfterInsert";

  // Register it here too (safe if already registered elsewhere; VS Code will throw)
  try {
    context.subscriptions.push(
      vscode.commands.registerCommand(triggerSuggestCmd, () => {
        setTimeout(() => {
          void vscode.commands.executeCommand("editor.action.triggerSuggest");
        }, 50);
      })
    );
  } catch {
    // ignore duplicate registration
  }

  const selector: vscode.DocumentSelector = [
    { pattern: "**/*.json" },
    { pattern: "**/*.jsonc" },
    { pattern: "!**/manifest.json" },
  ];

  // Shared item completion state (same ordering/filtering as itemCompletion)
  const sharedState = buildSharedItemCompletionState(lookups);

  const recipeProvider = vscode.languages.registerCompletionItemProvider(
    selector,
    {
      provideCompletionItems(document, position) {
        try {
          const stringNode = getStringNodeAtPosition(document, position);
          if (!stringNode) return;

          const kind = findRecipeKindForNode(stringNode, document);
          if (!kind) return;

          const fieldIndex = getRecipeFieldIndex(stringNode);
          const recipeKey = getRecipeKeyForStringNode(stringNode);
          const stringValue = String(stringNode.value ?? "");

          const snippetItems: vscode.CompletionItem[] = [];
          const idItems: vscode.CompletionItem[] = [];

          // Field-specific snippets
          if (fieldIndex !== null) {
            if (fieldIndex === 0 || fieldIndex === 2) {
              snippetItems.push(
                ...buildIngredientOrYieldCompletions(kind, fieldIndex)
              );
            }

            if (
              (kind === "cooking" && fieldIndex === 3) ||
              (kind === "crafting" && fieldIndex === 4)
            ) {
              snippetItems.push(...buildUnlockCompletions(kind));
            }

            if (kind === "crafting" && fieldIndex === 3) {
              snippetItems.push(...buildBigCraftableFlagCompletions());
            }
          } else {
            // Full recipe string skeleton only when empty
            if (
              isFullRecipeStringNodeForCompletion(stringNode, document, kind) &&
              stringValue.trim().length === 0
            ) {
              snippetItems.push(
                ...buildFullRecipeCompletions(kind, recipeKey, lookups)
              );
            }
          }

          // Item ID completions inside recipe strings / Fields[0]/Fields[2]
          if (isRecipeItemStringContext(stringNode, document) && stringValue.length > 0) {
            const fullValue = stringValue;

            const stringStartOffset = stringNode.offset + 1; // inside quotes
            const offset = document.offsetAt(position);
            const innerIndex = Math.max(
              0,
              Math.min(fullValue.length, offset - stringStartOffset)
            );

            const { start: tokenStart, end: tokenEnd } = getTokenRangeInString(
              fullValue,
              innerIndex
            );

            const tokenText = fullValue.substring(tokenStart, tokenEnd);
            const tokenTrimmed = tokenText.trim();

            const tokenStartAbs = stringStartOffset + tokenStart;
            const tokenEndAbs = stringStartOffset + tokenEnd;

            const replaceRange = new vscode.Range(
              document.positionAt(tokenStartAbs),
              document.positionAt(tokenEndAbs)
            );

            // Quantity guard: if cursor is on a quantity token, don't show ID list
            if (/^[0-9]+$/.test(tokenTrimmed)) {
              const { segStart, segEnd } = getSegmentBounds(
                fullValue,
                tokenStart,
                tokenEnd
              );
              const tokenIndexSeg = getTokenIndexInSegment(
                fullValue,
                segStart,
                segEnd,
                tokenStart,
                tokenEnd
              );

              // Odd positions in a "id qty id qty" list are quantities
              if (tokenIndexSeg >= 0 && tokenIndexSeg % 2 === 1) {
                for (const ci of snippetItems) {
                  attachTrailingCommaIfNeeded(document, stringNode, ci);
                }
                return snippetItems.length ? snippetItems : undefined;
              }
            }

            // IMPORTANT: use the shared builder + correct param shape (no valueNode)
            idItems.push(
              ...buildItemIdCompletionsForToken({
                lookups,
                state: sharedState,
                tokenTrimmed,
                replaceRange,
                document,
                valueNodeOffset: stringNode.offset,
                valueNodeLength: stringNode.length,
                ingredientPlaceholder: INGREDIENT_PLACEHOLDER,
                triggerSuggestCmd,
              })
            );
          }

          const allItems = [...snippetItems, ...idItems];
          if (!allItems.length) return;

          // Only add commas for snippet completions
          for (const ci of snippetItems) {
            attachTrailingCommaIfNeeded(document, stringNode, ci);
          }

          return allItems;
        } catch {
          return;
        }
      },
    },
    // Triggers while typing inside recipe strings (include '_' so __INGREDIENT__ works)
    '"',
    "(",
    " ",
    "_",
    "-",
    ".",
    ",",
    "/",
    ...Array.from("0123456789"),
    ...Array.from("abcdefghijklmnopqrstuvwxyz"),
    ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
  );

  context.subscriptions.push(recipeProvider);
  return recipeProvider;
}

/* ------------------------------------------------------------------------- */
/*  Inline completion provider                                               */
/* ------------------------------------------------------------------------- */

export function registerRecipeInlineCompletionSupport(
  context: vscode.ExtensionContext,
  lookups: ItemLookup
): vscode.Disposable {
  const selector: vscode.DocumentSelector = [
    { pattern: "**/*.json" },
    { pattern: "**/*.jsonc" },
    { pattern: "!**/manifest.json" },
  ];

  const provider: vscode.InlineCompletionItemProvider = {
    provideInlineCompletionItems(document, position) {
      try {
        const stringNode = getStringNodeAtPosition(document, position);
        if (!stringNode) return;

        const kind = findRecipeKindForNode(stringNode, document);
        if (!kind) return;

        const fieldIndex = getRecipeFieldIndex(stringNode);
        const recipeKey = getRecipeKeyForStringNode(stringNode);
        const value = String(stringNode.value ?? "");

        // Inline “skeleton” only when empty (dropdown still has full set)
        if (fieldIndex === null) {
          if (
            isFullRecipeStringNodeForCompletion(stringNode, document, kind) &&
            value.trim().length === 0
          ) {
            const snippets = buildFullRecipeCompletions(kind, recipeKey, lookups);
            const first = snippets[0];

            const insertText =
              first.insertText instanceof vscode.SnippetString
                ? first.insertText
                : new vscode.SnippetString(String(first.insertText ?? ""));

            return {
              items: [
                new vscode.InlineCompletionItem(
                  insertText,
                  new vscode.Range(position, position)
                ),
              ],
            };
          }
          return;
        }

        // Field-based inline suggestions (lightweight)
        if (kind === "crafting" && fieldIndex === 3 && value.trim().length === 0) {
          // big craftable flag
          return {
            items: [
              new vscode.InlineCompletionItem(
                new vscode.SnippetString("false"),
                new vscode.Range(position, position)
              ),
            ],
          };
        }

        if (
          ((kind === "cooking" && fieldIndex === 3) ||
            (kind === "crafting" && fieldIndex === 4)) &&
          value.trim().length === 0
        ) {
          // unlock field
          return {
            items: [
              new vscode.InlineCompletionItem(
                new vscode.SnippetString("default"),
                new vscode.Range(position, position)
              ),
            ],
          };
        }

        return;
      } catch {
        return;
      }
    },
  };

  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    selector,
    provider
  );

  context.subscriptions.push(disposable);
  return disposable;
}

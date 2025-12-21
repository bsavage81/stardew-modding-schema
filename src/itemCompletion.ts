// src/itemCompletion.ts
import * as vscode from "vscode";
import { parseTree, findNodeAtOffset, Node as JsonNode } from "jsonc-parser";
import { ItemLookup } from "./stardewIds";
import {
  buildSharedItemCompletionState,
  buildItemIdCompletionsForToken,
} from "./__itemCompletionShared";

function findEnclosingProperty(
  node: JsonNode | undefined
): JsonNode | undefined {
  let cur: JsonNode | undefined = node;
  while (cur && cur.type !== "property")
    cur = cur.parent as JsonNode | undefined;
  return cur;
}

function getPropertyKeyName(
  propNode: JsonNode | undefined
): string | undefined {
  if (
    !propNode ||
    propNode.type !== "property" ||
    !propNode.children ||
    propNode.children.length < 2
  )
    return;
  const keyNode = propNode.children[0];
  if (!keyNode || keyNode.type !== "string") return;
  return String(keyNode.value);
}

/**
 * Given the raw string content and an index inside it, return the boundaries
 * of the "word" token under the cursor.
 *
 * Delimiters: whitespace, '/', ',', ';', '|'
 */
function getTokenRangeInString(
  str: string,
  index: number
): { start: number; end: number } {
  if (index < 0) index = 0;
  if (index > str.length) index = str.length;

  const isDelim = (ch: string) => /[\s\/,;|]/.test(ch);

  let start = index;
  while (start > 0 && !isDelim(str[start - 1])) start--;

  let end = index;
  while (end < str.length && !isDelim(str[end])) end++;

  return { start, end };
}

function isOffsetInsideJsonString(node: JsonNode, offset: number): boolean {
  // jsonc-parser string node length includes the quotes
  const stringStartOffset = node.offset + 1;
  const stringEndOffset = node.offset + node.length - 1;
  return offset >= stringStartOffset && offset <= stringEndOffset;
}

function getStringReplaceRangeForToken(
  document: vscode.TextDocument,
  stringNode: JsonNode,
  offset: number
): { tokenTrimmed: string; replaceRange: vscode.Range } | undefined {
  if (stringNode.type !== "string") return;
  if (!isOffsetInsideJsonString(stringNode, offset)) return;

  const fullValue = (stringNode.value ?? "") as string;

  const stringStartOffset = stringNode.offset + 1;
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

  return { tokenTrimmed, replaceRange };
}

/**
 * For Unlockable Bundles-style maps where item IDs are OBJECT KEYS:
 *  "Price": { "(O)388": 200, "Money": 2500 }
 *  "BundleReward": { "(H)40": 1 }
 */
function getUbMapNameForProperty(
  propNode: JsonNode | undefined
): string | undefined {
  // propNode is the leaf "(O)388": 200
  // parent chain: property -> object -> property ("Price") -> object/...
  if (!propNode || propNode.type !== "property") return;

  const objNode = propNode.parent as JsonNode | undefined;
  if (!objNode || objNode.type !== "object") return;

  const containerProp = objNode.parent as JsonNode | undefined;
  if (!containerProp || containerProp.type !== "property") return;

  return getPropertyKeyName(containerProp);
}

/* ------------------------------------------------------------------------- */
/*  Main registration                                                        */
/* ------------------------------------------------------------------------- */

export function registerItemCompletionSupport(
  context: vscode.ExtensionContext,
  lookups: ItemLookup
): vscode.Disposable {
  // Reliable “chain” suggest trigger (A -> B -> C)
  const triggerSuggestCmd = "stardewModdingSchema.triggerSuggestAfterInsert";

  context.subscriptions.push(
    vscode.commands.registerCommand(triggerSuggestCmd, () => {
      setTimeout(() => {
        void vscode.commands.executeCommand("editor.action.triggerSuggest");
      }, 50);
    })
  );

  // Build once: stable ordering + category codes
  const sharedState = buildSharedItemCompletionState(lookups);

  const selector: vscode.DocumentSelector = [
    { pattern: "**/*.json" },
    { pattern: "**/*.jsonc" },
  ];

  const triggerChars = [
    '"',
    "(",
    ")",
    "_",
    "-",
    ".",
    "/",
    ...Array.from("0123456789"),
    ...Array.from("abcdefghijklmnopqrstuvwxyz"),
    ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  ];

  const UB_ITEM_KEY_MAPS = new Set<string>([
    "Price",
    "BundleReward",
    // Add more UB fields here if you want the same behavior elsewhere.
  ]);

  const provider = vscode.languages.registerCompletionItemProvider(
    selector,
    {
      provideCompletionItems(document, position) {
        // Don’t interfere with manifest editing
        const fsPathLower = document.uri.fsPath.toLowerCase();
        if (
          fsPathLower.endsWith("\\manifest.json") ||
          fsPathLower.endsWith("/manifest.json")
        ) {
          return;
        }

        const text = document.getText();
        const offset = document.offsetAt(position);

        const root = parseTree(text);
        if (!root) return;

        const rawNode = findNodeAtOffset(root, offset) as JsonNode | undefined;
        if (!rawNode) return;

        const propNode = findEnclosingProperty(rawNode);
        if (!propNode?.children || propNode.children.length < 2) return;

        const keyNode = propNode.children[0];
        const valueNode = propNode.children[1];

        if (keyNode.type !== "string") return;

        // ---------------------------------------------------------------------
        // PATH 1 (existing): ItemId/Name/Id values are strings
        // ---------------------------------------------------------------------
        if (valueNode.type === "string") {
          const keyName = String(keyNode.value);

          // Keep existing behavior: only run for these ID-ish keys
          const isIdKey =
            keyName === "ItemId" || keyName === "Name" || keyName === "Id";
          if (!isIdKey) return;

          const tokenInfo = getStringReplaceRangeForToken(
            document,
            valueNode,
            offset
          );
          if (!tokenInfo) return;

          return buildItemIdCompletionsForToken({
            lookups,
            state: sharedState,
            tokenTrimmed: tokenInfo.tokenTrimmed,
            replaceRange: tokenInfo.replaceRange,
            document,
            valueNodeOffset: valueNode.offset,
            valueNodeLength: valueNode.length,
            triggerSuggestCmd,
            noComma: false,
          });
        }

        // ---------------------------------------------------------------------
        // PATH 2 (new): UB maps where the ITEM ID is the PROPERTY KEY string
        // Example: "Price": { "(O)388": 200, "Money": 2500 }
        // We trigger when cursor is inside the KEY string.
        // ---------------------------------------------------------------------
        const ubMapName = getUbMapNameForProperty(propNode);
        if (!ubMapName || !UB_ITEM_KEY_MAPS.has(ubMapName)) return;

        // Don’t offer item completions for non-item keys in these maps
        const thisKey = String(keyNode.value);

        // Allow blank keys so typing `"` immediately offers completions.
        // Only skip Money when it is explicitly "Money".
        if (thisKey === "Money") return;

        const keyTokenInfo = getStringReplaceRangeForToken(
          document,
          keyNode,
          offset
        );
        if (!keyTokenInfo) return;

        return buildItemIdCompletionsForToken({
          lookups,
          state: sharedState,
          tokenTrimmed: keyTokenInfo.tokenTrimmed,
          replaceRange: keyTokenInfo.replaceRange,
          document,
          valueNodeOffset: keyNode.offset,
          valueNodeLength: keyNode.length,
          triggerSuggestCmd,
          noComma: true,
        });
      },
    },
    ...triggerChars
  );

  context.subscriptions.push(provider);
  return provider;
}

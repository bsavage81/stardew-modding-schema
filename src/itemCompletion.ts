// src/itemCompletion.ts
import * as vscode from "vscode";
import { parseTree, findNodeAtOffset, Node as JsonNode } from "jsonc-parser";
import { ItemLookup } from "./stardewIds";
import {
  buildSharedItemCompletionState,
  buildItemIdCompletionsForToken,
} from "./__itemCompletionShared";

function findEnclosingProperty(node: JsonNode | undefined): JsonNode | undefined {
  let cur: JsonNode | undefined = node;
  while (cur && cur.type !== "property") cur = cur.parent as JsonNode | undefined;
  return cur;
}

/**
 * Given the raw string content and an index inside it, return the boundaries
 * of the "word" token under the cursor.
 *
 * Delimiters: whitespace, '/', ',', ';', '|'
 */
function getTokenRangeInString(str: string, index: number): { start: number; end: number } {
  if (index < 0) index = 0;
  if (index > str.length) index = str.length;

  const isDelim = (ch: string) => /[\s\/,;|]/.test(ch);

  let start = index;
  while (start > 0 && !isDelim(str[start - 1])) start--;

  let end = index;
  while (end < str.length && !isDelim(str[end])) end++;

  return { start, end };
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
        if (valueNode.type !== "string") return;

        const keyName = String(keyNode.value);

        // Keep existing behavior: only run for these ID-ish keys
        const isIdKey = keyName === "ItemId" || keyName === "Name" || keyName === "Id";
        if (!isIdKey) return;

        // Only operate when cursor is inside the string quotes.
        const stringStartOffset = valueNode.offset + 1;
        const stringEndOffset = valueNode.offset + valueNode.length - 1;
        if (offset < stringStartOffset || offset > stringEndOffset) return;

        const fullValue = (valueNode.value ?? "") as string;

        const innerIndex = Math.max(
          0,
          Math.min(fullValue.length, offset - stringStartOffset)
        );

        const { start: tokenStart, end: tokenEnd } = getTokenRangeInString(fullValue, innerIndex);

        const tokenText = fullValue.substring(tokenStart, tokenEnd);
        const tokenTrimmed = tokenText.trim();

        const tokenStartAbs = stringStartOffset + tokenStart;
        const tokenEndAbs = stringStartOffset + tokenEnd;

        const replaceRange = new vscode.Range(
          document.positionAt(tokenStartAbs),
          document.positionAt(tokenEndAbs)
        );

        // Delegate Stage A/B/C to the shared builder
        return buildItemIdCompletionsForToken({
          lookups,
          state: sharedState,
          tokenTrimmed,
          replaceRange,
          document,
          valueNodeOffset: valueNode.offset,
          valueNodeLength: valueNode.length,
          triggerSuggestCmd,
        });
      },
    },
    ...triggerChars
  );

  context.subscriptions.push(provider);
  return provider;
}

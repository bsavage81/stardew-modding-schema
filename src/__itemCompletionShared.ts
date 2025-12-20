// src/__itemCompletionShared.ts
import * as vscode from "vscode";
import { ItemEntry, ItemLookup } from "./stardewIds";

export const DEFAULT_INGREDIENT_PLACEHOLDER = "__INGREDIENT__";

export interface SharedItemCompletionState {
  items: ItemEntry[];
  categoryCodes: string[];
}

/**
 * Collect unique category codes like O, BC, WP from qualified IDs.
 */
function buildCategoryCodes(items: ItemEntry[]): string[] {
  const codes = new Set<string>();
  for (const entry of items) {
    const m = entry.qualifiedId.match(/^\(([A-Za-z]+)\)/);
    if (m) codes.add(m[1]);
  }
  return Array.from(codes).sort();
}

function isNumericId(id: string): boolean {
  return /^[0-9]+$/.test(id);
}

/**
 * Sort key (Stage B) so:
 * - vanilla first, then installed, then custom
 * - numeric IDs before non-numeric
 * - numeric IDs sorted numerically
 * - then lexicographic ID
 * - then qualifiedId as tie-breaker
 */
function makeStageBSortKey(entry: ItemEntry): string {
  let sourceRank = 2;
  if (entry.source === "vanilla") sourceRank = 0;
  else if (entry.source === "installed") sourceRank = 1;

  const id = entry.id;
  const numericFlag = isNumericId(id) ? "0" : "1";

  let idKey: string;
  if (isNumericId(id)) {
    idKey = parseInt(id, 10).toString().padStart(8, "0");
  } else {
    idKey = id.toLowerCase();
  }

  const qKey = entry.qualifiedId.toLowerCase();
  return `${sourceRank}_${numericFlag}_${idKey}_${qKey}`;
}

/**
 * Stage B match ranking:
 * Prefer contiguous substring matches in:
 *  0) name
 *  1) id
 *  2) qualifiedId
 * Anything else: no match.
 */
function getStageBMatchRank(entry: ItemEntry, searchLower: string): number {
  if (!searchLower) return 0;

  const name = entry.name.toLowerCase();
  const id = entry.id.toLowerCase();
  const qid = entry.qualifiedId.toLowerCase();

  if (name.includes(searchLower)) return 0;
  if (id.includes(searchLower)) return 1;
  if (qid.includes(searchLower)) return 2;

  return 99;
}

/**
 * Insert a comma after the closing quote of THIS string node if needed.
 * We only do it when the next non-whitespace char is NOT:
 *   - ','  (already has comma)
 *   - '}'  (end of object)
 *   - ']'  (end of array)
 */
function buildCommaAfterStringEdits(
  document: vscode.TextDocument,
  valueNodeOffset: number,
  valueNodeLength: number
): vscode.TextEdit[] {
  const afterNodeOffset = valueNodeOffset + valueNodeLength;

  const text = document.getText();
  let i = afterNodeOffset;
  while (i < text.length && /\s/.test(text[i])) i++;

  const next = i < text.length ? text[i] : "";
  if (next === "," || next === "}" || next === "]") return [];

  const insertPos = document.positionAt(afterNodeOffset);
  return [vscode.TextEdit.insert(insertPos, ",")];
}

/**
 * Stage C: Build variant options for a single entry.
 * IMPORTANT: filterText includes qualifiedId so VS Code doesn't hide variants
 * when the current prefix is the qualified ID we just inserted.
 */
function buildVariantsForSingleEntry(args: {
  entry: ItemEntry;
  replaceRange: vscode.Range;
  document: vscode.TextDocument;
  valueNodeOffset: number;
  valueNodeLength: number;
}): vscode.CompletionItem[] {
  const { entry, replaceRange, document, valueNodeOffset, valueNodeLength } =
    args;

  const results: vscode.CompletionItem[] = [];

  const prefixMatch = entry.qualifiedId.match(/^\(([A-Za-z]+)\)/);
  const categoryPrefix = prefixMatch ? prefixMatch[0] : "";

  const commaEdits = buildCommaAfterStringEdits(
    document,
    valueNodeOffset,
    valueNodeLength
  );

  const stageCFilter = `${entry.qualifiedId} ${entry.id} ${entry.name} ${
    entry.modId ?? ""
  }`;

  let variantIndex = 0;

  // [Name]
  {
    const label = `[Name] ${entry.name}`;
    const ci = new vscode.CompletionItem(
      label,
      vscode.CompletionItemKind.Value
    );
    ci.insertText = new vscode.SnippetString(entry.name);
    ci.range = replaceRange;
    ci.detail = `Name only for ${entry.name}`;
    ci.filterText = stageCFilter;
    ci.sortText = `0_${variantIndex++}`;
    ci.additionalTextEdits = commaEdits;
    results.push(ci);
  }

  // [ID]
  {
    const label = `[ID] ${entry.id} — ${entry.name}`;
    const ci = new vscode.CompletionItem(
      label,
      vscode.CompletionItemKind.Value
    );
    ci.insertText = new vscode.SnippetString(entry.id);
    ci.range = replaceRange;
    ci.detail = `[${entry.category}] Bare ID for ${entry.name}`;
    ci.filterText = stageCFilter;
    ci.sortText = `0_${variantIndex++}`;
    ci.additionalTextEdits = commaEdits;
    results.push(ci);
  }

  // [Qualified ID]
  {
    const label = `[Qualified ID] ${entry.qualifiedId} — ${entry.name}`;
    const ci = new vscode.CompletionItem(
      label,
      vscode.CompletionItemKind.Value
    );
    ci.insertText = new vscode.SnippetString(entry.qualifiedId);
    ci.range = replaceRange;
    ci.detail = `[${entry.category}] Qualified ID for ${entry.name}`;
    ci.filterText = stageCFilter;
    ci.sortText = `0_${variantIndex++}`;
    ci.additionalTextEdits = commaEdits;
    results.push(ci);
  }

  if (entry.source !== "vanilla") {
    const modId = entry.modId?.trim() ?? "";
    let cpId = entry.id;
    let cpName = entry.name;

    if (modId && modId !== "Custom") {
      const lowerId = entry.id.toLowerCase();
      const lowerMod = modId.toLowerCase();

      if (lowerId.startsWith(lowerMod)) {
        const suffix = entry.id.substring(modId.length);
        const suffixName = entry.name.substring(modId.length);
        cpId = `{{ModID}}${suffix}`;
        cpName = `{{ModID}}${suffixName}`;
      } else {
        cpId = `{{ModID}}_${entry.id}`;
        cpName = `{{ModID}}_${entry.name}`;
      }
    }

    const qualifiedWithToken = `${categoryPrefix}${cpId}`;
    const stageCFilterWithToken = `${stageCFilter} ${cpId} ${cpName} ${qualifiedWithToken}`;

    // [Name with {{ModID}}]
    {
      const label = `[Name with {{ModID}}] ${cpName}`;
      const ci = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Value
      );
      ci.insertText = new vscode.SnippetString(cpName);
      ci.range = replaceRange;
      ci.detail = `Bare Name for ${entry.name} using {{ModID}}`;
      ci.filterText = stageCFilterWithToken;
      ci.sortText = `0_${variantIndex++}`;
      ci.additionalTextEdits = commaEdits;
      results.push(ci);
    }

    // [ID with {{ModID}}]
    {
      const label = `[ID with {{ModID}}] ${cpId}`;
      const ci = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Value
      );
      ci.insertText = new vscode.SnippetString(cpId);
      ci.range = replaceRange;
      ci.detail = `Bare ID for ${entry.name} using {{ModID}}`;
      ci.filterText = stageCFilterWithToken;
      ci.sortText = `0_${variantIndex++}`;
      ci.additionalTextEdits = commaEdits;
      results.push(ci);
    }

    // [Qualified ID with {{ModID}}]
    {
      const label = `[Qualified ID with {{ModID}}] ${qualifiedWithToken}`;
      const ci = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Value
      );
      ci.insertText = new vscode.SnippetString(qualifiedWithToken);
      ci.range = replaceRange;
      ci.detail = `Qualified ID for ${entry.name} using {{ModID}}`;
      ci.filterText = stageCFilterWithToken;
      ci.sortText = `0_${variantIndex++}`;
      ci.additionalTextEdits = commaEdits;
      results.push(ci);
    }
  }

  return results;
}

/**
 * Build once and share between itemCompletion and recipeCompletion,
 * so behavior stays identical.
 */
export function buildSharedItemCompletionState(
  lookups: ItemLookup
): SharedItemCompletionState {
  const items: ItemEntry[] = Array.from(lookups.byQualifiedId.values());
  items.sort((a, b) =>
    makeStageBSortKey(a).localeCompare(makeStageBSortKey(b))
  );

  return {
    items,
    categoryCodes: buildCategoryCodes(items),
  };
}

/**
 * Build Stage A/B/C completions for a token in a string.
 *
 * - Stage A: empty token, "(" token, or ingredientPlaceholder -> show category prefixes
 * - Stage C: exact qualifiedId -> variants
 * - Stage B: ranked match (name/id/qid), contiguous substring only,
 *            inserts qualifiedId, adds comma edits
 */
export function buildItemIdCompletionsForToken(args: {
  lookups: ItemLookup;
  state: SharedItemCompletionState;
  tokenTrimmed: string;
  replaceRange: vscode.Range;
  document: vscode.TextDocument;
  valueNodeOffset: number;
  valueNodeLength: number;

  // If set and matches tokenTrimmed, treat like Stage A trigger
  ingredientPlaceholder?: string;

  // Suggest chaining command to run after inserting a prefix or a qualifiedId
  triggerSuggestCmd?: string;
}): vscode.CompletionItem[] {
  const {
    lookups,
    state,
    tokenTrimmed,
    replaceRange,
    document,
    valueNodeOffset,
    valueNodeLength,
    ingredientPlaceholder,
    triggerSuggestCmd,
  } = args;

  const shouldStageA =
    !tokenTrimmed ||
    tokenTrimmed === "(" ||
    (ingredientPlaceholder && tokenTrimmed === ingredientPlaceholder);

  if (shouldStageA) {
    const results: vscode.CompletionItem[] = [];

    for (const code of state.categoryCodes) {
      const prefix = `(${code})`;
      const ci = new vscode.CompletionItem(
        prefix,
        vscode.CompletionItemKind.Enum
      );
      ci.insertText = new vscode.SnippetString(prefix);
      ci.range = replaceRange;
      ci.detail = `Category prefix ${prefix}`;
      ci.sortText = `0_${code}`;

      if (triggerSuggestCmd) {
        ci.command = {
          command: triggerSuggestCmd,
          title: "Continue item suggestions",
        };
      }

      results.push(ci);
    }

    return results;
  }

  // Stage C
  const exactEntry = lookups.byQualifiedId.get(tokenTrimmed);
  if (exactEntry) {
    return buildVariantsForSingleEntry({
      entry: exactEntry,
      replaceRange,
      document,
      valueNodeOffset,
      valueNodeLength,
    });
  }

  // Stage B
  const results: vscode.CompletionItem[] = [];
  const commaEdits = buildCommaAfterStringEdits(
    document,
    valueNodeOffset,
    valueNodeLength
  );

  const catMatch = tokenTrimmed.match(/^\(([A-Z]+)\)/);
  const categoryFilter = catMatch ? catMatch[1] : null;

  const searchPart = catMatch
    ? tokenTrimmed.slice(catMatch[0].length).trim()
    : tokenTrimmed;
  const searchLower = searchPart.toLowerCase();

  for (const entry of state.items) {
    if (categoryFilter) {
      const entryCatMatch = entry.qualifiedId.match(/^\(([A-Z]+)\)/);
      if (!entryCatMatch || entryCatMatch[1] !== categoryFilter) continue;
    }

    const rank = getStageBMatchRank(entry, searchLower);
    if (searchLower && rank === 99) continue;

    // Preserve your current label style from itemCompletion.ts
    const label = categoryFilter
      ? `(${categoryFilter})${entry.id} — ${entry.name}`
      : `${entry.qualifiedId} — ${entry.name}`;

    const ci = new vscode.CompletionItem(
      label,
      vscode.CompletionItemKind.Value
    );

    ci.insertText = new vscode.SnippetString(entry.qualifiedId);
    ci.range = replaceRange;
    ci.detail = `[${entry.category}] Qualified ID for ${entry.name}`;

    if (categoryFilter && !searchLower) {
      ci.filterText = `${entry.qualifiedId} ${entry.id} ${entry.name}`;
    } else {
      ci.filterText = `${entry.name} ${entry.id} ${entry.qualifiedId}`;
    }

    ci.sortText = `${rank.toString().padStart(2, "0")}_${makeStageBSortKey(
      entry
    )}`;
    ci.additionalTextEdits = commaEdits;

    if (triggerSuggestCmd) {
      ci.command = {
        command: triggerSuggestCmd,
        title: "Show item ID variants",
      };
    }

    results.push(ci);
  }

  return results;
}

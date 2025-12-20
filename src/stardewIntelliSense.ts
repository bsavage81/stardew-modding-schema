// src/stardewIntelliSense.ts
import * as vscode from "vscode";
import { loadStardewIds, ItemLookup } from "./stardewIds";
import { registerItemHoverSupport } from "./itemHover";
import { registerItemCompletionSupport } from "./itemCompletion";
import {
  registerRecipeCompletionSupport,
  registerRecipeInlineCompletionSupport,
} from "./recipeCompletion";
import { registerRecipeHoverSupport } from "./recipeHover";
import { registerI18nHoverSupport } from "./i18nHover";

/**
 * Central registration point for all Stardew IntelliSense features:
 *  - Item hovers
 *  - Item ID completions
 *  - Recipe hovers (cooking/crafting)
 *  - Recipe completions (snippets + ID completions)
 *  - Recipe inline completions (where it makes sense)
 *  - i18n hovers
 */
export function registerStardewIntelliSense(
  context: vscode.ExtensionContext
): void {
  // i18n hover does NOT depend on stardew IDs, so always register it.
  registerI18nHoverSupport(context);

  const lookups = loadStardewIds(context) as ItemLookup | null;

  if (!lookups) {
    console.warn(
      "[Stardew Modding Schema] No stardew-ids.json(.jsonc) found; item/recipe IntelliSense disabled (i18n hover still enabled)."
    );
    return;
  }

  const itemHoverDisposable = registerItemHoverSupport(context, lookups);
  const itemCompletionDisposable = registerItemCompletionSupport(context, lookups);

  const recipeHoverDisposable = registerRecipeHoverSupport(context, lookups);

  // Dropdown completions (IDs, snippets)
  const recipeCompletionDisposable = registerRecipeCompletionSupport(context, lookups);

  // Inline completions (skeletons, flags, unlocks, etc.)
  const recipeInlineCompletionDisposable = registerRecipeInlineCompletionSupport(
    context,
    lookups
  );

  context.subscriptions.push(
    itemHoverDisposable,
    itemCompletionDisposable,
    recipeHoverDisposable,
    recipeCompletionDisposable,
    recipeInlineCompletionDisposable
  );
}

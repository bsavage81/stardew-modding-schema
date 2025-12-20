# Stardew Modding Schema

The **Stardew Modding Schema** extension enhances VS Code with powerful IntelliSense, schema validation, hover documentation, and real-time error checking for **Stardew Valley modding**.  
It supports **Content Patcher**, **SMAPI**, **Unlockable Bundles**, and **Furniture Framework**, automatically selecting the correct schema based on the contents of each `content.json`.

This extension helps mod authors avoid mistakes, improve performance, and build high-quality mods faster.

---

## Features

### ✔ Smart Schema Selection (NEW in 1.3.x)

This extension uses a **meta-schema system** that automatically applies the correct schema based on what your `content.json` contains.

- If the file includes a top-level **"Furniture"** object, the **Furniture Framework schema** is used.
- Otherwise, the **Content Patcher + Unlockable Bundles combined schema** is used.

No configuration required.  
No extension settings needed.  
Just open your mod and enjoy accurate IntelliSense.

---

### ✔ Item ID Hover & Autocompletion (IMPORTANT)

The extension provides **smart item ID hovers and completions** throughout Content Patcher, Unlockable Bundles, and recipe data.

#### Autocompletion (Ctrl + Space)

When your cursor is inside an item ID string, press:

- **Ctrl + Space** (Windows / Linux)  
- **Cmd + Space** (macOS)

This triggers item ID completion suggestions, including:

- Vanilla Stardew Valley items  
- Installed mod items  
- Qualified IDs (`(O)`, `(BC)`, etc.)  
- `{{ModId}}` token-aware IDs  
- Items with multiple variants (expanded automatically)

Example item ID:

```json
"(O){{ModId}}_FlaxSeeds"
```

Completions automatically insert:
- Correct formatting  
- Quotes  
- Optional commas where appropriate  

#### Hover Information

Hovering over an item ID shows:
- Resolved item name  
- Source (vanilla or mod)  
- Qualified ID type  
- Context-aware info inside bundles, shops, recipes, and nested structures  

Hovers work in keys, values, arrays, and deeply nested objects.

---

### ✔ Content Patcher + SMAPI Schema Validation

Automatically validates:

- `content.json` (Content Patcher)  
- `manifest.json` (SMAPI)  
- `data/*.json` (conditional CP validation)  
- `i18n/*.json` translation files  

You get:
- Inline documentation  
- Autocomplete  
- Type checking  
- Hover tooltips  
- Clear error messages on invalid CP fields  

---

### ✔ Full Unlockable Bundles (UB) Support

The extension includes a complete, standards-based schema for Unlockable Bundles assets:

- `UnlockableBundles/Bundles`  
- `UnlockableBundles/AdvancedPricing`  
- `UnlockableBundles/WalletCurrencies`  
- `UnlockableBundles/PrizeTicketMachines`  
- `UnlockableBundles/CompletionRibbons`  

Schema features include:
- Dynamic flavored items  
- Recipe and spawn-field items  
- Pricing migration rules  
- Wallet currency item converters  
- Prize machine reward definitions  
- Special Placement Requirements  
- Context tag validation  
- Animation metadata  
- Built-in and custom ShopTypes  

All UB features activate automatically when a Content Patcher patch `Target` matches UB assets.

---

### ✔ Furniture Framework Schema Support

When a content pack contains a top-level `Furniture` object like:

```json
{
  "Furniture": { }
}
```

The extension switches automatically to the official **Furniture Framework `content.json` schema**, providing:
- Accurate validation  
- Hover documentation  
- Allowed furniture fields  
- Error checking for FF-specific structures  

No setup required.

---

### ✔ Smart ShopType Completion Provider

When editing Unlockable Bundles definitions, autocomplete includes:

- All built-in UB ShopTypes  
- All BundleThemes defined in your workspace  
- All entries from external `ShopTypes.json`  

Additional features:
- Triggered instantly on `"` inside `ShopType` values  
- Automatic cursor placement and quote/comma handling  
- Fully cached with real-time updates via file watchers  

---

### ✔ Recipe Hover & Completion Support

Cooking and crafting recipes are supported:
- Ingredient item IDs resolve correctly  
- Outputs show resolved item names on hover  
- Works for vanilla-style and modded recipe formats  

---

### ✔ Advanced Translation Support

For any `i18n/*.json` file:
- Full schema validation  
- Hover descriptions  
- JSON structure checks  
- Missing or extra key detection  

Supports any number of languages and adapts automatically to your folder structure.

---

### ✔ Real-Time Diagnostics & Warnings

The extension warns about:
- Missing `shopTypesPath` when UB content is detected  
- Invalid `ShopTypes.json` paths  
- Broken flavored item syntax  
- Mistyped ShopTypes  
- Invalid Content Patcher keys  
- JSON structural errors  

Warnings appear immediately in the **Problems** pane.

---

### ✔ File Watchers

The extension monitors:
- `content.json`  
- `manifest.json`  
- `i18n/*.json`  
- `*BundleThemes*.json`  
- External or workspace `ShopTypes.json`  

Changes automatically trigger:
- Cache refresh  
- Updated validation  
- Updated hover and completion data  

No reload required.

---

## Requirements

- **VS Code 1.80.0+**  
- **Internet connection** (for Content Patcher and SMAPI schema URLs)  
- **Node.js** only required if modifying the extension  

---

## Known Issues

- Experimental UB features may require additional schema refinement  
- JSON syntax errors block deep validation until fixed  
- Furniture Framework schemas rely on upstream FF stability  

Please report issues or submit pull requests on GitHub.

---

## Release Notes

### 1.2.1
- Added meta-schema system for automatic switching between Furniture Framework and Content Patcher + Unlockable Bundles schemas  
- Added standalone Unlockable Bundles schema  
- Added Completion Ribbon schema support  
- Added item ID hover support across bundles, shops, recipes, and nested data  
- Added **Ctrl + Space** item ID autocompletion with variant expansion  
- Improved ShopType autocomplete using workspace themes and external sources  
- Added warnings for missing `shopTypesPath`  
- Migrated hover and completion logic to JSONC-safe parsing  
- Improved caching and file watcher responsiveness  

---

## Helpful Resources

- **SMAPI Docs**  
  https://stardewvalleywiki.com/Modding:SMAPI

- **Content Patcher Docs**  
  https://stardewvalleywiki.com/Modding:Content_Patcher

- **Unlockable Bundles**  
  https://gitlab.com/delixx/stardew-valley/unlockable-bundles

- **Furniture Framework**  
  https://github.com/Leroymilo/FurnitureFramework

---

**Enjoy cleaner, safer, faster Stardew Valley modding — with intelligent schemas and powerful IntelliSense built just for you.**

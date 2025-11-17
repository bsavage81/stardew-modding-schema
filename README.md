# Stardew Modding Schema

The **Stardew Modding Schema** extension enhances VS Code with powerful IntelliSense, schema validation, hover docs, and error checking for **Stardew Valley modding**.  
It supports **Content Patcher**, **SMAPI**, **Unlockable Bundles**, and **Furniture Framework**, automatically selecting the correct schema based on the contents of each `content.json`.

This extension helps mod authors avoid mistakes, improve performance, and build high-quality mods faster.

---

## Features

## ✔ Smart Schema Selection (NEW in 1.2.0)

This extension uses a **meta-schema system** that automatically applies the correct schema based on what your `content.json` contains.

- If the file includes a top-level **`"Furniture"`** object  
  ➜ **Furniture Framework schema** is used.
- Otherwise  
  ➜ the **Content Patcher + Unlockable Bundles combined schema** is used.

No configuration required.  
No extension settings needed.  
Just open your mod and enjoy perfect IntelliSense.

---

## ✔ Content Patcher + SMAPI Schema Validation

Automatically validates:

- `content.json` (Content Patcher)
- `manifest.json` (SMAPI)
- `data/*.json` (Conditional CP validation)
- All `i18n/*.json` translation files

You get:
- Inline documentation
- Autocomplete
- Type checking
- Hover tooltips
- Error messages on invalid CP fields

---

## ✔ Full Unlockable Bundles (UB) Support

The extension includes a robust, standards-based schema for all UB assets:

- `UnlockableBundles/Bundles`
- `UnlockableBundles/AdvancedPricing`
- `UnlockableBundles/WalletCurrencies`
- `UnlockableBundles/PrizeTicketMachines`
- `UnlockableBundles/CompletionRibbons` (NEW)

Schema features include:
- Dynamic flavored items
- Recipe and spawn-field items
- Pricing migration rules
- Wallet currency item converters
- Prize machine reward definitions
- Full Special Placement Requirements
- Context tag validation
- Animation metadata
- Built-in & custom ShopTypes

And more.

All of this activates automatically when your CP patch’s `Target` matches UB assets.

---

## ✔ Furniture Framework Schema Support (NEW in 1.2.0)

When a content pack contains:

```json
{
  "Furniture": { ... }
}
```

The extension switches to the official **Furniture Framework content.json schema**.

This provides:

- Accurate validation  
- Hover documentation  
- Allowed furniture fields  
- Error checking for FF-specific structures  

All automatic.

---

## ✔ Smart ShopType Completion Provider (Improved in 1.2.0)

When editing UB bundle definitions, autocomplete includes:

- All built-in UB types  
- All BundleThemes defined in your workspace  
- All types from external `ShopTypes.json`  

Additional features:

- Automatic cursor placement and quote/comma handling  
- Works instantly in any `content.json`  
- Fully cached + real-time update via file watchers  

This offers the fastest and most complete UB ShopType editing experience available.

---

## ✔ Advanced Translation Support

For any `i18n\/\*.json` file:

- Full schema validation  
- Hover descriptions  
- JSON structure checks  
- Missing/extra key detection (language consistency)  

Supports any number of languages and automatically adapts to your translation folder structure.

---

## ✔ Real-Time Diagnostics & Warnings

The extension warns about:

- Missing `shopTypesPath` (when UB content is detected)  
- Invalid `ShopTypes.json` paths  
- Broken flavored item syntax  
- Mistyped ShopTypes  
- Invalid CP keys  
- JSON structural errors  

All warnings appear immediately in the Problems pane.

---

## ✔ File Watchers

The extension monitors:

- `content.json`  
- `manifest.json`  
- `i18n\/\*.json`  
- Any file matching `*BundleThemes*.json`  
- UB `ShopTypes.json` (external or in workspace)  

Changes auto-trigger:

- Cache refresh  
- Extended validation  
- Updated IntelliSense  

No reload required.

---

## Requirements

- **VS Code 1.80.0+**  
- **Internet connection** (for CP + SMAPI schema URLs)  
- **Node.js** only required if you are modifying the extension  

---

## Known Issues

- Some highly experimental UB structures may require additional refinement.  
- JSON syntax errors prevent deep schema validation until fixed.  
- Furniture Framework schemas depend on the upstream FF repository remaining stable.  

Please report issues or submit PRs on GitHub!

---

## Release Notes

### **1.2.0**
- Added meta-schema system for automatic switching between:
  - Furniture Framework schema  
  - Content Patcher + UB combined schema  
- Added standalone UB schema for improved modularity  
- Added Completion Ribbon schema support  
- Improved ShopType autocomplete with external + in-pack theme sources  
- Added warnings for missing `shopTypesPath`  
- Improved jsonc parsing and caching for ShopTypes and BundleThemes  
- Simplified schema switching logic (moved entirely into the schema system itself)

### **1.1.0**
- Full Unlockable Bundles integration  
- Added schemas for Bundles, Wallet Currencies, Advanced Pricing, Prize Ticket Machines  
- Combined CP + UB schema for rich IntelliSense  
- Conditional validation based on `EditData` patch targets  

### **1.0.1**
- Added translation file schema validation for all `i18n\/\*.json` files  

### **1.0.0**
- Initial release with Content Patcher and SMAPI manifest schema support  
- Inline docs, autocomplete, and error highlighting  

---

## Extension Guidelines

This extension follows all recommended VS Code extension best practices.

Contributions are welcome!

---

## Helpful Resources

- **SMAPI Docs:**  
  https://stardewvalleywiki.com/Modding:SMAPI

- **Content Patcher Docs:**  
  https://stardewvalleywiki.com/Modding:Content_Patcher

- **Unlockable Bundles (Framework):**  
  https://gitlab.com/delixx/stardew-valley/unlockable-bundles

- **Furniture Framework:**  
  https://github.com/Leroymilo/FurnitureFramework

---

**Enjoy cleaner, safer, faster Stardew Valley modding — with intelligent schemas built just for you.**


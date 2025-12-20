# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2025-12-20
### Added
- Introduced a new **meta content.json schema** (`stardew-content.schema.json`) which automatically selects the correct framework schema:
  - **Furniture Framework schema** is applied when a top-level `"Furniture"` object is present.
  - **Content Patcher + Unlockable Bundles combined schema** is applied for all other packs.
- Added a dedicated **Unlockable Bundles–only schema** (`unlockable-bundles.schema.json`) following strict json-schema.org structure for future standalone or embedded use.
- Added full schema support for **Completion Ribbons**:
  - `UnlockableBundles/CompletionRibbons`
  - Full ribbon and effect animation structure (`UbCompletionRibbon`, `UbCompletionRibbonEffect`).
- Added comprehensive **hover support** across Content Patcher and Unlockable Bundles data:
  - Item ID hovers resolve vanilla IDs, qualified IDs, and `{{ModId}}` tokens.
  - Hovers work inside object keys, values, and deeply nested arrays.
  - Supports shop entries, recipes, bundle definitions, and other nested structures.
  - Hover resolution uses JSONC-safe parsing, allowing comments and trailing commas.
- Added intelligent **item ID autocompletion**:
  - Suggestions include vanilla items, installed mod items, and qualified IDs.
  - Supports variant expansion for items with multiple representations.
  - Automatically inserts correctly formatted qualified IDs where applicable.
- Expanded **ShopType completion provider**:
  - Autocomplete includes all UB core shop types, workspace `BundleThemes`, and external entries from UB `ShopTypes.json`.
  - Completion inserts value, closing quote, and optional comma to match native schema behavior.
  - Triggered on `"` inside `ShopType` values for faster authoring.
- Added **hover and completion support for cooking and crafting recipes**:
  - Ingredient lists resolve item IDs correctly.
  - Recipe outputs display resolved item names and sources on hover.
- Added configuration warning:
  - When Unlockable Bundles usage is detected but `shopTypesPath` is not configured, VS Code displays a clear warning.
- Added deep JSONC parsing support for:
  - Unlockable Bundles `ShopTypes.json`
  - Unlockable Bundles `BundleThemes`, including workspace files and in-pack overrides.
- Schema initialization fully reorganized so the Unlockable Bundles schema can be reused independently of Content Patcher.

### Changed
- **Unlockable Bundles schema split from Content Patcher logic** and embedded conditionally as needed.
- Replaced manifest-based schema assignment with a **schema-directed approach**:
  - The schema determines whether to validate as Furniture Framework or Content Patcher + Unlockable Bundles based on file contents.
  - Improves accuracy and removes the need for runtime schema switching.
- Migrated all hover and completion parsing to **JSONC-safe parsing** to prevent failures caused by comments or trailing commas.
- Improved installed mod item indexing:
  - Installed item index files are only rebuilt when changes are detected.
  - Prevents unnecessary file rewrites and reduces extension overhead.
- Improved hover and completion performance:
  - Added caching for resolved item IDs and shop types.
  - Cache invalidation is tied to file watchers for immediate updates.
- Cleaned up schema formatting and removed ambiguous comments for better compatibility with strict JSON schema validators and VS Code’s JSON engine.

---

## [1.2.0] - 2025-11-14
### Added
- Full schema integration for Unlockable Bundles (UB) framework:
  - `UnlockableBundles/Bundles`
  - `UnlockableBundles/AdvancedPricing`
  - `UnlockableBundles/WalletCurrencies`
  - `UnlockableBundles/PrizeTicketMachines`
- Combined Content Patcher + Unlockable Bundles schema for complete IntelliSense inside `content.json`.
- Automatic validation of UB-related `EditData` patches based on the `Target` field.
- Added support for dynamic flavored items, recipe items, advanced pricing entries, bundle placement requirements, wallet currencies, and prize ticket machines.
- New schema registered in `package.json` for seamless VS Code autocomplete, hover info, and error checking.
- Updated internal schema loader to support deep UB definitions.

### Changed
- Improved `content.json` schema handling to merge with external schemas and apply conditional validation based on patch `Target`.
- Cleaned up schema contributions to avoid duplicate registrations.

---

## [1.0.1] - 2024-12-04
### Added
- Added support for translation files (`i18n/*.json`) with schema validation using the `i18n.json` schema.
- Enhanced IntelliSense for all files in the `i18n` folder.

---

## [1.0.0] - 2024-12-01
### Initial Release
- Introduced schema validation and IntelliSense for Stardew Valley `content.json` and `manifest.json` files.
- Features:
  - Content Patcher schema validation (`content.json`).
  - SMAPI manifest schema validation (`manifest.json`).
  - Live error highlighting for invalid JSON structures.
- File watcher notifications for changes in modding files.

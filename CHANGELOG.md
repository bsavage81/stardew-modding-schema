# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2025-02-15
### Added
- Introduced a new **meta content.json schema** (`stardew-content.schema.json`) which automatically selects the correct framework schema:
  - **Furniture Framework schema** is applied when a top-level `"Furniture"` object is present.
  - **Content Patcher + Unlockable Bundles combined schema** is applied for all other packs.
- Added a dedicated **Unlockable Bundles–only schema** (`unlockable-bundles.schema.json`) following strict json-schema.org structure for future standalone use.
- Added full schema support for **Completion Ribbons**:
  - `UnlockableBundles/CompletionRibbons`
  - Full ribbon/effect animation structure (`UbCompletionRibbon`, `UbCompletionRibbonEffect`)
- Expanded **ShopType completion provider**:
  - Autocomplete now includes all UB core types, all theme types from workspace BundleThemes, and all external entries from UB `ShopTypes.json`.
  - Completion inserts: value → closing quote → optional comma (matches native schema behavior).
  - Triggered on `"` inside `ShopType` values for faster use.
- Added configuration warning:
  - If UB usage is detected in a document but no `shopTypesPath` is configured, VS Code shows a clear warning message.
- Added deep jsonc parsing support for:
  - UB `ShopTypes.json`
  - UB `BundleThemes` (workspace files and in-pack overrides)
- Schema initialization fully reorganized to allow UB schema to be reused independently of Content Patcher.

### Changed
- **UB schema split from CP logic** — UB functionality is now isolated into its own schema and embedded conditionally.
- Replaced manifest-based schema assignment with a **schema-directed approach**:
  - The schema itself decides whether to validate as FF or CP+UB based on file content.
  - Greatly improves accuracy and removes the need for runtime schema switching.
- Enhanced ShopType caching & performance:
  - Workspace themes + external ShopTypes load asynchronously with improved memory safety.
  - Cache invalidation now tied to file watchers for instant update.
- Cleaned up schema formatting and removed ambiguous comments for better compatibility with strict JSON schema parsers and VS Code’s JSON validator.

---

## [1.1.0] - 2025-02-14
### Added
- Full schema integration for Unlockable Bundles (UB) framework:
  - `UnlockableBundles/Bundles`
  - `UnlockableBundles/AdvancedPricing`
  - `UnlockableBundles/WalletCurrencies`
  - `UnlockableBundles/PrizeTicketMachines`
- Combined Content Patcher + UB schema for complete IntelliSense inside `content.json`.
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

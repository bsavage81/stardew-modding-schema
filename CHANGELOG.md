# Changelog

All notable changes to this project will be documented in this file.

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
- Enhanced IntelliSense for all files inside the `i18n` folder.

---

## [1.0.0] - 2024-12-01
### Initial Release
- Introduced schema validation and IntelliSense for Stardew Valley `content.json` and `manifest.json` files.
- Features:
  - Content Patcher schema validation (`content.json`).
  - SMAPI manifest schema validation (`manifest.json`).
  - Live error highlighting for invalid JSON structures.
- File watcher notifications for changes in modding files.

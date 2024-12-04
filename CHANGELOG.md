# Changelog

All notable changes to this project will be documented in this file.

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

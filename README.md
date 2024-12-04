# Stardew Modding Schema README

The "Stardew Modding Schema" extension is a powerful tool designed to streamline the modding process for Stardew Valley. It provides schema validation, IntelliSense, and helpful tools for working with `content.json` and `manifest.json` files commonly used in modding the game. With this extension, mod developers can avoid common errors and enhance their productivity.

---

## Features

- **Schema Validation**: Automatically validates `content.json` and `manifest.json` files based on official SMAPI and Content Patcher schemas.
## Features

- **Translation File Support**: Provides schema validation and IntelliSense for all `i18n` translation files used in Stardew Valley mods. - All JSON files in the `i18n` folder (e.g., `i18n/en.json`, `i18n/fr.json`).

- **IntelliSense**: Provides autocompletion, inline documentation, and error highlighting for JSON files.
- **Live Feedback**: Notifies users of invalid configurations or missing required fields.
- **File Watcher**: Alerts users to changes in relevant files during development.

## Requirements

This extension requires the following:
- **VS Code Version**: 1.80.0 or later
- **Internet Access**: For downloading schema files from the SMAPI website
- **Node.js**: Installed on your machine to use `vsce` and other development tools if modifying the extension.

---

## Known Issues

- Some nested or custom modding configurations may not be fully validated if they aren't part of the schema.
- Validation errors may not be displayed correctly for files with incorrect JSON syntax.

---

## Release Notes

### 1.0.0
- Initial release with support for:
  - Content Patcher schema (`content.json`)
  - SMAPI manifest schema (`manifest.json`)
  - IntelliSense for Stardew Valley modding files

### 1.0.1
- Added support for:
  - i18n schema (e.g., `i18n/en.json`, `i18n/fr.json`)

---

## Following Extension Guidelines

This extension adheres to [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines). We welcome contributions and feedback to improve functionality and usability.

---

## For More Information

- [SMAPI Documentation](https://stardewvalleywiki.com/Modding:SMAPI)
- [Content Patcher Documentation](https://stardewvalleywiki.com/Modding:Content_Patcher)
- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)

**Enjoy modding Stardew Valley with confidence and ease!**

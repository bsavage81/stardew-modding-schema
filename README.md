# Stardew Modding Schema README

The **Stardew Modding Schema** extension is a powerful tool designed to streamline the modding workflow for **Stardew Valley**.  
It provides full schema validation, IntelliSense, hover documentation, and error highlighting for all major modding JSON files — including deep integration with **Content Patcher**, **SMAPI**, and **Unlockable Bundles (UB)**.

With this extension, mod developers can avoid common mistakes, speed up development, and enjoy a more stable, more productive modding experience.

---

## Features

### ✔ **Content Patcher + SMAPI Schema Validation**
Automatically validates:
- `content.json` (Content Patcher)
- `manifest.json` (SMAPI)

Ensures all properties follow official schemas and highlights incorrect formats, typos, or missing fields.

---

### ✔ **Unlockable Bundles (UB) Framework Support**
Adds **full IntelliSense and validation** for all UB assets inside `content.json`, including:

- `UnlockableBundles/Bundles`
- `UnlockableBundles/AdvancedPricing`
- `UnlockableBundles/WalletCurrencies`
- `UnlockableBundles/PrizeTicketMachines`

Features supported:
- Flavored items  
- Recipe items  
- Advanced pricing definitions  
- Special Placement Requirements (SPR)  
- Wallet currency systems  
- Prize ticket machine reward structures  
- Dynamic context tag validation  
- Quality suffixes  
- Spawn fields  

All UB-related schemas activate automatically when your patch’s `Target` matches the appropriate asset.

---

### ✔ **Translation File Support**
Provides schema validation + IntelliSense for:
- `i18n/en.json`
- `i18n/fr.json`
- Any other languages inside an `i18n` folder.

Includes:
- Key consistency checks  
- Highlighting of missing translation fields  
- Inline documentation  

---

### ✔ **IntelliSense Everywhere**
For every supported file:
- Autocompletion  
- Inline descriptions & property documentation  
- Hover explanations  
- Type checking  
- Example-aware validation  

This keeps your modding JSON clean, consistent, and error-free.

---

### ✔ **Live Feedback**
When editing:
- Invalid JSON  
- Incorrect item IDs  
- Unsupported Content Patcher fields  
- Wrong structure in UB bundle definitions  
- Broken translation files  

The extension highlights issues instantly.

---

### ✔ **File Watcher**
The extension listens for changes to:
- `content.json`
- `manifest.json`
- `i18n/*.json`

When a watched file changes, you’ll receive a lightweight notification.

---

## Requirements

- **VS Code** 1.80.0 or later  
- **Internet access** (for downloading official SMAPI & CP schemas)  
- **Node.js** only required if you are modifying the extension itself  

---

## Known Issues

- Some very complex or experimental mod formats may not yet be fully covered by the schema.
- JSON syntax errors may prevent deeper validation until resolved.
- UB Theme definitions (`UnlockableBundles/BundleThemes`) are not yet fully typed.

If you encounter something missing or incorrect, feel free to open an issue or submit a PR!

---

## Release Notes

### **1.1.0**
- Added **full Unlockable Bundles (UB) schema integration**:
  - Bundles  
  - Advanced Pricing  
  - Wallet Currencies  
  - Prize Ticket Machines  
- Unified Content Patcher + UB schema system for conditional validation based on patch `Target`.
- Major IntelliSense improvements for bundle placement, pricing, rewards, and flavored items.
- Cleaner schema registration and improved file watcher behavior.

### **1.0.1**
- Added translation (`i18n/*.json`) schema validation and IntelliSense.

### **1.0.0**
- Initial release including:
  - Content Patcher schema (`content.json`)
  - SMAPI manifest schema (`manifest.json`)
  - Live JSON error highlighting and IntelliSense

---

## Following Extension Guidelines

This extension follows all recommended practices from  
[VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines).

Contributions are welcome — improvements, schema expansions, or documentation updates!

---

## For More Information

- **SMAPI Documentation**  
  https://stardewvalleywiki.com/Modding:SMAPI

- **Content Patcher Documentation**  
  https://stardewvalleywiki.com/Modding:Content_Patcher

- **Unlockable Bundles Framework**  
  (GitLab) https://gitlab.com/delixx/stardew-valley/unlockable-bundles

- **VS Code Markdown Support**  
  https://code.visualstudio.com/docs/languages/markdown

---

**Enjoy modding Stardew Valley with better tools, smarter validation, and smoother workflows!**

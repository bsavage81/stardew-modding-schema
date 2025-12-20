// src/i18nHover.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parseTree, findNodeAtOffset, getNodeValue } from "jsonc-parser";

interface JsonAstNode {
  type: "object" | "array" | "property" | "string" | "number" | "boolean" | "null";
  offset: number;
  length: number;
  parent?: JsonAstNode;
  children?: JsonAstNode[];
  value?: unknown;
}

type I18nMap = Map<string, unknown>;

interface I18nFileData {
  filePath: string;
  fileName: string;
  languageLabel: string;
  json: unknown;
  flat: I18nMap;
}

class I18nCache {
  private readonly cacheByModRoot = new Map<string, { files: I18nFileData[]; loadedAt: number }>();
  private readonly watchersByModRoot = new Map<string, vscode.FileSystemWatcher[]>();

  public dispose(): void {
    for (const watchers of this.watchersByModRoot.values()) {
      for (const w of watchers) w.dispose();
    }
    this.watchersByModRoot.clear();
    this.cacheByModRoot.clear();
  }

  public clearForModRoot(modRoot: string): void {
    this.cacheByModRoot.delete(modRoot);

    const watchers = this.watchersByModRoot.get(modRoot);
    if (watchers) {
      for (const w of watchers) w.dispose();
      this.watchersByModRoot.delete(modRoot);
    }
  }

  public async getI18nFiles(modRoot: string): Promise<I18nFileData[]> {
    const cached = this.cacheByModRoot.get(modRoot);
    if (cached) return cached.files;

    const i18nDir = path.join(modRoot, "i18n");
    if (!fs.existsSync(i18nDir) || !fs.statSync(i18nDir).isDirectory()) {
      this.cacheByModRoot.set(modRoot, { files: [], loadedAt: Date.now() });
      return [];
    }

    const files = fs
      .readdirSync(i18nDir)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => path.join(i18nDir, f));

    const parsed: I18nFileData[] = [];
    for (const filePath of files) {
      const fileName = path.basename(filePath);
      const json = this.safeParseJsoncFile(filePath);
      if (json === undefined) continue;

      parsed.push({
        filePath,
        fileName,
        languageLabel: this.inferLanguageLabel(fileName),
        json,
        flat: this.flattenObjectToDotKeys(json),
      });
    }

    // Sort: default first, then alphabetical by label
    parsed.sort((a, b) => {
      const aIsDefault = a.fileName.toLowerCase() === "default.json";
      const bIsDefault = b.fileName.toLowerCase() === "default.json";
      if (aIsDefault && !bIsDefault) return -1;
      if (!aIsDefault && bIsDefault) return 1;
      return a.languageLabel.localeCompare(b.languageLabel);
    });

    this.cacheByModRoot.set(modRoot, { files: parsed, loadedAt: Date.now() });

    this.setupWatchers(modRoot);
    return parsed;
  }

  private setupWatchers(modRoot: string): void {
    if (this.watchersByModRoot.has(modRoot)) return;

    const patterns = [
      new vscode.RelativePattern(modRoot, "i18n/*.json"),
      new vscode.RelativePattern(modRoot, "i18n/*/*.json"),
      new vscode.RelativePattern(modRoot, "i18n/*/**/*.json"),
      new vscode.RelativePattern(modRoot, "manifest.json"),
    ];

    const watchers: vscode.FileSystemWatcher[] = [];
    for (const pat of patterns) {
      const w = vscode.workspace.createFileSystemWatcher(pat);
      w.onDidChange(() => this.clearForModRoot(modRoot));
      w.onDidCreate(() => this.clearForModRoot(modRoot));
      w.onDidDelete(() => this.clearForModRoot(modRoot));
      watchers.push(w);
    }

    this.watchersByModRoot.set(modRoot, watchers);
  }

  private safeParseJsoncFile(filePath: string): unknown | undefined {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const root = parseTree(raw) as JsonAstNode | undefined;
      if (!root) return undefined;
      return getNodeValue(root as any);
    } catch {
      return undefined;
    }
  }

  private inferLanguageLabel(fileName: string): string {
    const lower = fileName.toLowerCase();
    if (lower === "default.json") return "Default";

    const base = fileName.replace(/\.json$/i, "");
    const tag = base.replace(/_/g, "-");

    const common: Record<string, string> = {
      en: "English",
      es: "Spanish",
      fr: "French",
      de: "German",
      it: "Italian",
      pt: "Portuguese",
      "pt-br": "Portuguese (Brazil)",
      ru: "Russian",
      ja: "Japanese",
      ko: "Korean",
      "zh-cn": "Chinese (Simplified)",
      "zh-tw": "Chinese (Traditional)",
    };

    const key = tag.toLowerCase();
    return common[key] ?? tag;
  }

  private flattenObjectToDotKeys(value: unknown): I18nMap {
    const out = new Map<string, unknown>();

    const walk = (node: unknown, prefix: string): void => {
      if (node && typeof node === "object" && !Array.isArray(node)) {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          const next = prefix ? `${prefix}.${k}` : k;
          walk(v, next);
        }
        return;
      }

      out.set(prefix, node);
    };

    if (value && typeof value === "object" && !Array.isArray(value)) {
      walk(value, "");
      out.delete("");
    }

    return out;
  }
}

function normalizeI18nKey(rawKey: string): string {
  return rawKey.trim();
}

function tryExtractI18nKeyFromStringValue(s: string): string | null {
  const trimmed = s.trim();

  const tokenMatch = trimmed.match(/^\{\{\s*i18n\s*:\s*([^}]+)\s*\}\}$/i);
  if (tokenMatch) return normalizeI18nKey(tokenMatch[1]);

  const prefixMatch = trimmed.match(/^i18n\s*:\s*(.+)$/i);
  if (prefixMatch) return normalizeI18nKey(prefixMatch[1]);

  return null;
}

async function findNearestModRoot(startPath: string): Promise<string | null> {
  let dir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);

  while (true) {
    const manifestPath = path.join(dir, "manifest.json");
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isI18nFilePath(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/i18n/") && normalized.endsWith(".json");
}

function unquoteJsonStringLiteral(docText: string, node: JsonAstNode): string | null {
  // Node range includes quotes; use JSON.parse to correctly unescape.
  const raw = docText.slice(node.offset, node.offset + node.length);
  if (!raw.startsWith('"') || !raw.endsWith('"')) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStringNodeValue(docText: string, node: JsonAstNode): string | null {
  if (typeof node.value === "string") return node.value;
  if (node.type !== "string") return null;
  return unquoteJsonStringLiteral(docText, node);
}

function tryGetHoverKeyFromDocumentPosition(
  docText: string,
  offset: number,
  documentFsPath: string
): string | null {
  const root = parseTree(docText) as JsonAstNode | undefined;
  if (!root) return null;

  const node = findNodeAtOffset(root as any, offset, true) as JsonAstNode | undefined;
  if (!node) return null;

  // 1) Hovering directly on a string node: parse i18n token from its value
  if (node.type === "string") {
    const s = getStringNodeValue(docText, node);
    if (typeof s === "string") {
      const key = tryExtractI18nKeyFromStringValue(s);
      if (key) return key;
    }
  }

  // 2) Hovering a property node: check key AND value children appropriately.
  // jsonc-parser property children are typically [keyNode, valueNode]
  if (node.type === "property" && node.children && node.children.length >= 2) {
    const keyNode = node.children[0];
    const valueNode = node.children[1];

    // 2a) If this is an i18n file, hovering the property name should show translations for that key.
    if (isI18nFilePath(documentFsPath) && keyNode?.type === "string") {
      const k = getStringNodeValue(docText, keyNode);
      if (typeof k === "string") return normalizeI18nKey(k);
    }

    // 2b) For any json file, if the property value is a string containing {{i18n:...}}, extract it.
    if (valueNode?.type === "string") {
      const v = getStringNodeValue(docText, valueNode);
      if (typeof v === "string") {
        const key = tryExtractI18nKeyFromStringValue(v);
        if (key) return key;
      }
    }
  }

  return null;
}

function formatValueAsBullet(value: unknown): string {
  if (value === undefined) return "- (missing)";
  if (value === null) return "- null";
  if (typeof value === "string") return `- ${value}`;
  if (typeof value === "number" || typeof value === "boolean") return `- ${String(value)}`;

  try {
    const s = JSON.stringify(value, null, 2);
    if (s.length <= 800) return "```json\n" + s + "\n```";
    return "- (non-string value)";
  } catch {
    return "- (non-string value)";
  }
}

function buildI18nHoverMarkdown(key: string, files: I18nFileData[]): vscode.MarkdownString | null {
  if (!files.length) return null;

  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;

  md.appendMarkdown(`**i18n:** \`${key}\`\n\n`);

  let anyFound = false;

  for (const f of files) {
    const value = f.flat.get(key);
    if (value !== undefined) anyFound = true;

    md.appendMarkdown(`${f.languageLabel} - ${f.fileName}\n`);
    md.appendMarkdown(`${formatValueAsBullet(value)}\n\n`);
  }

  if (!anyFound) {
    md.appendMarkdown(`_(No translations found for this key in the i18n folder.)_\n`);
  }

  return md;
}

export function registerI18nHoverSupport(context: vscode.ExtensionContext): void {
  const cache = new I18nCache();
  context.subscriptions.push({ dispose: () => cache.dispose() });

  const provider: vscode.HoverProvider = {
    provideHover: async (document, position) => {
      try {
        const key = tryGetHoverKeyFromDocumentPosition(
          document.getText(),
          document.offsetAt(position),
          document.uri.fsPath
        );
        if (!key) return null;

        const modRoot = await findNearestModRoot(document.uri.fsPath);
        if (!modRoot) return null;

        const i18nFiles = await cache.getI18nFiles(modRoot);
        if (!i18nFiles.length) return null;

        const md = buildI18nHoverMarkdown(key, i18nFiles);
        if (!md) return null;

        return new vscode.Hover(md);
      } catch {
        return null;
      }
    },
  };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider([{ language: "json" }, { language: "jsonc" }], provider)
  );
}

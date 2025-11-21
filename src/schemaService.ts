// src/schemaService.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getLanguageService, JSONSchema } from "vscode-json-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import { loadStardewIds, buildStardewItemIdSchema } from "./stardewIds";

export function setupSchemaLanguageService(context: vscode.ExtensionContext): void {
  const lookups = loadStardewIds(context);
  const itemIdSchema = buildStardewItemIdSchema(lookups);

  // Load master schema from disk
  const masterSchemaPath = context.asAbsolutePath(
    path.join("schemas", "stardew-content.schema.json")
  );
  const masterSchemaJson = fs.readFileSync(masterSchemaPath, "utf8");
  const masterSchema = JSON.parse(masterSchemaJson) as JSONSchema;

  // Replace any $ref to ./stardew-item-id.schema.json with the runtime schema object
  inlineItemIdSchema(masterSchema, "./stardew-item-id.schema.json", itemIdSchema);

  const languageService = getLanguageService({
    schemaRequestService: async (uri: string): Promise<string> => {
      // Local relative refs like "./unlockable-bundles.schema.json"
      // or file names without protocol.
      if (isLikelyLocalSchemaRef(uri)) {
        const schemaPath = resolveRelativeSchema(context, uri);
        if (schemaPath && fs.existsSync(schemaPath)) {
          return fs.readFileSync(schemaPath, "utf8");
        }
      }

      // Remote schemas (Content Patcher, Furniture Framework, etc.)
      const res = await fetch(uri);
      return res.text();
    }
  });

  languageService.configure({
    schemas: [
      {
        uri: "vscode://schemas/content-patcher-combined",
        fileMatch: ["**/content.json"],
        schema: masterSchema
      }
    ]
  });

  const selector: vscode.DocumentSelector = [
    { language: "json", pattern: "**/content.json" },
    { language: "jsonc", pattern: "**/content.json" }
  ];

  // Hover
  vscode.languages.registerHoverProvider(selector, {
    async provideHover(document, position) {
      const text = document.getText();
      const doc = TextDocument.create(
        document.uri.toString(),
        document.languageId,
        document.version,
        text
      );
      const parsed = languageService.parseJSONDocument(doc);
      const hover = await languageService.doHover(
        doc,
        { line: position.line, character: position.character },
        parsed
      );
      return hover as any;
    }
  });

  // Completion
  vscode.languages.registerCompletionItemProvider(
    selector,
    {
      async provideCompletionItems(document, position) {
        const text = document.getText();
        const doc = TextDocument.create(
          document.uri.toString(),
          document.languageId,
          document.version,
          text
        );
        const parsed = languageService.parseJSONDocument(doc);
        const result = await languageService.doComplete(
          doc,
          { line: position.line, character: position.character },
          parsed
        );
        return result as any;
      }
    },
    '"',
    "("
  );
}

/**
 * Recursively replace $ref == fromRef with the given schema object.
 */
function inlineItemIdSchema(
  node: any,
  fromRef: string,
  schema: JSONSchema
): void {
  if (!node || typeof node !== "object") return;

  for (const key of Object.keys(node)) {
    const value = node[key];

    if (key === "$ref" && value === fromRef) {
      // Replace this node entirely with the schema contents
      delete node["$ref"];
      Object.assign(node, schema);
    } else if (value && typeof value === "object") {
      inlineItemIdSchema(value, fromRef, schema);
    }
  }
}

/**
 * Heuristic: URI is "local" if it starts with "./" or has no protocol.
 */
function isLikelyLocalSchemaRef(uri: string): boolean {
  if (uri.startsWith("./")) return true;
  // no protocol prefix like "http://", "https://", "vscode://" etc.
  return !/^[a-zA-Z]+:\/\//.test(uri);
}

/**
 * Map "./foo.json" or "foo.json" → ./schemas/foo.json under the extension.
 */
function resolveRelativeSchema(
  context: vscode.ExtensionContext,
  uri: string
): string | null {
  const trimmed = uri.startsWith("./") ? uri.slice(2) : uri;
  const candidate = context.asAbsolutePath(path.join("schemas", trimmed));
  return candidate;
}

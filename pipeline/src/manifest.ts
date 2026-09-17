import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

const require = createRequire(import.meta.url);
const formatsPlugin = require("ajv-formats") as FormatsPlugin;

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ErrorObject[];
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultSchemaPath = path.resolve(moduleDirectory, "../../schema/tile-metadata.schema.json");

export async function validateManifest(
  manifestPath: string,
  schemaPath = defaultSchemaPath,
): Promise<ManifestValidationResult> {
  const [manifestText, schemaText] = await Promise.all([
    readFile(path.resolve(manifestPath), "utf8"),
    readFile(path.resolve(schemaPath), "utf8"),
  ]);
  const manifest: unknown = JSON.parse(manifestText);
  const schema: object = JSON.parse(schemaText) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  formatsPlugin(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(manifest);
  return { valid, errors: validate.errors ?? [] };
}

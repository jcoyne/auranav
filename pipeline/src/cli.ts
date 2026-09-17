#!/usr/bin/env node
import { inspectExchangeSet } from "./inventory.js";
import { defaultSchemaPath, validateManifest } from "./manifest.js";
import { convertExchangeSet, type ConvertExchangeSetOptions } from "./batch.js";
import { convertCell, type ConvertCellOptions } from "./s57.js";

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "inventory": {
      const [input] = args;
      if (input === undefined) usage("inventory requires a directory or ZIP path");
      const inventory = await inspectExchangeSet(input);
      console.log(JSON.stringify(inventory, null, 2));
      if (!inventory.valid) process.exitCode = 1;
      break;
    }
    case "validate-manifest": {
      const [manifestPath, schemaPath = defaultSchemaPath] = args;
      if (manifestPath === undefined) usage("validate-manifest requires a manifest path");
      const result = await validateManifest(manifestPath, schemaPath);
      if (result.valid) {
        console.log(`${manifestPath} conforms to schema version 1`);
      } else {
        console.error(JSON.stringify(result.errors, null, 2));
        process.exitCode = 1;
      }
      break;
    }
    case "convert-cell": {
      const options = parseConvertOptions(args);
      const manifestPath = await convertCell(options);
      const result = await validateManifest(manifestPath);
      if (!result.valid) throw new Error(`Generated manifest does not conform to schema v1: ${JSON.stringify(result.errors)}`);
      console.log(`Created chart package: ${manifestPath}`);
      break;
    }
    case "convert-exchange-set": {
      const options = parseBatchOptions(args);
      const manifestPath = await convertExchangeSet(options);
      console.log(`Created exchange-set chart package: ${manifestPath}`);
      break;
    }
    default:
      usage(command === undefined ? undefined : `unknown command: ${command}`);
  }
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function usage(problem?: string): never {
  if (problem !== undefined) console.error(problem);
  console.error(`Usage:
  npm run cli -- inventory <exchange-set-directory-or-zip>
  npm run cli -- validate-manifest <manifest.json> [schema.json]
  npm run cli -- convert-cell <cell.000> --output <directory> --package-id <id> --name <name>
    --source-url <url> --retrieved-at <date-time> --user-agreement <file>
    [--generated-at <date-time>] [--min-zoom <0-22>] [--max-zoom <0-22>]
  npm run cli -- convert-exchange-set <extracted-directory> --output <directory> --package-id <id>
    --name <name> --source-url <url> --retrieved-at <date-time> --user-agreement <file>
    [--generated-at <date-time>] [--min-zoom <0-22>] [--max-zoom <0-22>] [--limit <count>]`);
  process.exit(2);
}

function parseBatchOptions(args: readonly string[]): ConvertExchangeSetOptions {
  const [inputDirectory, ...tokens] = args;
  if (inputDirectory === undefined || inputDirectory.startsWith("--")) usage("convert-exchange-set requires an extracted directory");
  const values = parseOptionPairs(tokens, new Set([
    "--output", "--package-id", "--name", "--source-url", "--retrieved-at", "--user-agreement",
    "--generated-at", "--min-zoom", "--max-zoom", "--limit",
  ]), "convert-exchange-set");
  const required = (key: string): string => requireOption(values, key, "convert-exchange-set");
  const minZoom = optionalInteger(values, "--min-zoom");
  const maxZoom = optionalInteger(values, "--max-zoom");
  const limit = optionalInteger(values, "--limit");
  return {
    inputDirectory,
    outputDirectory: required("--output"),
    packageId: required("--package-id"),
    packageName: required("--name"),
    sourceUrl: required("--source-url"),
    retrievedAt: required("--retrieved-at"),
    userAgreement: required("--user-agreement"),
    ...(values.has("--generated-at") ? { generatedAt: required("--generated-at") } : {}),
    ...(minZoom === undefined ? {} : { minZoom }),
    ...(maxZoom === undefined ? {} : { maxZoom }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function parseOptionPairs(tokens: readonly string[], allowed: ReadonlySet<string>, commandName: string): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--") || value.startsWith("--")) {
      usage(`${commandName} options require --name value pairs`);
    }
    if (!allowed.has(key)) usage(`unknown ${commandName} option: ${key}`);
    if (values.has(key)) usage(`duplicate option: ${key}`);
    values.set(key, value);
  }
  return values;
}

function requireOption(values: ReadonlyMap<string, string>, key: string, commandName: string): string {
  const value = values.get(key);
  if (value === undefined) usage(`${commandName} requires ${key}`);
  return value;
}

function optionalInteger(values: ReadonlyMap<string, string>, key: string): number | undefined {
  const value = values.get(key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) usage(`${key} must be an integer`);
  return Number(value);
}

function parseConvertOptions(args: readonly string[]): ConvertCellOptions {
  const [baseCell, ...tokens] = args;
  if (baseCell === undefined || baseCell.startsWith("--")) usage("convert-cell requires an extracted .000 base cell");
  const values = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--") || value.startsWith("--")) usage("convert-cell options require --name value pairs");
    if (values.has(key)) usage(`duplicate option: ${key}`);
    values.set(key, value);
  }
  const allowed = new Set(["--output", "--package-id", "--name", "--source-url", "--retrieved-at", "--user-agreement", "--generated-at", "--min-zoom", "--max-zoom"]);
  for (const key of values.keys()) if (!allowed.has(key)) usage(`unknown convert-cell option: ${key}`);
  const required = (key: string): string => {
    const value = values.get(key);
    if (value === undefined) usage(`convert-cell requires ${key}`);
    return value;
  };
  const optionalInteger = (key: string): number | undefined => {
    const value = values.get(key);
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) usage(`${key} must be an integer`);
    return Number(value);
  };
  const minZoom = optionalInteger("--min-zoom");
  const maxZoom = optionalInteger("--max-zoom");
  return {
    baseCell,
    outputDirectory: required("--output"),
    packageId: required("--package-id"),
    packageName: required("--name"),
    sourceUrl: required("--source-url"),
    retrievedAt: required("--retrieved-at"),
    userAgreement: required("--user-agreement"),
    ...(values.has("--generated-at") ? { generatedAt: required("--generated-at") } : {}),
    ...(minZoom === undefined ? {} : { minZoom }),
    ...(maxZoom === undefined ? {} : { maxZoom }),
  };
}

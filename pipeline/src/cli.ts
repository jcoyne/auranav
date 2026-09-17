#!/usr/bin/env node
import { inspectExchangeSet } from "./inventory.js";
import { defaultSchemaPath, validateManifest } from "./manifest.js";

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
  npm run cli -- validate-manifest <manifest.json> [schema.json]`);
  process.exit(2);
}

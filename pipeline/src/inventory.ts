import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";

const DATASET_FILE = /(?:^|\/)([A-Z0-9]{8})\.(\d{3})$/i;

export interface InventoryIssue {
  readonly code:
    | "duplicate-file"
    | "missing-base"
    | "missing-update"
    | "no-dataset-files"
    | "unsupported-input";
  readonly message: string;
  readonly cell?: string;
  readonly updateNumber?: number;
}

export interface CellInventory {
  readonly name: string;
  readonly base: string | null;
  readonly updates: readonly string[];
  readonly updateNumbers: readonly number[];
}

export interface ExchangeSetInventory {
  readonly input: string;
  readonly inputKind: "directory" | "zip";
  readonly cells: readonly CellInventory[];
  readonly issues: readonly InventoryIssue[];
  readonly valid: boolean;
}

interface DatasetFile {
  readonly path: string;
  readonly cell: string;
  readonly updateNumber: number;
}

export function inspectEntries(entries: readonly string[]): Pick<ExchangeSetInventory, "cells" | "issues" | "valid"> {
  const files = entries.flatMap((entry): DatasetFile[] => {
    const normalized = entry.replaceAll("\\", "/");
    const match = normalized.match(DATASET_FILE);
    if (match === null) return [];

    const cell = match[1];
    const extension = match[2];
    if (cell === undefined || extension === undefined) return [];

    return [{ path: normalized, cell: cell.toUpperCase(), updateNumber: Number(extension) }];
  });

  const grouped = new Map<string, DatasetFile[]>();
  for (const file of files) {
    const existing = grouped.get(file.cell) ?? [];
    existing.push(file);
    grouped.set(file.cell, existing);
  }

  const issues: InventoryIssue[] = [];
  const cells = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, cellFiles]): CellInventory => {
      const byUpdate = new Map<number, DatasetFile[]>();
      for (const file of cellFiles) {
        const existing = byUpdate.get(file.updateNumber) ?? [];
        existing.push(file);
        byUpdate.set(file.updateNumber, existing);
      }

      for (const [updateNumber, duplicates] of byUpdate) {
        if (duplicates.length > 1) {
          issues.push({
            code: "duplicate-file",
            cell: name,
            updateNumber,
            message: `${name} has ${duplicates.length} files for update ${formatUpdate(updateNumber)}`,
          });
        }
      }

      const base = byUpdate.get(0)?.[0]?.path ?? null;
      const updateNumbers = [...byUpdate.keys()].filter((number) => number > 0).sort((a, b) => a - b);

      if (base === null) {
        issues.push({ code: "missing-base", cell: name, message: `${name} has updates but no .000 base cell` });
      }

      const finalUpdate = updateNumbers.at(-1) ?? 0;
      for (let expected = 1; expected <= finalUpdate; expected += 1) {
        if (!byUpdate.has(expected)) {
          issues.push({
            code: "missing-update",
            cell: name,
            updateNumber: expected,
            message: `${name} is missing sequential update ${formatUpdate(expected)}`,
          });
        }
      }

      return {
        name,
        base,
        updates: updateNumbers.flatMap((number) => byUpdate.get(number)?.[0]?.path ?? []),
        updateNumbers,
      };
    });

  if (cells.length === 0) {
    issues.push({ code: "no-dataset-files", message: "No S-57 base cells or update files were found" });
  }

  return { cells, issues, valid: issues.length === 0 };
}

export async function inspectExchangeSet(input: string): Promise<ExchangeSetInventory> {
  const absoluteInput = path.resolve(input);
  const inputStat = await lstat(absoluteInput);
  let inputKind: ExchangeSetInventory["inputKind"];
  let entries: string[];

  if (inputStat.isDirectory()) {
    inputKind = "directory";
    entries = await listDirectoryFiles(absoluteInput);
  } else if (inputStat.isFile() && path.extname(absoluteInput).toLowerCase() === ".zip") {
    inputKind = "zip";
    entries = await listZipEntries(absoluteInput);
  } else {
    return {
      input: absoluteInput,
      inputKind: "directory",
      cells: [],
      issues: [{ code: "unsupported-input", message: "Input must be an extracted directory or a .zip file" }],
      valid: false,
    };
  }

  return { input: absoluteInput, inputKind, ...inspectEntries(entries) };
}

async function listDirectoryFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) found.push(path.relative(root, absolute).replaceAll(path.sep, "/"));
    }
  }

  await visit(root);
  return found;
}

async function listZipEntries(zipPath: string): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (openError, zipFile) => {
      if (openError !== null || zipFile === undefined) {
        reject(openError ?? new Error(`Unable to open ZIP: ${zipPath}`));
        return;
      }

      const entries: string[] = [];
      zipFile.on("error", reject);
      zipFile.on("entry", (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith("/")) entries.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.on("end", () => resolve(entries));
      zipFile.readEntry();
    });
  });
}

function formatUpdate(updateNumber: number): string {
  return updateNumber.toString().padStart(3, "0");
}

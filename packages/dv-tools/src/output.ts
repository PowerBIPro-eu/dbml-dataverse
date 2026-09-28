import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './util.js';

// dv-convert owns only *.dv.dbml and model.json in the output folder — never layout.json,
// dv-convert.json, colors.json or anything else.

export interface OutputFile {
  name: string;      // file name inside the output folder
  content: string;   // LF line endings, trailing newline
}

export interface OutputSet {
  files: OutputFile[];
  /** Remove *.dv.dbml files this run did not produce (off with --no-dbml and in single-entity mode). */
  pruneDbml: boolean;
}

export interface OutputDelta {
  changed: string[];    // missing or different on disk
  unchanged: string[];
  stale: string[];      // *.dv.dbml on disk that this run does not produce
}

const MODEL_FILE = 'model.json';
const TMP_DIR = '.dv-convert.tmp';

function readIfExists(path: string): string | null {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

/** Line-ending-only differences don't count (Windows checkouts with core.autocrlf). */
function sameContent(onDisk: string, fresh: string): boolean {
  return onDisk === fresh || onDisk.replace(/\r\n/g, '\n') === fresh;
}

/** Compare the in-memory output with the output folder, without touching it. */
export function compareOutputs(outDir: string, set: OutputSet): OutputDelta {
  const delta: OutputDelta = { changed: [], unchanged: [], stale: [] };
  for (const file of set.files) {
    const onDisk = readIfExists(join(outDir, file.name));
    (onDisk !== null && sameContent(onDisk, file.content) ? delta.unchanged : delta.changed).push(file.name);
  }
  if (set.pruneDbml && existsSync(outDir)) {
    // case-insensitive: on NTFS `task.dv.dbml` and `Task.dv.dbml` are the same file
    const produced = new Set(set.files.map((f) => f.name.toLowerCase()));
    for (const name of listDir(outDir, 'files')) {
      const lower = name.toLowerCase();
      if (lower.endsWith('.dv.dbml') && !produced.has(lower)) delta.stale.push(name);
    }
  }
  return delta;
}

/** Windows may briefly lock a file (antivirus, indexer); retry the rename a few times. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err: any) {
      if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/**
 * Write the output: changed files go to <out>/.dv-convert.tmp/ first, then are renamed into
 * place (model.json last); unchanged files are left alone; stale *.dv.dbml files are removed.
 */
export function writeOutputs(outDir: string, set: OutputSet): OutputDelta {
  const delta = compareOutputs(outDir, set);
  const tmp = join(outDir, TMP_DIR);
  mkdirSync(outDir, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });

  if (delta.changed.length) {
    mkdirSync(tmp);
    const content = new Map(set.files.map((f) => [f.name, f.content]));
    for (const name of delta.changed) writeFileSync(join(tmp, name), content.get(name)!, 'utf-8');
    const modelLast = [...delta.changed].sort((a, b) => Number(a === MODEL_FILE) - Number(b === MODEL_FILE));
    for (const name of modelLast) renameWithRetry(join(tmp, name), join(outDir, name));
  }
  for (const name of delta.stale) unlinkSync(join(outDir, name));

  rmSync(tmp, { recursive: true, force: true });
  return delta;
}

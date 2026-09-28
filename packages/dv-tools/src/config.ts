import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UsageError } from './errors.js';
import { PLATFORM_TABLES_VALUES, type PlatformTables } from './types.js';
import { portableRelative } from './util.js';

// Options file `dv-convert.json`; paths inside it are relative to the file itself.

export const CONFIG_FILE = 'dv-convert.json';
export const CONFIG_VERSION = 1;

export interface ConfigSolution {
  path: string;
  name?: string;
  uniqueName?: string;   // must match Solution.xml, otherwise the run fails
}

export interface DvConvertConfig {
  configVersion: number;
  solutions: ConfigSolution[];
  output?: string;
  colors?: string | null;
  dbml?: boolean;
  platformTables?: PlatformTables;
}

const TOP_KEYS = ['configVersion', 'solutions', 'output', 'colors', 'dbml', 'platformTables'];
const SOLUTION_KEYS = ['path', 'name', 'uniqueName'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a parsed options file; any problem (incl. unknown keys) is a UsageError (exit 2). */
export function validateConfig(raw: unknown, file: string): DvConvertConfig {
  const fail = (message: string): never => { throw new UsageError(`${file}: ${message}`); };

  if (!isObject(raw)) fail('expected a JSON object');
  const config = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(config).filter((k) => !TOP_KEYS.includes(k));
  if (unknownKeys.length) fail(`unknown key(s): ${unknownKeys.join(', ')}`);

  const version = config.configVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) fail('configVersion must be a positive integer');
  if ((version as number) > CONFIG_VERSION) {
    fail(`configVersion ${version} is newer than this dv-convert supports (${CONFIG_VERSION}); upgrade @powerbipro-eu/dv-tools`);
  }

  if (!Array.isArray(config.solutions) || config.solutions.length === 0) fail('solutions must be a non-empty array');
  (config.solutions as unknown[]).forEach((s, i) => {
    if (!isObject(s)) fail(`solutions[${i}] must be an object`);
    const solution = s as Record<string, unknown>;
    const unknownSolutionKeys = Object.keys(solution).filter((k) => !SOLUTION_KEYS.includes(k));
    if (unknownSolutionKeys.length) fail(`solutions[${i}]: unknown key(s): ${unknownSolutionKeys.join(', ')}`);
    if (!isNonEmptyString(solution.path)) fail(`solutions[${i}].path must be a non-empty string`);
    for (const key of ['name', 'uniqueName']) {
      if (solution[key] !== undefined && !isNonEmptyString(solution[key])) fail(`solutions[${i}].${key} must be a non-empty string`);
    }
  });

  if (config.output !== undefined && !isNonEmptyString(config.output)) fail('output must be a non-empty string');
  if (config.colors !== undefined && config.colors !== null && !isNonEmptyString(config.colors)) fail('colors must be a file path or null');
  if (config.dbml !== undefined && typeof config.dbml !== 'boolean') fail('dbml must be true or false');
  if (config.platformTables !== undefined && !PLATFORM_TABLES_VALUES.includes(config.platformTables as PlatformTables)) {
    fail(`platformTables must be one of: ${PLATFORM_TABLES_VALUES.join(', ')}`);
  }
  return config as unknown as DvConvertConfig;
}

export function readConfig(file: string): DvConvertConfig {
  let text: string;
  try { text = readFileSync(file, 'utf-8'); } catch { throw new UsageError(`options file not found: ${file}`); }
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch (err: any) { throw new UsageError(`${file}: invalid JSON (${err.message})`); }
  return validateConfig(raw, file);
}

function findGitRoot(start: string): string | null {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;   // .git is a folder, or a file in worktrees
    if (dirname(dir) === dir) return null;
  }
}

/** ./dv-convert.json, then <git root>/docs/datamodel/dv-convert.json. */
export function discoverConfig(cwd: string): string | null {
  const local = join(cwd, CONFIG_FILE);
  if (existsSync(local)) return local;
  const root = findGitRoot(cwd);
  const inRepo = root ? join(root, 'docs', 'datamodel', CONFIG_FILE) : null;
  return inRepo && existsSync(inRepo) ? inRepo : null;
}

/** The options file --write-config puts into the output folder (paths relative to it). */
export function makeConfig(opts: {
  outputDir: string;
  solutions: Array<{ path: string; name: string; uniqueName?: string | null }>;
  colorsPath: string | null;
  dbml: boolean;
  platformTables: PlatformTables;
}): DvConvertConfig {
  return {
    configVersion: CONFIG_VERSION,
    solutions: opts.solutions.map((s) => ({
      path: portableRelative(opts.outputDir, s.path),
      name: s.name,
      ...(s.uniqueName ? { uniqueName: s.uniqueName } : {}),
    })),
    output: '.',
    ...(opts.colorsPath ? { colors: portableRelative(opts.outputDir, opts.colorsPath) } : {}),
    dbml: opts.dbml,
    platformTables: opts.platformTables,
  };
}

export function serializeConfig(config: DvConvertConfig): string {
  return JSON.stringify(config, null, 2) + '\n';
}
